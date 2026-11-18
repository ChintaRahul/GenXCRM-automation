import { Test } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { IntegrationProvider, IntegrationStatus, PaymentGateway, PaymentStatus, Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentReceiptsService } from '../payment-receipts/payment-receipts.service';
import type { AuthUser } from '../../common/types/auth-user.type';

jest.mock('../../common/crypto.utils', () => ({
  encryptToken: jest.fn((t: string) => `enc:${t}`),
  decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')),
}));

// Mock the Razorpay SDK so the constructor needs no real keys and paymentLink.create is controllable.
const mockRzpInstance = {
  paymentLink: {
    create: jest.fn().mockResolvedValue({ id: 'plink_1', short_url: 'https://rzp.io/i/abc' }),
  },
  plans: {
    create: jest.fn().mockResolvedValue({ id: 'plan_1' }),
  },
  subscriptions: {
    create: jest.fn().mockResolvedValue({ id: 'sub_1', short_url: 'https://rzp.io/i/sub-abc' }),
  },
};
const mockRzpConstructor = jest.fn().mockImplementation(() => mockRzpInstance);
jest.mock('razorpay', () => jest.fn().mockImplementation((...args: unknown[]) => mockRzpConstructor(...args)));

const mockPrisma = {
  lead: { findFirst: jest.fn() },
  payment: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  installment: {
    findMany: jest.fn(),
  },
  orgIntegration: {
    findUnique: jest.fn(),
  },
  invoice: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  emiInstallment: {
    updateMany: jest.fn(),
  },
};

const mockReceipts = { sendInvoiceForPayment: jest.fn().mockResolvedValue(undefined) };

const mockLead = { id: 'lead-1', name: 'John', email: 'john@example.com', phone: '9999999999' };

const repUser: AuthUser = {
  id: 'rep-1',
  name: 'Rep',
  email: 'rep@t.com',
  role: Role.SALES_REP,
  teamId: 'team-1',
  orgId: 'org-1',
};
const managerUser: AuthUser = {
  id: 'mgr-1',
  name: 'Mgr',
  email: 'mgr@t.com',
  role: Role.MANAGER,
  teamId: 'team-1',
  orgId: 'org-1',
};
const directorUser: AuthUser = {
  id: 'dir-1',
  name: 'Dir',
  email: 'dir@t.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentReceiptsService, useValue: mockReceipts },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  afterAll(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  describe('createPayment', () => {
    it('throws NotFoundException when lead does not exist', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(
        service.createPayment({ leadId: 'bad', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the lead is outside the caller scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(
        service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, repUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'lead-1', assignedToId: 'rep-1' }),
        }),
      );
    });

    it('creates a payment link and a LINK_SENT payment with the link id + url', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      await service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser);
      expect(mockRzpInstance.paymentLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500000, currency: 'INR' }),
      );
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: 'INR',
            status: PaymentStatus.LINK_SENT,
            gatewayOrderId: 'plink_1',
            paymentLink: 'https://rzp.io/i/abc',
          }),
        }),
      );
    });

    it('formats the lead phone as E.164 with country code for the Razorpay contact field', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      await service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser);
      expect(mockRzpInstance.paymentLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: expect.objectContaining({ contact: '+919999999999' }) }),
      );
    });

    it('throws when Razorpay is not configured', async () => {
      delete process.env.RAZORPAY_KEY_ID;
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      await expect(
        service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it("uses the org's own connected Razorpay credentials over the platform's", async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accountId: 'rzp_org_key',
        accessToken: 'enc:org_secret',
      });

      await service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser);

      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith({
        where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.RAZORPAY } },
      });
      expect(mockRzpConstructor).toHaveBeenCalledWith({ key_id: 'rzp_org_key', key_secret: 'org_secret' });
    });

    it("falls back to the platform's Razorpay key when the org's integration isn't CONNECTED", async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.DISCONNECTED,
        accountId: 'rzp_org_key',
        accessToken: 'enc:org_secret',
      });

      await service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser);

      expect(mockRzpConstructor).toHaveBeenCalledWith({ key_id: 'rzp_test_key', key_secret: 'test_secret' });
    });

    it('defaults includeGstNumber to true', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.payment.create.mockResolvedValue({});
      await service.createPayment({ leadId: 'lead-1', amount: 5000, gateway: PaymentGateway.RAZORPAY }, directorUser);
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ includeGstNumber: true }) }),
      );
    });

    it('persists includeGstNumber=false when the rep opts out', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.payment.create.mockResolvedValue({});
      await service.createPayment(
        {
          leadId: 'lead-1',
          amount: 5000,
          gateway: PaymentGateway.RAZORPAY,
          includeGstNumber: false,
        },
        directorUser,
      );
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ includeGstNumber: false }) }),
      );
    });
  });

  describe('isRazorpayConnected', () => {
    it('returns true when the platform fallback key is set and no org is given', async () => {
      await expect(service.isRazorpayConnected(undefined)).resolves.toBe(true);
    });

    it('returns false when neither the org nor the platform has credentials', async () => {
      delete process.env.RAZORPAY_KEY_ID;
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.isRazorpayConnected('org-1')).resolves.toBe(false);
    });

    it("returns true when the org's own Razorpay integration is CONNECTED", async () => {
      delete process.env.RAZORPAY_KEY_ID;
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accountId: 'rzp_org_key',
        accessToken: 'enc:org_secret',
      });
      await expect(service.isRazorpayConnected('org-1')).resolves.toBe(true);
    });
  });

  describe('createRazorpayLink', () => {
    it('throws ForbiddenException when Razorpay is not configured', async () => {
      delete process.env.RAZORPAY_KEY_ID;
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(
        service.createRazorpayLink('org-1', 1000, 'INR', 'inv-1', { name: 'John', contact: '+919999999999' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a link and returns its id and shortUrl', async () => {
      const result = await service.createRazorpayLink('org-1', 1000, 'INR', 'inv-1', {
        name: 'John',
        contact: '+919999999999',
      });
      expect(mockRzpInstance.paymentLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100000, currency: 'INR' }),
      );
      expect(result).toEqual({ id: 'plink_1', shortUrl: 'https://rzp.io/i/abc' });
    });
  });

  describe('createRazorpaySubscription', () => {
    it('creates a Razorpay plan then a subscription against it, and returns the subscription id + short url', async () => {
      const result = await service.createRazorpaySubscription(
        undefined,
        5000,
        'INR',
        6,
        { name: 'John', email: 'john@example.com', contact: '+919999999999' },
        { invoiceId: 'inv-1', kind: 'EMI_MANDATE' },
      );

      expect(mockRzpInstance.plans.create).toHaveBeenCalledWith({
        period: 'monthly',
        interval: 1,
        item: { name: 'Course EMI', amount: 500000, currency: 'INR' },
      });
      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith({
        plan_id: 'plan_1',
        total_count: 6,
        customer_notify: true,
        notify_info: { notify_phone: '+919999999999', notify_email: 'john@example.com' },
        notes: { invoiceId: 'inv-1', kind: 'EMI_MANDATE' },
      });
      expect(result).toEqual({ subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/sub-abc' });
    });

    it('throws ForbiddenException when Razorpay is not configured', async () => {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      await expect(
        service.createRazorpaySubscription(undefined, 5000, 'INR', 6, {
          name: 'John',
          contact: '+919999999999',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('wraps a Razorpay SDK failure in a ForbiddenException with a readable reason', async () => {
      mockRzpInstance.plans.create.mockRejectedValueOnce({ error: { description: 'Invalid amount' } });
      await expect(
        service.createRazorpaySubscription(undefined, 5000, 'INR', 6, {
          name: 'John',
          contact: '+919999999999',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markPaid', () => {
    it('updates payment status to PAID and triggers the invoice when called without a caller (webhook path)', async () => {
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-1' });
      await service.markPaid('pay-1', 'gw-pay-123');
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: expect.objectContaining({ status: PaymentStatus.PAID, gatewayPaymentId: 'gw-pay-123' }),
      });
      expect(mockReceipts.sendInvoiceForPayment).toHaveBeenCalledWith('pay-1');
    });

    it('verifies the payment is in the caller scope before updating', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-1' });
      await service.markPaid('pay-1', 'gw-pay-123', directorUser);
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'pay-1', lead: { orgId: 'org-1' } }) }),
      );
      expect(mockPrisma.payment.update).toHaveBeenCalled();
    });

    it('throws NotFoundException when the payment is outside the caller scope', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      await expect(service.markPaid('pay-1', 'gw-pay-123', repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    const paidPayload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_1' } },
        payment: { entity: { id: 'pay_rzp_1' } },
      },
    };
    const raw = Buffer.from(JSON.stringify(paidPayload));

    it('returns early for non-Razorpay gateway', async () => {
      await service.handleWebhook(PaymentGateway.STRIPE, raw, '', {});
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
    });

    it('marks the payment paid on payment_link.paid (matched by link id)', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1', status: PaymentStatus.LINK_SENT });
      mockPrisma.payment.update.mockResolvedValue({});
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, '', paidPayload);
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
        where: { gatewayOrderId: 'plink_1' },
        include: { lead: { select: { orgId: true } } },
      });
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1' },
          data: expect.objectContaining({ status: PaymentStatus.PAID }),
        }),
      );
    });

    it('rejects an invalid signature when a webhook secret is set', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
      await expect(service.handleWebhook(PaymentGateway.RAZORPAY, raw, 'deadbeef', paidPayload)).rejects.toThrow(
        UnauthorizedException,
      );
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('accepts a valid signature when a webhook secret is set', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
      const sig = crypto.createHmac('sha256', 'whsec').update(raw).digest('hex');
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1', status: PaymentStatus.LINK_SENT });
      mockPrisma.payment.update.mockResolvedValue({});
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, sig, paidPayload);
      expect(mockPrisma.payment.update).toHaveBeenCalled();
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it("verifies against the owning org's own webhook secret when connected, not the platform's", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'platform-whsec';
      mockPrisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.LINK_SENT,
        lead: { orgId: 'org-1' },
      });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        webhookSecret: 'org-whsec',
      });
      mockPrisma.payment.update.mockResolvedValue({});

      const orgSig = crypto.createHmac('sha256', 'org-whsec').update(raw).digest('hex');
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, orgSig, paidPayload);
      expect(mockPrisma.payment.update).toHaveBeenCalled();

      // The platform secret must NOT validate this org's payload once the org has its own.
      mockPrisma.payment.update.mockClear();
      const platformSig = crypto.createHmac('sha256', 'platform-whsec').update(raw).digest('hex');
      await expect(service.handleWebhook(PaymentGateway.RAZORPAY, raw, platformSig, paidPayload)).rejects.toThrow(
        UnauthorizedException,
      );

      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    const registrationPayload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: { id: 'plink_reg_1', notes: { invoiceId: 'inv-1', kind: 'REGISTRATION_FEE' } },
        },
        payment: { entity: { id: 'pay_rzp_1' } },
      },
    };
    const regRaw = Buffer.from(JSON.stringify(registrationPayload));

    it('marks the invoice registration fee paid when no Payment row matches but notes tag REGISTRATION_FEE', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      await service.handleWebhook(PaymentGateway.RAZORPAY, regRaw, '', registrationPayload);

      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', registrationFeePaidAt: null },
        data: { registrationFeePaidAt: expect.any(Date) },
      });
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    });

    it("verifies the registration fee link against the invoice's own org webhook secret", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'platform-whsec';
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        webhookSecret: 'org-whsec',
      });
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      const orgSig = crypto.createHmac('sha256', 'org-whsec').update(regRaw).digest('hex');
      await service.handleWebhook(PaymentGateway.RAZORPAY, regRaw, orgSig, registrationPayload);
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalled();

      mockPrisma.invoice.updateMany.mockClear();
      const platformSig = crypto.createHmac('sha256', 'platform-whsec').update(regRaw).digest('hex');
      await expect(
        service.handleWebhook(PaymentGateway.RAZORPAY, regRaw, platformSig, registrationPayload),
      ).rejects.toThrow(UnauthorizedException);

      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('ignores notes without kind=REGISTRATION_FEE when no Payment row matches', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      const otherNotesPayload = {
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_2', notes: { invoiceId: 'inv-1', kind: 'EMI' } } },
          payment: { entity: { id: 'pay_rzp_1' } },
        },
      };
      await service.handleWebhook(
        PaymentGateway.RAZORPAY,
        Buffer.from(JSON.stringify(otherNotesPayload)),
        '',
        otherNotesPayload,
      );
      expect(mockPrisma.invoice.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
    });

    const subscriptionPayload = (event: string, extra: Record<string, unknown> = {}) => ({
      event,
      payload: {
        subscription: {
          entity: { id: 'sub_1', status: 'active', paid_count: 2, ...extra },
        },
      },
    });

    it('activates the mandate on subscription.activated, correlated by subscription id', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'sub-whsec';
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      mockPrisma.invoice.update.mockResolvedValue({});

      const payload = subscriptionPayload('subscription.activated');
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = crypto.createHmac('sha256', 'sub-whsec').update(raw).digest('hex');
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, sig, payload);

      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith({
        where: { emiGatewaySubscriptionId: 'sub_1' },
        select: { id: true, orgId: true },
      });
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { emiMandateStatus: 'ACTIVE' },
      });
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('marks the installment matching paid_count as PAID on subscription.charged', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'sub-whsec';
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.emiInstallment.updateMany.mockResolvedValue({ count: 1 });

      const payload = subscriptionPayload('subscription.charged', { paid_count: 2 });
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = crypto.createHmac('sha256', 'sub-whsec').update(raw).digest('hex');
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, sig, payload);

      // <= paidCount (not === ) so one missed webhook self-heals on the next successful event.
      expect(mockPrisma.emiInstallment.updateMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-1', installmentNumber: { lte: 2 }, status: { not: 'PAID' } },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('marks the mandate HALTED on subscription.halted', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'sub-whsec';
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      mockPrisma.invoice.update.mockResolvedValue({});

      const payload = subscriptionPayload('subscription.halted');
      const raw = Buffer.from(JSON.stringify(payload));
      const sig = crypto.createHmac('sha256', 'sub-whsec').update(raw).digest('hex');
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, sig, payload);

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { emiMandateStatus: 'HALTED' },
      });
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('ignores subscription events for an unknown subscription id', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      const payload = subscriptionPayload('subscription.activated');
      await service.handleWebhook(PaymentGateway.RAZORPAY, Buffer.from(JSON.stringify(payload)), '', payload);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('rejects a subscription webhook with UnauthorizedException when no secret resolves at all, without writing anything', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      delete process.env.RAZORPAY_WEBHOOK_SECRET;

      const payload = subscriptionPayload('subscription.charged', { paid_count: 2 });
      await expect(
        service.handleWebhook(PaymentGateway.RAZORPAY, Buffer.from(JSON.stringify(payload)), '', payload),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockPrisma.emiInstallment.updateMany).not.toHaveBeenCalled();
    });

    it("verifies subscription events against the invoice's own org webhook secret", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'platform-whsec';
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        webhookSecret: 'org-whsec',
      });
      mockPrisma.invoice.update.mockResolvedValue({});

      const payload = subscriptionPayload('subscription.activated');
      const raw = Buffer.from(JSON.stringify(payload));
      const orgSig = crypto.createHmac('sha256', 'org-whsec').update(raw).digest('hex');
      await service.handleWebhook(PaymentGateway.RAZORPAY, raw, orgSig, payload);
      expect(mockPrisma.invoice.update).toHaveBeenCalled();

      mockPrisma.invoice.update.mockClear();
      const platformSig = crypto.createHmac('sha256', 'platform-whsec').update(raw).digest('hex');
      await expect(service.handleWebhook(PaymentGateway.RAZORPAY, raw, platformSig, payload)).rejects.toThrow(
        UnauthorizedException,
      );

      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });
  });

  describe('getById', () => {
    it('returns the payment with installments and lead when in scope', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1', installments: [], lead: { id: 'lead-1' } });
      const result = await service.getById('pay-1', directorUser);
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1', lead: expect.objectContaining({ orgId: 'org-1' }) },
          include: { installments: true, lead: { select: { id: true, name: true, course: true } } },
        }),
      );
      expect(result).toEqual({ id: 'pay-1', installments: [], lead: { id: 'lead-1' } });
    });

    it('scopes the lookup to assignedToId for SALES_REP', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });
      await service.getById('pay-1', repUser);
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1', lead: expect.objectContaining({ assignedToId: 'rep-1' }) },
        }),
      );
    });

    it('throws NotFoundException when the payment is out of scope', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      await expect(service.getById('pay-1', repUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getByLead', () => {
    it('returns payments ordered by createdAt desc when the lead is in scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.payment.findMany.mockResolvedValue([{ id: 'pay-1' }]);
      const result = await service.getByLead('lead-1', directorUser);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { leadId: 'lead-1' }, orderBy: { createdAt: 'desc' } }),
      );
      expect(result).toHaveLength(1);
    });

    it('scopes the lead lookup to assignedToId for SALES_REP', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.payment.findMany.mockResolvedValue([]);
      await service.getByLead('lead-1', repUser);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'lead-1', assignedToId: 'rep-1' }) }),
      );
    });

    it('throws NotFoundException when the lead is outside the caller scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.getByLead('lead-1', repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getDashboard', () => {
    it('scopes queries to caller orgId for DIRECTOR', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.payment.groupBy.mockResolvedValue([]);
      await service.getDashboard(directorUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { orgId: 'org-1' } }) }),
      );
    });

    it('scopes queries to assignedToId for SALES_REP', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.payment.groupBy.mockResolvedValue([]);
      await service.getDashboard(repUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { orgId: 'org-1', assignedToId: 'rep-1' } }),
        }),
      );
    });

    it('scopes queries to teamId for MANAGER', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.payment.groupBy.mockResolvedValue([]);
      await service.getDashboard(managerUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { orgId: 'org-1', teamId: 'team-1' } }),
        }),
      );
    });

    it('computes byGateway totals and rounded percentages, scoped to org', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.payment.groupBy
        .mockResolvedValueOnce([]) // byStatus
        .mockResolvedValueOnce([
          { gateway: PaymentGateway.RAZORPAY, _sum: { amount: 7500 } },
          { gateway: PaymentGateway.STRIPE, _sum: { amount: 2500 } },
        ]); // byGateway
      const result = await service.getDashboard(directorUser);
      expect(mockPrisma.payment.groupBy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          by: ['gateway'],
          where: expect.objectContaining({ status: PaymentStatus.PAID, lead: { orgId: 'org-1' } }),
        }),
      );
      expect(result.byGateway).toEqual([
        { gateway: PaymentGateway.RAZORPAY, total: 7500, pct: 75 },
        { gateway: PaymentGateway.STRIPE, total: 2500, pct: 25 },
      ]);
    });
  });

  describe('getRevenueMonthly', () => {
    it('buckets PAID payments by month and flags the current month, scoped to org', async () => {
      const now = new Date();
      mockPrisma.payment.findMany.mockResolvedValue([{ amount: 1000, paidAt: now }]);
      const result = await service.getRevenueMonthly(3, directorUser);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: PaymentStatus.PAID, lead: { orgId: 'org-1' } }),
        }),
      );
      expect(result).toHaveLength(3);
      expect(result.at(-1)).toMatchObject({ revenue: 1000, isCurrent: true });
    });

    it('scopes to assignedToId for SALES_REP', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      await service.getRevenueMonthly(6, repUser);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { orgId: 'org-1', assignedToId: 'rep-1' } }),
        }),
      );
    });
  });

  describe('getUpcomingInstallments', () => {
    it('scopes the installment lookup through payment.lead for the caller', async () => {
      mockPrisma.installment.findMany.mockResolvedValue([]);
      await service.getUpcomingInstallments(14, repUser);
      expect(mockPrisma.installment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            payment: { lead: { orgId: 'org-1', assignedToId: 'rep-1' } },
          }),
        }),
      );
    });

    it('derives emiNumber/totalEmis from sibling installments ordered by dueDate', async () => {
      const d1 = new Date('2026-08-10');
      const d2 = new Date('2026-08-20');
      mockPrisma.installment.findMany.mockResolvedValue([
        {
          id: 'inst-2',
          amount: 500,
          dueDate: d2,
          payment: {
            id: 'pay-1',
            lead: { id: 'lead-1', name: 'John', course: 'DM' },
            installments: [
              { id: 'inst-1', dueDate: d1 },
              { id: 'inst-2', dueDate: d2 },
            ],
          },
        },
      ]);
      const result = await service.getUpcomingInstallments(14, directorUser);
      expect(result[0]).toMatchObject({ emiNumber: 2, totalEmis: 2, lead: { id: 'lead-1' } });
    });
  });

  describe('list', () => {
    it('scopes to caller org, applies default paging/sort, and returns lead course/name', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);
      await service.list({}, directorUser);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { orgId: 'org-1' } }),
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('scopes to assignedToId for SALES_REP and filters by status', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);
      await service.list({ status: PaymentStatus.PENDING, page: 2, limit: 10 }, repUser);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: PaymentStatus.PENDING,
            lead: { orgId: 'org-1', assignedToId: 'rep-1' },
          }),
          skip: 10,
          take: 10,
        }),
      );
    });
  });
});
