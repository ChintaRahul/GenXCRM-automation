import { Injectable, NotFoundException, ForbiddenException, UnauthorizedException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import axios from 'axios';
import {
  cashfreeAuthorizeUrl,
  cashfreeBaseUrl,
  cashfreeHeaders,
  cashfreeSubscriptionHeaders,
  isCashfreeSandbox,
} from '../../common/utils/cashfree.util';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationProvider, IntegrationStatus, PaymentGateway, PaymentStatus, Prisma } from '@prisma/client';
import type { EmiMandateStatus } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { PaymentReceiptsService } from '../payment-receipts/payment-receipts.service';
import { ErrorMessages } from '../../common/constants/messages';
import { buildLeadScopeFilter } from '../../common/utils/scope.util';
import { toE164 } from '../../common/utils/phone.util';
import { decryptToken } from '../../common/crypto.utils';

interface CreatePaymentDto {
  leadId: string;
  amount: number;
  currency?: string;
  gateway: PaymentGateway;
  discountAmount?: number;
  gstPercent?: number;
  includeGstNumber?: boolean;
  dueDate?: string;
  installments?: { amount: number; dueDate: string }[];
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: PaymentReceiptsService,
  ) {}

  async createPayment(dto: CreatePaymentDto, caller: AuthUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, ...buildLeadScopeFilter(caller) },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.payments.leadNotFound);

    // Prefers the org's own connected gateway account (so the money flows straight to the
    // customer, not through GenXCRM); falls back to the platform's account for orgs that
    // haven't connected their own. This is entirely separate from BillingService, which always
    // uses the platform's Razorpay for GenXCRM's own subscription revenue.
    // Cashfree is used only when explicitly chosen; every other value keeps the existing
    // Razorpay behaviour (Stripe/PayU were never wired up).
    //
    // Leads store bare 10-digit Indian mobile numbers with no country code (see
    // LeadsService.normalizePhone) — Razorpay's payment-link API rejects/mishandles a
    // contact number with no country code, so it must be added at send time, same as
    // CommunicationsService does for WhatsApp/SMS via phone.util.ts.
    const gateway = dto.gateway === PaymentGateway.CASHFREE ? PaymentGateway.CASHFREE : PaymentGateway.RAZORPAY;
    const link = await this.createGatewayLink(
      gateway,
      caller.orgId ?? undefined,
      dto.amount,
      dto.currency ?? 'INR',
      dto.leadId,
      { name: lead.name, email: lead.email ?? undefined, contact: toE164(lead.phone) },
    );

    return this.prisma.payment.create({
      data: {
        leadId: dto.leadId,
        gateway,
        amount: dto.amount,
        currency: dto.currency ?? 'INR',
        discountAmount: dto.discountAmount ?? 0,
        gstPercent: dto.gstPercent ?? 18,
        includeGstNumber: dto.includeGstNumber ?? true,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        paymentLink: link.shortUrl,
        gatewayOrderId: link.id, // payment-link id — matched by the webhook when the link is paid
        status: PaymentStatus.LINK_SENT,
        installments: dto.installments
          ? { create: dto.installments.map((inst) => ({ amount: inst.amount, dueDate: new Date(inst.dueDate) })) }
          : undefined,
      },
      include: { installments: true },
    });
  }

  // Public — lets callers outside the Payment model (InvoicesService's invoice/registration
  // payment-link UI) know whether a real link can actually be created for this org right now,
  // without decrypting or exposing the credentials. Mirrors resolveRazorpayCredentials's
  // org-first-then-platform-fallback rule so "connected" always means the same thing everywhere.
  async isRazorpayConnected(orgId?: string): Promise<boolean> {
    return (await this.resolveRazorpayCredentials(orgId)) !== null;
  }

  async isCashfreeConnected(orgId?: string): Promise<boolean> {
    return (await this.resolveCashfreeCredentials(orgId)) !== null;
  }

  // Public — reuses the same credential resolution + gateway call as createPayment, for
  // callers that need a link but aren't creating a Payment row (e.g. InvoicesService's invoice
  // "Attach payment link" and registration-fee send-link features). Kept here rather than
  // duplicated since this is the one place gateway API usage lives.
  async createGatewayLink(
    gateway: typeof PaymentGateway.RAZORPAY | typeof PaymentGateway.CASHFREE,
    orgId: string | undefined,
    amount: number,
    currency: string,
    referenceId: string,
    customer: { name: string; email?: string; contact: string },
    extraNotes?: Record<string, string>,
  ): Promise<{ id: string; shortUrl: string }> {
    if (gateway === PaymentGateway.CASHFREE) {
      const creds = await this.resolveCashfreeCredentials(orgId);
      if (!creds) throw new ForbiddenException(ErrorMessages.payments.cashfreeNotConfigured);
      return this.createCashfreeLink(creds, amount, currency, referenceId, customer, extraNotes);
    }
    return this.createRazorpayLink(orgId, amount, currency, referenceId, customer, extraNotes);
  }

  async createRazorpayLink(
    orgId: string | undefined,
    amount: number,
    currency: string,
    referenceId: string,
    customer: { name: string; email?: string; contact: string },
    extraNotes?: Record<string, string>,
  ): Promise<{ id: string; shortUrl: string }> {
    const creds = await this.resolveRazorpayCredentials(orgId);
    if (!creds) throw new ForbiddenException(ErrorMessages.payments.razorpayNotConfigured);
    const link = await this.createPaymentLink(creds, amount, currency, referenceId, customer, extraNotes);
    return { id: link.id, shortUrl: link.short_url };
  }

  // Creates a Razorpay Plan + Subscription for EMI auto-debit (UPI Autopay / e-NACH / card,
  // whichever the merchant account has enabled — Razorpay's Subscriptions API is a single
  // API covering all of them). Unlike createRazorpayLink, every cycle charges the SAME fixed
  // amount (a Razorpay Plan constraint — see invoices.math.ts's computeEmiSchedule, whose
  // last installment can differ by a few paise; that row is deliberately NOT special-cased
  // here, so the mandate's total can drift from grandTotal by at most tenureMonths * ₹0.01).
  async createRazorpaySubscription(
    orgId: string | undefined,
    perEmiAmount: number,
    currency: string,
    tenureMonths: number,
    customer: { name: string; email?: string; contact: string },
    extraNotes?: Record<string, string>,
  ): Promise<{ subscriptionId: string; shortUrl: string }> {
    const creds = await this.resolveRazorpayCredentials(orgId);
    if (!creds) throw new ForbiddenException(ErrorMessages.payments.razorpayNotConfigured);

    try {
      const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
      const client = rzp as unknown as {
        plans: { create: (data: unknown) => Promise<{ id: string }> };
        subscriptions: {
          create: (data: unknown) => Promise<{ id: string; short_url: string }>;
        };
      };

      const plan = await client.plans.create({
        period: 'monthly',
        interval: 1,
        item: { name: 'Course EMI', amount: Math.round(perEmiAmount * 100), currency },
      });

      const subscription = await client.subscriptions.create({
        plan_id: plan.id,
        total_count: tenureMonths,
        customer_notify: true,
        notify_info: { notify_phone: customer.contact, notify_email: customer.email },
        notes: extraNotes,
      });

      return { subscriptionId: subscription.id, shortUrl: subscription.short_url };
    } catch (err) {
      const reason = this.razorpayErrorReason(err);
      this.logger.error(`Razorpay subscription create failed: ${reason}`);
      throw new ForbiddenException(ErrorMessages.payments.paymentLinkFailed(reason));
    }
  }

  // Creates a Cashfree Subscription (UPI Autopay / e-NACH / card) for EMI auto-debit. Like the
  // Razorpay flow every cycle charges the same fixed amount. The plan is defined inline, so
  // there is no separate plan to create. Cashfree returns a session id rather than a link, so
  // the returned `shortUrl` points at GenXCRM's public /authorize-mandate page, which opens
  // Cashfree's checkout for the customer.
  async createCashfreeSubscription(
    orgId: string | undefined,
    perEmiAmount: number,
    currency: string,
    tenureMonths: number,
    firstChargeDate: Date,
    customer: { name: string; email?: string; contact: string },
    extraNotes?: Record<string, string>,
  ): Promise<{ subscriptionId: string; shortUrl: string }> {
    const creds = await this.resolveCashfreeCredentials(orgId);
    if (!creds) throw new ForbiddenException(ErrorMessages.payments.cashfreeNotConfigured);

    // Cashfree rejects a first charge before tomorrow (it needs time to notify the customer), so a
    // same-day or past EMI start date is pushed to 24h from now. The installment's due date in
    // GenXCRM stays as entered; paid-matching tolerates the small shift.
    const earliest = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const firstCharge = firstChargeDate > earliest ? firstChargeDate : earliest;

    const subscriptionId = `gxs_${crypto.randomUUID().replaceAll('-', '')}`;
    const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const sandbox = isCashfreeSandbox(creds.appId, creds.secret);
    try {
      const { data } = await axios.post<{ subscription_session_id: string }>(
        `${cashfreeBaseUrl(creds.appId, creds.secret)}/subscriptions`,
        {
          subscription_id: subscriptionId,
          customer_details: {
            customer_name: customer.name,
            customer_email: customer.email ?? 'noreply@genxcrm.co.in',
            customer_phone: customer.contact.replace(/\D/g, '').slice(-10),
          },
          plan_details: {
            plan_name: 'Course EMI',
            plan_type: 'PERIODIC',
            plan_currency: currency,
            plan_amount: perEmiAmount,
            plan_max_amount: perEmiAmount,
            plan_max_cycles: tenureMonths,
            plan_intervals: 1,
            plan_interval_type: 'MONTH',
          },
          authorization_details: {
            authorization_amount: 1,
            authorization_amount_refund: true,
            payment_methods: ['enach', 'upi', 'card'],
          },
          subscription_first_charge_time: firstCharge.toISOString(),
          subscription_meta: {
            return_url: `${frontendUrl}/authorize-mandate?done=1`,
            notification_channel: ['SMS', 'EMAIL'],
          },
          subscription_tags: extraNotes,
        },
        { headers: cashfreeSubscriptionHeaders(creds.appId, creds.secret) },
      );
      return {
        subscriptionId,
        shortUrl: cashfreeAuthorizeUrl(frontendUrl, data.subscription_session_id, sandbox),
      };
    } catch (err) {
      const reason = axios.isAxiosError(err)
        ? ((err.response?.data as { message?: string } | undefined)?.message ?? err.message)
        : err instanceof Error
          ? err.message
          : String(err);
      this.logger.error(`Cashfree subscription create failed: ${reason}`);
      throw new ForbiddenException(ErrorMessages.payments.paymentLinkFailed(reason));
    }
  }

  // Creates a Razorpay payment link. Test vs live is decided entirely by the
  // configured key, so a test key yields a test link (no real money).
  private async createPaymentLink(
    creds: { keyId: string; keySecret: string },
    amount: number,
    currency: string,
    leadId: string,
    customer: { name: string; email?: string; contact: string },
    extraNotes?: Record<string, string>,
  ): Promise<{ id: string; short_url: string }> {
    try {
      const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
      const plink = (
        rzp as unknown as {
          paymentLink: { create: (data: unknown) => Promise<{ id: string; short_url: string }> };
        }
      ).paymentLink;
      return await plink.create({
        amount: Math.round(amount * 100),
        currency,
        description: 'Course enrollment',
        customer,
        notify: { sms: true, email: true },
        reminder_enable: true,
        // extraNotes is echoed back verbatim on every webhook event for this link —
        // handleWebhook reads it to correlate events for links that never create a
        // Payment row (e.g. registration-fee links), since notes.leadId here is really
        // just referenceId and isn't matched against anything.
        notes: { leadId, ...extraNotes },
      });
    } catch (err) {
      const reason = this.razorpayErrorReason(err);
      this.logger.error(`Razorpay payment link create failed: ${reason}`);
      throw new ForbiddenException(ErrorMessages.payments.paymentLinkFailed(reason));
    }
  }

  // Creates a Cashfree payment link. Sandbox vs production is decided by the App ID (see
  // cashfreeBaseUrl). Cashfree has no SDK call we need — it is a single REST request.
  private async createCashfreeLink(
    creds: { appId: string; secret: string },
    amount: number,
    currency: string,
    referenceId: string,
    customer: { name: string; email?: string; contact: string },
    extraNotes?: Record<string, string>,
  ): Promise<{ id: string; shortUrl: string }> {
    // link_id must be unique, alphanumeric/-/_, max 50 chars — the lead/invoice id can't be
    // used directly because the same lead gets many links over time.
    const linkId = `gx_${crypto.randomUUID().replaceAll('-', '')}`;
    const apiUrl = process.env.API_URL ?? '';
    try {
      const { data } = await axios.post<{ link_id: string; link_url: string }>(
        `${cashfreeBaseUrl(creds.appId, creds.secret)}/links`,
        {
          link_id: linkId,
          link_amount: amount,
          link_currency: currency,
          link_purpose: 'Course enrollment',
          customer_details: {
            customer_name: customer.name,
            customer_email: customer.email,
            // Cashfree takes the bare 10-digit Indian mobile number, not E.164.
            customer_phone: customer.contact.replace(/\D/g, '').slice(-10),
          },
          link_notify: { send_sms: true, send_email: true },
          link_auto_reminders: true,
          // Cashfree only accepts an HTTPS notify_url, so it is skipped for local http dev.
          link_meta: apiUrl.startsWith('https://')
            ? { notify_url: `${apiUrl}/api/v1/payments/webhook/CASHFREE` }
            : undefined,
          // Echoed back on every webhook for this link — same role as Razorpay's notes.
          link_notes: { leadId: referenceId, ...extraNotes },
        },
        { headers: cashfreeHeaders(creds.appId, creds.secret) },
      );
      return { id: data.link_id, shortUrl: data.link_url };
    } catch (err) {
      const reason = axios.isAxiosError(err)
        ? ((err.response?.data as { message?: string } | undefined)?.message ?? err.message)
        : err instanceof Error
          ? err.message
          : String(err);
      this.logger.error(`Cashfree payment link create failed: ${reason}`);
      throw new ForbiddenException(ErrorMessages.payments.paymentLinkFailed(reason));
    }
  }

  // Prefers the org's own connected Cashfree account (OrgIntegration); falls back to the
  // platform's (CASHFREE_APP_ID / CASHFREE_SECRET_KEY) for orgs that haven't connected their own.
  private async resolveCashfreeCredentials(orgId?: string): Promise<{ appId: string; secret: string } | null> {
    if (orgId) {
      const integration = await this.prisma.orgIntegration.findUnique({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.CASHFREE } },
      });
      if (integration?.status === IntegrationStatus.CONNECTED && integration.accountId && integration.accessToken) {
        try {
          return { appId: integration.accountId, secret: decryptToken(integration.accessToken) };
        } catch (err) {
          this.logger.error(
            `Failed to decrypt Cashfree secret key for org ${orgId}`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
    if (process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY) {
      return { appId: process.env.CASHFREE_APP_ID, secret: process.env.CASHFREE_SECRET_KEY };
    }
    return null;
  }

  // Pulls a human-readable reason out of a Razorpay SDK error so failures are
  // diagnosable (e.g. "Authentication failed") instead of an opaque 403.
  private razorpayErrorReason(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as { error?: { description?: string }; statusCode?: number; message?: string };
      return e.error?.description ?? e.message ?? (e.statusCode ? `HTTP ${e.statusCode}` : 'unknown error');
    }
    return err instanceof Error ? err.message : String(err);
  }

  // Prefers the org's own connected Razorpay account (OrgIntegration); falls back to the
  // platform's Razorpay (same env vars BillingService uses for subscriptions) for orgs that
  // haven't connected their own. Mirrors CommunicationsService.resolveEmailCredentials.
  private async resolveRazorpayCredentials(orgId?: string): Promise<{ keyId: string; keySecret: string } | null> {
    if (orgId) {
      const integration = await this.prisma.orgIntegration.findUnique({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.RAZORPAY } },
      });
      if (integration?.status === IntegrationStatus.CONNECTED && integration.accountId && integration.accessToken) {
        try {
          return { keyId: integration.accountId, keySecret: decryptToken(integration.accessToken) };
        } catch (err) {
          this.logger.error(
            `Failed to decrypt Razorpay key secret for org ${orgId}`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      return { keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET };
    }
    return null;
  }

  // Unlike the Key Secret above, the webhook secret is generated by GenXCRM (see
  // IntegrationsConfigService.ensureRazorpayWebhookSecret), not supplied by the org, so it's
  // stored in plaintext (same as the generic-webhook/Google Ads webhook secrets) and usable
  // independent of the Key ID/Secret connection status.
  private async resolveRazorpayWebhookSecret(orgId?: string): Promise<string | null> {
    if (orgId) {
      const integration = await this.prisma.orgIntegration.findUnique({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.RAZORPAY } },
      });
      if (integration?.webhookSecret) return integration.webhookSecret;
    }
    return process.env.RAZORPAY_WEBHOOK_SECRET ?? null;
  }

  // caller is omitted for the internal webhook path, which resolves the payment via
  // a Razorpay-signed gatewayOrderId match — already trusted, no caller to scope by.
  async markPaid(paymentId: string, gatewayPaymentId: string, caller?: AuthUser) {
    if (caller) {
      const inScope = await this.prisma.payment.findFirst({
        where: { id: paymentId, lead: buildLeadScopeFilter(caller) },
        select: { id: true },
      });
      if (!inScope) throw new NotFoundException(ErrorMessages.payments.paymentNotFound);
    }

    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.PAID, gatewayPaymentId, paidAt: new Date() },
    });

    // Fire-and-forget the invoice email — a failed/slow send must never block or
    // roll back marking the payment paid. The invoice service is idempotent.
    void this.receipts.sendInvoiceForPayment(paymentId);

    return payment;
  }

  async getById(id: string, caller: AuthUser) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, lead: buildLeadScopeFilter(caller) },
      include: { installments: true, lead: { select: { id: true, name: true, course: true } } },
    });
    if (!payment) throw new NotFoundException(ErrorMessages.payments.paymentNotFound);
    return payment;
  }

  async getByLead(leadId: string, caller: AuthUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.payments.leadNotFound);

    return this.prisma.payment.findMany({
      where: { leadId },
      include: { installments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async handleWebhook(
    gateway: PaymentGateway,
    rawBody: Buffer,
    signature: string,
    payload: Record<string, unknown>,
    timestamp = '',
  ) {
    if (gateway === PaymentGateway.CASHFREE) {
      if (typeof payload.type === 'string' && payload.type.startsWith('SUBSCRIPTION_')) {
        await this.handleCashfreeSubscriptionWebhook(rawBody, signature, timestamp, payload);
        return;
      }
      await this.handleCashfreeWebhook(rawBody, signature, timestamp, payload);
      return;
    }
    if (gateway !== PaymentGateway.RAZORPAY) return;

    const event = payload.event as string | undefined;
    const subscriptionEvents = new Set([
      'subscription.activated',
      'subscription.authenticated',
      'subscription.charged',
      'subscription.halted',
      'subscription.cancelled',
      'subscription.completed',
    ]);

    if (event && subscriptionEvents.has(event)) {
      await this.handleSubscriptionWebhook(event, rawBody, signature, payload);
      return;
    }

    if (event !== 'payment_link.paid') return;

    const entity = (e: string) => {
      const p = payload.payload as Record<string, unknown> | undefined;
      const node = p?.[e] as { entity?: Record<string, unknown> } | undefined;
      return node?.entity;
    };

    const linkId = entity('payment_link')?.id as string | undefined;
    if (!linkId) return;

    // Looked up before signature verification because which secret to verify against
    // (the owning org's own, vs the platform's) depends on which org the payment belongs to.
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId: linkId },
      include: { lead: { select: { orgId: true } } },
    });

    // Registration-fee links never create a Payment row (see InvoicesService's
    // sendRegistrationPaymentLink), so they're correlated via the notes echoed back on
    // the link instead — see createPaymentLink's extraNotes.
    const notes = entity('payment_link')?.notes as Record<string, unknown> | undefined;
    const registrationInvoiceId =
      !payment && notes?.kind === 'REGISTRATION_FEE' ? (notes.invoiceId as string | undefined) : undefined;
    const registrationInvoice = registrationInvoiceId
      ? await this.prisma.invoice.findUnique({ where: { id: registrationInvoiceId }, select: { id: true, orgId: true } })
      : null;

    const secret = await this.resolveRazorpayWebhookSecret(
      payment?.lead?.orgId ?? registrationInvoice?.orgId ?? undefined,
    );
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const expBuf = Buffer.from(expected, 'hex');
      const sigBuf = Buffer.from(signature ?? '', 'hex');
      const valid = expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
      if (!valid) throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);
    }

    if (registrationInvoice) {
      await this.prisma.invoice.updateMany({
        where: { id: registrationInvoice.id, registrationFeePaidAt: null },
        data: { registrationFeePaidAt: new Date() },
      });
      return;
    }

    if (!payment || payment.status === PaymentStatus.PAID) return;

    const gatewayPaymentId = (entity('payment')?.id as string | undefined) ?? '';
    await this.markPaid(payment.id, gatewayPaymentId);
  }

  // Cashfree signs every webhook with the merchant's own Secret Key (there is no separate
  // webhook secret): base64(HMAC-SHA256(timestamp + rawBody)). Unlike the Razorpay link path,
  // verification is mandatory — a paid event writes financial state, so no resolvable secret
  // means the event is rejected rather than trusted.
  private async handleCashfreeWebhook(
    rawBody: Buffer,
    signature: string,
    timestamp: string,
    payload: Record<string, unknown>,
  ) {
    // Payment-link events carry the link under `data`; tolerate a flat payload too.
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const linkId = data.link_id as string | undefined;
    if (!linkId) return;

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId: linkId },
      include: { lead: { select: { orgId: true } } },
    });
    const notes = data.link_notes as Record<string, unknown> | undefined;
    const registrationInvoiceId =
      !payment && notes?.kind === 'REGISTRATION_FEE' ? (notes.invoiceId as string | undefined) : undefined;
    const registrationInvoice = registrationInvoiceId
      ? await this.prisma.invoice.findUnique({ where: { id: registrationInvoiceId }, select: { id: true, orgId: true } })
      : null;
    if (!payment && !registrationInvoice) return;

    const creds = await this.resolveCashfreeCredentials(payment?.lead?.orgId ?? registrationInvoice?.orgId ?? undefined);
    if (!creds || !signature || !timestamp) {
      this.logger.error(`Cashfree webhook for link ${linkId} rejected: missing credentials, signature or timestamp`);
      throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);
    }
    const expected = Buffer.from(
      crypto.createHmac('sha256', creds.secret).update(`${timestamp}${rawBody.toString('utf8')}`).digest('base64'),
    );
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);
    }

    // Only a fully paid link counts — PARTIALLY_PAID / EXPIRED / CANCELLED are acknowledged
    // and ignored.
    const isPaid = data.link_status === 'PAID' || payload.event === 'PAYMENT_LINK_PAID';
    if (!isPaid) return;

    if (registrationInvoice) {
      await this.prisma.invoice.updateMany({
        where: { id: registrationInvoice.id, registrationFeePaidAt: null },
        data: { registrationFeePaidAt: new Date() },
      });
      return;
    }

    if (!payment || payment.status === PaymentStatus.PAID) return;
    const order = data.order as { transaction_id?: string | number } | undefined;
    const gatewayPaymentId = String(order?.transaction_id ?? data.cf_link_id ?? linkId);
    await this.markPaid(payment.id, gatewayPaymentId);
  }

  // Cashfree SUBSCRIPTION_* events. Same correlation as Razorpay (emiGatewaySubscriptionId) and
  // the same fail-closed rule: these write financial state, so an unverifiable event is rejected.
  private async handleCashfreeSubscriptionWebhook(
    rawBody: Buffer,
    signature: string,
    timestamp: string,
    payload: Record<string, unknown>,
  ) {
    const data = (payload.data as Record<string, unknown> | undefined) ?? {};
    const details = data.subscription_details as Record<string, unknown> | undefined;
    const subscriptionId = (details?.subscription_id ?? data.subscription_id) as string | undefined;
    if (!subscriptionId) return;

    const invoice = await this.prisma.invoice.findFirst({
      where: { emiGatewaySubscriptionId: subscriptionId },
      select: { id: true, orgId: true, emiMandateStatus: true },
    });
    if (!invoice) return;

    const creds = await this.resolveCashfreeCredentials(invoice.orgId ?? undefined);
    if (!creds || !signature || !timestamp) {
      this.logger.error(
        `Cashfree subscription webhook for invoice ${invoice.id} rejected: missing credentials, signature or timestamp`,
      );
      throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);
    }
    const expected = Buffer.from(
      crypto.createHmac('sha256', creds.secret).update(`${timestamp}${rawBody.toString('utf8')}`).digest('base64'),
    );
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);
    }

    const type = payload.type as string;
    if (type === 'SUBSCRIPTION_STATUS_CHANGED') {
      const statusByCashfree: Record<string, EmiMandateStatus> = {
        ACTIVE: 'ACTIVE',
        BANK_APPROVAL_PENDING: 'AUTHENTICATED',
        COMPLETED: 'COMPLETED',
        CANCELLED: 'CANCELLED',
        CUSTOMER_CANCELLED: 'CANCELLED',
        EXPIRED: 'CANCELLED',
        LINK_EXPIRED: 'CANCELLED',
        ON_HOLD: 'HALTED',
        CUSTOMER_PAUSED: 'HALTED',
        CARD_EXPIRED: 'HALTED',
      };
      const next = statusByCashfree[String(details?.subscription_status ?? '')];
      if (next) await this.prisma.invoice.update({ where: { id: invoice.id }, data: { emiMandateStatus: next } });
      return;
    }

    // Authorisation went through (mandate registered) — never downgrade an already ACTIVE one.
    if (type === 'SUBSCRIPTION_AUTH_STATUS') {
      if (data.payment_status === 'SUCCESS' && invoice.emiMandateStatus === 'CREATED') {
        await this.prisma.invoice.update({ where: { id: invoice.id }, data: { emiMandateStatus: 'AUTHENTICATED' } });
      }
      return;
    }

    // A real charge succeeded: mark the earliest unpaid installment that was due by the charge's
    // scheduled date as paid. eNACH charges can land several days after the installment's due
    // date (Cashfree needs lead time), so a generous window is used; a retried webhook is still
    // idempotent because the next installment is a month later, outside that window.
    if (type === 'SUBSCRIPTION_PAYMENT_SUCCESS' && data.payment_type === 'CHARGE') {
      const scheduled = data.payment_schedule_date ? new Date(String(data.payment_schedule_date)) : new Date();
      const dueBy = new Date(scheduled.getTime() + 7 * 24 * 60 * 60 * 1000);
      const installment = await this.prisma.emiInstallment.findFirst({
        where: { invoiceId: invoice.id, status: { not: 'PAID' }, dueDate: { lte: dueBy } },
        orderBy: { installmentNumber: 'asc' },
        select: { id: true },
      });
      if (installment) {
        await this.prisma.emiInstallment.update({
          where: { id: installment.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
      if (invoice.emiMandateStatus !== 'ACTIVE') {
        await this.prisma.invoice.update({ where: { id: invoice.id }, data: { emiMandateStatus: 'ACTIVE' } });
      }
    }
  }

  // subscription.* events correlate to an invoice via emiGatewaySubscriptionId (set by
  // InvoicesService.createEmiMandate when the mandate is created), not via the notes field —
  // a Subscription's notes aren't echoed on every event the way a Payment Link's are.
  private async handleSubscriptionWebhook(
    event: string,
    rawBody: Buffer,
    signature: string,
    payload: Record<string, unknown>,
  ) {
    const p = payload.payload as Record<string, unknown> | undefined;
    const subEntity = (p?.subscription as { entity?: Record<string, unknown> } | undefined)?.entity;
    const subscriptionId = subEntity?.id as string | undefined;
    if (!subscriptionId) return;

    const invoice = await this.prisma.invoice.findFirst({
      where: { emiGatewaySubscriptionId: subscriptionId },
      select: { id: true, orgId: true },
    });
    if (!invoice) return;

    // Unlike the pre-existing payment_link.paid path, a subscription event performs a
    // financial-state write (marking EmiInstallment rows PAID) — an unauthenticated caller
    // who knows/guesses a `sub_*` id must not be able to trigger that. Fail closed: no
    // resolvable secret (no org integration AND no platform RAZORPAY_WEBHOOK_SECRET) means
    // the event is rejected outright, not trusted.
    const secret = await this.resolveRazorpayWebhookSecret(invoice.orgId);
    if (!secret) {
      this.logger.error(
        `Subscription webhook for invoice ${invoice.id} (subscription ${subscriptionId}) received with no resolvable webhook secret — rejecting rather than trusting an unverified financial-state write`,
      );
      throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);
    }
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expBuf = Buffer.from(expected, 'hex');
    const sigBuf = Buffer.from(signature ?? '', 'hex');
    const valid = expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
    if (!valid) throw new UnauthorizedException(ErrorMessages.payments.invalidWebhookSignature);

    const statusByEvent: Record<string, EmiMandateStatus> = {
      'subscription.activated': 'ACTIVE',
      'subscription.authenticated': 'AUTHENTICATED',
      'subscription.charged': 'ACTIVE',
      'subscription.halted': 'HALTED',
      'subscription.cancelled': 'CANCELLED',
      'subscription.completed': 'COMPLETED',
    };
    const nextStatus = statusByEvent[event];
    if (nextStatus) {
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { emiMandateStatus: nextStatus } });
    }

    if (event === 'subscription.charged') {
      const paidCount = subEntity?.paid_count as number | undefined;
      if (paidCount && paidCount > 0) {
        // <= rather than === so one missed webhook self-heals on the next successful event
        // instead of leaving that installment PENDING forever — the `status: { not: 'PAID' }`
        // guard keeps this idempotent (an already-PAID row is never re-touched).
        await this.prisma.emiInstallment.updateMany({
          where: { invoiceId: invoice.id, installmentNumber: { lte: paidCount }, status: { not: 'PAID' } },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
    }
  }

  async getDashboard(caller: AuthUser) {
    const scopeFilter: Prisma.PaymentWhereInput = { lead: buildLeadScopeFilter(caller) };

    const [collected, pending, overdueCount, byStatus, byGatewayRaw] = await Promise.all([
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: PaymentStatus.PAID, ...scopeFilter } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: { not: PaymentStatus.PAID }, ...scopeFilter },
      }),
      this.prisma.payment.count({ where: { status: PaymentStatus.OVERDUE, ...scopeFilter } }),
      this.prisma.payment.groupBy({ by: ['status'], _count: { status: true }, where: scopeFilter }),
      this.prisma.payment.groupBy({
        by: ['gateway'],
        _sum: { amount: true },
        where: { status: PaymentStatus.PAID, ...scopeFilter },
      }),
    ]);

    const gatewayTotal = byGatewayRaw.reduce((sum, g) => sum + (g._sum.amount ?? 0), 0);
    const byGateway = byGatewayRaw.map((g) => ({
      gateway: g.gateway,
      total: g._sum.amount ?? 0,
      pct: gatewayTotal > 0 ? Math.round(((g._sum.amount ?? 0) / gatewayTotal) * 1000) / 10 : 0,
    }));

    return {
      totalCollected: collected._sum.amount ?? 0,
      totalPending: pending._sum.amount ?? 0,
      overdueCount,
      byStatus,
      byGateway,
    };
  }

  async getRevenueMonthly(months: number, caller: AuthUser) {
    const scopeFilter: Prisma.PaymentWhereInput = { lead: buildLeadScopeFilter(caller) };
    const now = new Date();
    const rangeStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const payments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.PAID, paidAt: { gte: rangeStart }, ...scopeFilter },
      select: { amount: true, paidAt: true },
    });

    const buckets = Array.from({ length: months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, month: d, revenue: 0 };
    });

    for (const payment of payments) {
      if (!payment.paidAt) continue;
      const key = `${payment.paidAt.getFullYear()}-${String(payment.paidAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.find((b) => b.key === key);
      if (bucket) bucket.revenue += payment.amount;
    }

    return buckets.map((b) => ({
      month: b.month.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      revenue: Math.round(b.revenue),
      isCurrent: b.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    }));
  }

  async getUpcomingInstallments(days: number, caller: AuthUser) {
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const installments = await this.prisma.installment.findMany({
      where: {
        status: { not: PaymentStatus.PAID },
        dueDate: { gte: now, lte: until },
        payment: { lead: buildLeadScopeFilter(caller) },
      },
      include: {
        payment: {
          select: {
            id: true,
            lead: { select: { id: true, name: true, course: true } },
            installments: { select: { id: true, dueDate: true } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return installments.map((inst) => {
      const siblings = [...inst.payment.installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      return {
        id: inst.id,
        paymentId: inst.payment.id,
        amount: inst.amount,
        dueDate: inst.dueDate,
        lead: inst.payment.lead,
        emiNumber: siblings.findIndex((s) => s.id === inst.id) + 1,
        totalEmis: siblings.length,
      };
    });
  }

  async list(
    query: { status?: PaymentStatus; sortBy?: string; sortOrder?: 'asc' | 'desc'; page?: number; limit?: number },
    caller: AuthUser,
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const sortBy = query.sortBy === 'amount' || query.sortBy === 'dueDate' ? query.sortBy : 'createdAt';

    const where: Prisma.PaymentWhereInput = {
      lead: buildLeadScopeFilter(caller),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select: {
          id: true,
          amount: true,
          currency: true,
          gateway: true,
          status: true,
          paymentLink: true,
          paidAt: true,
          dueDate: true,
          createdAt: true,
          lead: { select: { id: true, name: true, course: true } },
        },
        orderBy: { [sortBy]: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
