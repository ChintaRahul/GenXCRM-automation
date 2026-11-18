import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import {
  Prisma,
  AddonType,
  AddonStatus,
  BillingInterval,
  PlanStatus,
  SubscriptionStatus,
  DiscountType,
  CouponRedemptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto';
import type { PurchaseAddonDto } from './dto/purchase-addon.dto';
import type { ConfirmSeatUpdateDto } from './dto/confirm-seat-update.dto';
import { ErrorMessages } from '../../common/constants/messages';

const SEAT_PRORATION_CYCLE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Every org gets a free email/WhatsApp allowance sourced from SubscriptionPlan.features
// (see getApplicablePlanFeatures below) rather than a hardcoded constant — the org's
// subscribed plan if ACTIVE/AUTHENTICATED, otherwise the DB-seeded Trial plan row
// (tier: 'trial'). Email resets every rolling 30-day cycle; WhatsApp is one-time and
// never resets. Both can be topped up with a purchased addon once exhausted.
const EMAIL_CYCLE_DAYS = 30;

const ADDON_PRICES: Record<AddonType, { price: number; credits: number; label: string }> = {
  EMAIL_CREDITS: { price: 200, credits: 5000, label: '5,000 email credits' },
  WHATSAPP_CREDITS: { price: 1000, credits: 1000, label: '1,000 WhatsApp credits' },
};

const ACTIVE_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.AUTHENTICATED];

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  private _rzp?: Razorpay;

  private get rzp(): Razorpay {
    this._rzp ??= new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID ?? 'placeholder',
      key_secret: process.env.RAZORPAY_KEY_SECRET ?? 'placeholder',
    });
    return this._rzp;
  }

  constructor(private readonly prisma: PrismaService) {}

  getPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ tier: 'asc' }, { billingInterval: 'asc' }],
    });
  }

  async subscribe(dto: CreateSubscriptionDto, caller: AuthUser) {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.billing.noOrg);
    if (caller.orgId === process.env.GENXCRM_INTERNAL_ORG_ID) {
      throw new ForbiddenException(ErrorMessages.billing.orgExempt);
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException(ErrorMessages.billing.planNotFound);

    if (!plan.razorpayPlanId) {
      throw new ForbiddenException(ErrorMessages.billing.planNotConfigured);
    }

    const activeUsers = await this.countActiveUsers(caller.orgId);
    if (dto.userCount < activeUsers) {
      throw new ForbiddenException(this.seatCountTooLowError(activeUsers));
    }

    if ((plan.maxUsers && dto.userCount > plan.maxUsers) || dto.userCount < plan.minUsers) {
      throw new ForbiddenException(ErrorMessages.billing.seatCountOutOfRange);
    }

    const coupon = dto.couponCode ? await this.findValidCoupon(dto.couponCode, dto.planId) : null;
    const offerId = coupon ? this.getOfferId(coupon, dto.billingInterval, dto.paymentMethod) : undefined;

    const existing = await this.prisma.orgSubscription.findUnique({ where: { orgId: caller.orgId } });

    const totalCount = dto.billingInterval === BillingInterval.ANNUAL ? 1 : 12;

    let rzpSubId: string;
    try {
      const rzpSub = await this.rzp.subscriptions.create({
        plan_id: plan.razorpayPlanId,
        total_count: totalCount,
        quantity: dto.userCount,
        notify_info: { notify_email: 1 },
        addons: this.buildSetupFeeAddon(plan.setupFee),
        ...(offerId && { offer_id: offerId }),
      } as Parameters<typeof this.rzp.subscriptions.create>[0]);
      rzpSubId = rzpSub.id;
    } catch (err) {
      this.logger.error('Razorpay subscription create failed', err instanceof Error ? err.message : String(err));
      throw new ForbiddenException(ErrorMessages.billing.subscriptionCreateFailed);
    }

    let orgSubscriptionId: string;
    if (existing) {
      // Switching plans (or re-subscribing after a scheduled cancellation): repoint the org's
      // subscription at the new Razorpay subscription + plan. The customer authorises payment for
      // the new plan via checkout, exactly like a first-time subscribe — no cancel-first required.
      orgSubscriptionId = existing.id;
      await this.prisma.orgSubscription.update({
        where: { id: existing.id },
        data: {
          planId: dto.planId,
          status: SubscriptionStatus.CREATED,
          razorpaySubId: rzpSubId,
          userCount: dto.userCount,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
        },
      });

      // Retire the previous Razorpay subscription so the org isn't billed on both plans. Best-effort:
      // a failure here must not block the switch. The cancellation webhook for the old id is ignored
      // downstream (it no longer matches any OrgSubscription row), so it can't flip planStatus.
      if (existing.razorpaySubId && existing.razorpaySubId !== rzpSubId && process.env.RAZORPAY_KEY_ID) {
        try {
          await (this.rzp.subscriptions.cancel as (id: string, opts: unknown) => Promise<unknown>)(
            existing.razorpaySubId,
            { cancel_at_cycle_end: false },
          );
        } catch (err) {
          this.logger.error(
            `Failed to cancel previous subscription ${existing.razorpaySubId} on plan switch`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } else {
      const created = await this.prisma.orgSubscription.create({
        data: {
          orgId: caller.orgId,
          planId: dto.planId,
          status: SubscriptionStatus.CREATED,
          razorpaySubId: rzpSubId,
          userCount: dto.userCount,
        },
      });
      orgSubscriptionId = created.id;
    }

    // Same redemption bookkeeping as createSubscriptionForNewOrg: when offerId was
    // resolved, Razorpay already discounted this charge, so the redemption is recorded
    // as already APPLIED (no refund needed — applyPendingCouponRedemption's PENDING
    // lookup on the charged webhook won't find it and won't double-discount). Otherwise
    // it's left PENDING and refunded against the first `subscription.charged` webhook.
    //
    // Unlike createSubscriptionForNewOrg (a brand-new org can never already have a
    // redemption row), subscribe() can be called repeatedly by the same org — switching
    // plans, retrying, re-applying the same coupon. CouponRedemption has
    // @@unique([couponId, orgId]), so a plain create() throws on the second call;
    // repoint the existing row at the new subscription instead, and only bump
    // redemptionCount the first time this org redeems it (not on every re-subscribe).
    if (coupon) {
      const existingRedemption = await this.prisma.couponRedemption.findUnique({
        where: { couponId_orgId: { couponId: coupon.id, orgId: caller.orgId } },
      });

      if (existingRedemption) {
        await this.prisma.couponRedemption.update({
          where: { id: existingRedemption.id },
          data: {
            subscriptionId: orgSubscriptionId,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            ...(offerId
              ? { status: CouponRedemptionStatus.APPLIED, appliedAt: new Date() }
              : { status: CouponRedemptionStatus.PENDING, appliedAt: null, razorpayRefundId: null }),
          },
        });
      } else {
        await Promise.all([
          this.prisma.couponRedemption.create({
            data: {
              couponId: coupon.id,
              orgId: caller.orgId,
              subscriptionId: orgSubscriptionId,
              discountType: coupon.discountType,
              discountValue: coupon.discountValue,
              ...(offerId && { status: CouponRedemptionStatus.APPLIED, appliedAt: new Date() }),
            },
          }),
          this.prisma.coupon.update({ where: { id: coupon.id }, data: { redemptionCount: { increment: 1 } } }),
        ]);
      }
    }

    return { subscriptionId: rzpSubId, razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '' };
  }

  // Called from AuthService.register() for a paid signup — there's no logged-in
  // AuthUser yet (registration doesn't mint a JWT until payment is confirmed), so
  // this takes orgId directly instead of going through the JwtAuthGuard-only
  // `subscribe()` above. A brand-new org never has an existing OrgSubscription,
  // so this skips the plan-switch/cancel-previous branch entirely.
  async createSubscriptionForNewOrg(
    orgId: string,
    planId: string,
    userCount: number,
    billingInterval: BillingInterval,
    couponCode?: string,
    paymentMethod?: string,
  ): Promise<{ subscriptionId: string; razorpayKeyId: string }> {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(ErrorMessages.billing.planNotFound);
    if (!plan.razorpayPlanId) throw new ForbiddenException(ErrorMessages.billing.planNotConfigured);
    if ((plan.maxUsers && userCount > plan.maxUsers) || userCount < plan.minUsers) {
      throw new ForbiddenException(ErrorMessages.billing.seatCountOutOfRange);
    }

    const coupon = couponCode ? await this.findValidCoupon(couponCode, planId) : null;
    const offerId = coupon ? this.getOfferId(coupon, billingInterval, paymentMethod) : undefined;

    const totalCount = billingInterval === BillingInterval.ANNUAL ? 1 : 12;
    let rzpSubId: string;
    try {
      const rzpSub = await this.rzp.subscriptions.create({
        plan_id: plan.razorpayPlanId,
        total_count: totalCount,
        quantity: userCount,
        notify_info: { notify_email: 1 },
        addons: this.buildSetupFeeAddon(plan.setupFee),
        ...(offerId && { offer_id: offerId }),
      } as Parameters<typeof this.rzp.subscriptions.create>[0]);
      rzpSubId = rzpSub.id;
    } catch (err) {
      this.logger.error('Razorpay subscription create failed', err instanceof Error ? err.message : String(err));
      throw new ForbiddenException(ErrorMessages.billing.subscriptionCreateFailed);
    }

    const orgSubscription = await this.prisma.orgSubscription.create({
      data: { orgId, planId, status: SubscriptionStatus.CREATED, razorpaySubId: rzpSubId, userCount },
    });

    if (coupon) {
      await Promise.all([
        this.prisma.couponRedemption.create({
          data: {
            couponId: coupon.id,
            orgId,
            subscriptionId: orgSubscription.id,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            ...(offerId && { status: CouponRedemptionStatus.APPLIED, appliedAt: new Date() }),
          },
        }),
        this.prisma.coupon.update({ where: { id: coupon.id }, data: { redemptionCount: { increment: 1 } } }),
      ]);
    }

    return { subscriptionId: rzpSubId, razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '' };
  }

  // Validates a coupon code against expiry/redemption-limit/plan-tier rules and returns
  // the full Coupon row (including razorpayOfferIds, never exposed to clients — see
  // validateCoupon below for the public-facing projection). Shared by validateCoupon and
  // both subscribe()/createSubscriptionForNewOrg, which need razorpayOfferIds to decide
  // whether the discount can be applied pre-payment via a Razorpay Offer.
  private async findValidCoupon(code: string, planId?: string) {
    const normalized = code.trim().toUpperCase();
    const coupon = await this.prisma.coupon.findUnique({ where: { code: normalized } });

    if (!coupon || !coupon.isActive) throw new NotFoundException(ErrorMessages.billing.invalidCoupon);
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      throw new NotFoundException(ErrorMessages.billing.invalidCoupon);
    }
    if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
      throw new NotFoundException(ErrorMessages.billing.invalidCoupon);
    }

    if (planId && coupon.applicablePlanTiers.length > 0) {
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan || !coupon.applicablePlanTiers.includes(plan.tier)) {
        throw new ForbiddenException(ErrorMessages.billing.couponNotApplicable);
      }
    }

    return coupon;
  }

  // Looks up the Razorpay Offer for this coupon's (billingInterval, paymentMethod) pair,
  // if one is configured — see the Coupon.razorpayOfferIds comment in schema.prisma. No
  // paymentMethod (caller didn't restrict checkout to a single method) or no matching
  // entry both mean "no pre-payment offer" — the caller falls back to the refund path.
  private getOfferId(
    coupon: { razorpayOfferIds: Prisma.JsonValue },
    billingInterval: BillingInterval,
    paymentMethod?: string,
  ): string | undefined {
    if (!paymentMethod) return undefined;
    const offerIds = coupon.razorpayOfferIds as Record<string, Record<string, string>> | null;
    return offerIds?.[billingInterval]?.[paymentMethod];
  }

  // Validates a coupon code and returns its discount terms. Public (unauthenticated) —
  // used both by the registration wizard's "Apply" button and the Billing page's.
  async validateCoupon(
    code: string,
    planId?: string,
  ): Promise<{ id: string; code: string; discountType: DiscountType; discountValue: number; label: string }> {
    const coupon = await this.findValidCoupon(code, planId);

    const label =
      coupon.discountType === DiscountType.PERCENT
        ? `${coupon.discountValue}% off`
        : `₹${coupon.discountValue} off`;

    return { id: coupon.id, code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue, label };
  }

  // Org-wide active user count for the seat-billing UI. Deliberately not
  // hierarchy-scoped like UsersService.findAll() — seats are billed per
  // active user across the whole org regardless of which role is viewing
  // the Billing page, so a MANAGER (who only sees their own team) must get
  // the same number a DIRECTOR would.
  async getActiveUserCount(caller: AuthUser): Promise<{ count: number }> {
    if (!caller.orgId) return { count: 0 };
    return { count: await this.countActiveUsers(caller.orgId) };
  }

  async getSubscription(caller: AuthUser) {
    if (!caller.orgId) return null;

    return this.prisma.orgSubscription.findUnique({
      where: { orgId: caller.orgId },
      include: {
        plan: true,
        addons: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async updateSeats(userCount: number, caller: AuthUser) {
    const sub = await this.requireActiveSubscription(caller);

    if (userCount > sub.userCount) {
      throw new ForbiddenException(ErrorMessages.billing.seatIncreaseRequiresPayment);
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } });
    if (!plan) throw new NotFoundException(ErrorMessages.billing.planNotFound);
    if ((plan.maxUsers && userCount > plan.maxUsers) || userCount < plan.minUsers) {
      throw new ForbiddenException(ErrorMessages.billing.seatCountOutOfRange);
    }

    if (sub.razorpaySubId && process.env.RAZORPAY_KEY_ID) {
      try {
        await this.rzp.subscriptions.update(sub.razorpaySubId, { quantity: userCount } as Parameters<
          typeof this.rzp.subscriptions.update
        >[1]);
      } catch (err) {
        this.logger.error('Razorpay subscription update failed', err instanceof Error ? err.message : String(err));
      }
    }

    return this.prisma.orgSubscription.update({
      where: { id: sub.id },
      data: { userCount },
      include: { plan: true },
    });
  }

  async initiateSeatUpdate(userCount: number, caller: AuthUser) {
    if (caller.orgId === process.env.GENXCRM_INTERNAL_ORG_ID) {
      throw new ForbiddenException(ErrorMessages.billing.orgExempt);
    }
    const sub = await this.requireActiveSubscription(caller);
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } });
    if (!plan) throw new NotFoundException(ErrorMessages.billing.planNotFound);

    const activeUsers = await this.countActiveUsers(sub.orgId);
    if (userCount < activeUsers) {
      throw new ForbiddenException(this.seatCountTooLowError(activeUsers));
    }
    if ((plan.maxUsers && userCount > plan.maxUsers) || userCount < plan.minUsers) {
      throw new ForbiddenException(ErrorMessages.billing.seatCountOutOfRange);
    }

    const { additionalSeats, proratedAmount, remainingDays } = this.computeSeatProration(
      plan.pricePerUser,
      sub.userCount,
      userCount,
      sub.currentPeriodEnd,
    );

    if (proratedAmount <= 0) {
      const subscription = await this.updateSeats(userCount, caller);
      return { requiresPayment: false as const, subscription };
    }

    try {
      const order = await (
        this.rzp as unknown as {
          orders: { create: (data: unknown) => Promise<{ id: string }> };
        }
      ).orders.create({
        amount: Math.round(proratedAmount * 100),
        currency: 'INR',
        notes: { orgId: caller.orgId, subscriptionId: sub.id, newUserCount: userCount },
      });

      return {
        requiresPayment: true as const,
        orderId: order.id,
        amount: proratedAmount,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
        additionalSeats,
        remainingDays,
      };
    } catch (err) {
      this.logger.error('Razorpay seat-update order create failed', err instanceof Error ? err.message : String(err));
      throw new ForbiddenException(ErrorMessages.billing.seatCheckoutFailed);
    }
  }

  async confirmSeatUpdate(dto: ConfirmSeatUpdateDto, caller: AuthUser) {
    const sub = await this.requireActiveSubscription(caller);

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '')
      .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
      .digest('hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');
    const sigBuf = Buffer.from(dto.razorpaySignature ?? '', 'hex');
    const isValid = expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
    if (!isValid) {
      throw new UnauthorizedException(ErrorMessages.billing.invalidSeatPayment);
    }

    // A valid signature only proves this (orderId, paymentId) pair is a genuine
    // completed Razorpay payment — it doesn't prove the order was created for
    // *this* subscription or for the userCount the client is now claiming.
    // Cross-check against the order's own notes (set in initiateSeatUpdate) so a
    // payment for a small seat increase can't be replayed with a larger userCount.
    //
    // Use the payment's own status (captured/authorized), not the order's aggregate
    // status — the order can still read "attempted" for a moment right after checkout
    // succeeds, since Razorpay updates it slightly after the payment itself captures.
    try {
      const rzp = this.rzp as unknown as {
        orders: { fetch: (id: string) => Promise<{ notes?: Record<string, string | number> }> };
        payments: { fetch: (id: string) => Promise<{ status: string; order_id: string }> };
      };
      const [order, payment] = await Promise.all([
        rzp.orders.fetch(dto.razorpayOrderId),
        rzp.payments.fetch(dto.razorpayPaymentId),
      ]);

      const notesMatch =
        order.notes?.subscriptionId === sub.id &&
        String(order.notes?.newUserCount) === String(dto.userCount);
      const paymentValid =
        payment.order_id === dto.razorpayOrderId && ['captured', 'authorized'].includes(payment.status);
      if (!paymentValid || !notesMatch) {
        throw new UnauthorizedException(ErrorMessages.billing.invalidSeatPayment);
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error('Razorpay order fetch failed during seat confirm', err instanceof Error ? err.message : String(err));
      throw new UnauthorizedException(ErrorMessages.billing.invalidSeatPayment);
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } });
    if (!plan) throw new NotFoundException(ErrorMessages.billing.planNotFound);

    const { proratedAmount } = this.computeSeatProration(
      plan.pricePerUser,
      sub.userCount,
      dto.userCount,
      sub.currentPeriodEnd,
    );

    if (sub.razorpaySubId && process.env.RAZORPAY_KEY_ID) {
      try {
        await this.rzp.subscriptions.update(sub.razorpaySubId, { quantity: dto.userCount } as Parameters<
          typeof this.rzp.subscriptions.update
        >[1]);
      } catch (err) {
        this.logger.error('Razorpay subscription update failed', err instanceof Error ? err.message : String(err));
      }
    }

    const [subscription] = await Promise.all([
      this.prisma.orgSubscription.update({
        where: { id: sub.id },
        data: { userCount: dto.userCount },
        include: { plan: true },
      }),
      this.prisma.billingEvent.create({
        data: {
          subscriptionId: sub.id,
          event: 'seats.upgraded',
          amount: proratedAmount,
          currency: 'INR',
          razorpayPaymentId: dto.razorpayPaymentId,
          metadata: {
            previousUserCount: sub.userCount,
            newUserCount: dto.userCount,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    return subscription;
  }

  private countActiveUsers(orgId: string) {
    return this.prisma.user.count({ where: { orgId, isActive: true } });
  }

  private seatCountTooLowError(activeUsers: number) {
    return {
      code: 'SEAT_COUNT_TOO_LOW',
      required: activeUsers,
      message: ErrorMessages.billing.seatCountBelowActiveUsers(activeUsers),
    };
  }

  // One-time addon charged on the subscription's first invoice only — Razorpay applies
  // `addons` exactly once at subscription creation, never on renewal cycles.
  private buildSetupFeeAddon(setupFee: number) {
    if (setupFee <= 0) return undefined;
    return [{ item: { name: 'One-time setup fee', amount: Math.round(setupFee * 100), currency: 'INR' } }];
  }

  private computeSeatProration(
    pricePerUser: number,
    currentUserCount: number,
    newUserCount: number,
    currentPeriodEnd: Date | null,
  ): { additionalSeats: number; proratedAmount: number; remainingDays: number } {
    const additionalSeats = newUserCount - currentUserCount;
    if (additionalSeats <= 0) {
      return { additionalSeats: 0, proratedAmount: 0, remainingDays: 0 };
    }

    const now = new Date();
    const periodEnd = currentPeriodEnd ?? new Date(now.getTime() + SEAT_PRORATION_CYCLE_DAYS * MS_PER_DAY);
    const remainingDays = Math.max(
      1,
      Math.min(SEAT_PRORATION_CYCLE_DAYS, Math.ceil((periodEnd.getTime() - now.getTime()) / MS_PER_DAY)),
    );

    const dailyRate = pricePerUser / SEAT_PRORATION_CYCLE_DAYS;
    const proratedAmount = Math.round(dailyRate * additionalSeats * remainingDays);

    return { additionalSeats, proratedAmount, remainingDays };
  }

  async cancelSubscription(caller: AuthUser) {
    const sub = await this.requireActiveSubscription(caller);

    if (sub.razorpaySubId && process.env.RAZORPAY_KEY_ID) {
      try {
        await (this.rzp.subscriptions.cancel as (id: string, opts: unknown) => Promise<unknown>)(sub.razorpaySubId, {
          cancel_at_cycle_end: true,
        });
      } catch (err) {
        this.logger.error('Razorpay cancel failed', err instanceof Error ? err.message : String(err));
      }
    }

    return this.prisma.orgSubscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
      include: { plan: true },
    });
  }

  async purchaseAddon(dto: PurchaseAddonDto, caller: AuthUser) {
    if (caller.orgId === process.env.GENXCRM_INTERNAL_ORG_ID) {
      throw new ForbiddenException(ErrorMessages.billing.orgExempt);
    }
    const sub = await this.requireActiveSubscription(caller);
    const addonMeta = ADDON_PRICES[dto.type];
    const totalPrice = addonMeta.price * dto.quantity;
    const totalCredits = addonMeta.credits * dto.quantity;

    let paymentLink = `https://pay.genxcrm.com/addon/${Date.now()}`;
    let paymentLinkId: string | null = null;

    if (process.env.RAZORPAY_KEY_ID) {
      try {
        const amountInPaise = Math.round(totalPrice * 100);
        const response = await (
          this.rzp as unknown as {
            paymentLink: { create: (data: unknown) => Promise<{ id: string; short_url: string }> };
          }
        ).paymentLink.create({
          amount: amountInPaise,
          currency: 'INR',
          description: `${addonMeta.label} add-on`,
          notify: { sms: false, email: true },
          notes: { orgId: caller.orgId, subscriptionId: sub.id, addonType: dto.type, quantity: dto.quantity },
        });
        paymentLink = response.short_url;
        paymentLinkId = response.id;
      } catch (err) {
        this.logger.error('Razorpay addon payment link failed', err instanceof Error ? err.message : String(err));
        throw new ForbiddenException(ErrorMessages.billing.addonCheckoutFailed);
      }
    }

    await this.prisma.subscriptionAddon.create({
      data: {
        subscriptionId: sub.id,
        type: dto.type,
        quantity: totalCredits,
        pricePaid: totalPrice,
        status: AddonStatus.PENDING,
        razorpayPaymentLinkId: paymentLinkId,
      },
    });

    return { paymentLink, totalPrice, totalCredits };
  }

  async confirmPayment(razorpayPaymentId: string, razorpaySubscriptionId: string, caller: AuthUser) {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.billing.noOrg);
    return this.confirmPaymentForOrg(caller.orgId, razorpayPaymentId, razorpaySubscriptionId);
  }

  // Shared by confirmPayment() (authenticated, existing orgs) and AuthService's
  // registration-payment confirmation (no session yet — the caller there
  // authenticates the request via the Razorpay signature instead of a JWT).
  async confirmPaymentForOrg(orgId: string, razorpayPaymentId: string, razorpaySubscriptionId: string) {
    const sub = await this.prisma.orgSubscription.findUnique({ where: { orgId } });
    if (!sub) throw new NotFoundException(ErrorMessages.billing.subscriptionNotFound);
    if (sub.razorpaySubId !== razorpaySubscriptionId) {
      throw new ForbiddenException(ErrorMessages.billing.subscriptionMismatch);
    }

    if (sub.status === SubscriptionStatus.ACTIVE) {
      return { status: 'already_active' as const };
    }

    await this.onActivated(sub.id, sub.orgId);

    await this.prisma.billingEvent.create({
      data: {
        subscriptionId: sub.id,
        event: 'subscription.authenticated',
        razorpayPaymentId,
        metadata: { razorpayPaymentId, razorpaySubscriptionId } as Prisma.InputJsonValue,
      },
    });

    return { status: 'activated' as const };
  }

  async getBillingHistory(caller: AuthUser) {
    if (!caller.orgId) return [];

    const sub = await this.prisma.orgSubscription.findUnique({ where: { orgId: caller.orgId } });
    if (!sub) return [];

    return this.prisma.billingEvent.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async handleWebhook(rawBody: Buffer, signature: string, payload: Record<string, unknown>) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const expBuf = Buffer.from(expected, 'hex');
      const sigBuf = Buffer.from(signature ?? '', 'hex');
      const isValid = expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
      if (!isValid) throw new UnauthorizedException(ErrorMessages.billing.invalidWebhookSignature);
    }

    const event = payload.event as string | undefined;
    if (!event) return;

    if (event === 'payment_link.paid') {
      await this.onAddonPaid(payload);
      return;
    }

    if (!event.startsWith('subscription.')) return;

    const subscriptionEntity = this.extractSubscriptionEntity(payload);
    if (!subscriptionEntity) return;

    const rzpSubId = subscriptionEntity.id as string | undefined;
    if (!rzpSubId) return;

    const sub = await this.prisma.orgSubscription.findUnique({ where: { razorpaySubId: rzpSubId } });
    if (!sub) {
      this.logger.warn(`Received webhook for unknown subscription: ${rzpSubId}`);
      return;
    }

    switch (event) {
      case 'subscription.authenticated':
      case 'subscription.activated':
        await this.onActivated(sub.id, sub.orgId);
        break;
      case 'subscription.charged':
        await this.onCharged(sub.id, payload);
        break;
      case 'subscription.halted':
        await this.onHalted(sub.id);
        break;
      case 'subscription.cancelled':
      case 'subscription.completed':
        await this.onCancelled(sub.id, sub.orgId);
        break;
      default:
        this.logger.log(`Unhandled subscription event: ${event}`);
    }
  }

  private async onAddonPaid(payload: Record<string, unknown>) {
    const p = payload.payload as Record<string, unknown> | undefined;
    const linkEntity = (p?.payment_link as Record<string, unknown> | undefined)?.entity as
      | Record<string, unknown>
      | undefined;
    const paymentEntity = (p?.payment as Record<string, unknown> | undefined)?.entity as
      | Record<string, unknown>
      | undefined;

    const linkId = linkEntity?.id as string | undefined;
    if (!linkId) return;

    const addon = await this.prisma.subscriptionAddon.findUnique({ where: { razorpayPaymentLinkId: linkId } });
    if (!addon) {
      this.logger.warn(`Received payment_link.paid webhook for unknown link: ${linkId}`);
      return;
    }
    if (addon.status === AddonStatus.PAID) return;

    const razorpayPaymentId = (paymentEntity?.id as string | undefined) ?? null;
    const amount = paymentEntity?.amount ? (paymentEntity.amount as number) / 100 : addon.pricePaid;

    await Promise.all([
      this.prisma.subscriptionAddon.update({
        where: { id: addon.id },
        data: { status: AddonStatus.PAID, razorpayPaymentId },
      }),
      this.prisma.billingEvent.create({
        data: {
          subscriptionId: addon.subscriptionId,
          event: 'addon.paid',
          amount,
          currency: 'INR',
          razorpayPaymentId,
          metadata: { addonId: addon.id, addonType: addon.type, quantity: addon.quantity } as Prisma.InputJsonValue,
        },
      }),
    ]);
    this.logger.log(`Addon ${addon.id} marked PAID via payment_link.paid webhook`);
  }

  private async onActivated(subscriptionId: string, orgId: string) {
    await Promise.all([
      this.prisma.orgSubscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.ACTIVE },
      }),
      this.prisma.organization.update({
        where: { id: orgId },
        data: { planStatus: PlanStatus.ACTIVE },
      }),
    ]);
    this.logger.log(`Subscription ${subscriptionId} activated for org ${orgId}`);
  }

  private async onCharged(subscriptionId: string, payload: Record<string, unknown>) {
    const paymentEntity = this.extractPaymentEntity(payload);
    const amount = paymentEntity ? ((paymentEntity.amount as number) ?? 0) / 100 : 0;
    const currency = (paymentEntity?.currency as string | undefined) ?? 'INR';
    const razorpayPaymentId = (paymentEntity?.id as string | undefined) ?? null;

    const currentEnd = paymentEntity?.created_at
      ? new Date((paymentEntity.created_at as number) * 1000 + 30 * 24 * 60 * 60 * 1000)
      : undefined;

    await Promise.all([
      this.prisma.billingEvent.create({
        data: {
          subscriptionId,
          event: 'subscription.charged',
          amount,
          currency,
          razorpayPaymentId,
          metadata: payload as Prisma.InputJsonValue,
        },
      }),
      this.prisma.orgSubscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          ...(currentEnd && { currentPeriodEnd: currentEnd }),
        },
      }),
    ]);

    if (razorpayPaymentId) {
      await this.applyPendingCouponRedemption(subscriptionId, razorpayPaymentId, amount);
    }
  }

  // Settles a signup coupon out-of-band: refunds the discount amount against the
  // first charge (see the Coupon model comment in schema.prisma for why). Runs
  // once per subscription — a redemption's status flips PENDING → APPLIED (or
  // FAILED) so a later `subscription.charged` webhook retry can't double-refund.
  private async applyPendingCouponRedemption(subscriptionId: string, razorpayPaymentId: string, chargedAmount: number) {
    const redemption = await this.prisma.couponRedemption.findFirst({
      where: { subscriptionId, status: CouponRedemptionStatus.PENDING },
    });
    if (!redemption) return;

    const discountAmount =
      redemption.discountType === DiscountType.PERCENT
        ? Math.round(chargedAmount * (redemption.discountValue / 100) * 100) / 100
        : Math.min(redemption.discountValue, chargedAmount);

    try {
      const refund = await (
        this.rzp as unknown as {
          payments: { refund: (paymentId: string, data: unknown) => Promise<{ id: string }> };
        }
      ).payments.refund(razorpayPaymentId, { amount: Math.round(discountAmount * 100) });

      await Promise.all([
        this.prisma.couponRedemption.update({
          where: { id: redemption.id },
          data: { status: CouponRedemptionStatus.APPLIED, razorpayRefundId: refund.id, appliedAt: new Date() },
        }),
        this.prisma.billingEvent.create({
          data: {
            subscriptionId,
            event: 'coupon.applied',
            amount: -discountAmount,
            razorpayPaymentId,
            metadata: { redemptionId: redemption.id, razorpayRefundId: refund.id } as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to refund coupon discount for subscription ${subscriptionId}`,
        err instanceof Error ? err.message : String(err),
      );
      await this.prisma.couponRedemption.update({
        where: { id: redemption.id },
        data: { status: CouponRedemptionStatus.FAILED },
      });
    }
  }

  private async onHalted(subscriptionId: string) {
    await this.prisma.orgSubscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.HALTED },
    });
    this.logger.warn(`Subscription ${subscriptionId} halted — payment failed`);
  }

  private async onCancelled(subscriptionId: string, orgId: string) {
    await Promise.all([
      this.prisma.orgSubscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
      }),
      this.prisma.organization.update({
        where: { id: orgId },
        data: { planStatus: PlanStatus.EXPIRED },
      }),
    ]);
  }

  private extractSubscriptionEntity(payload: Record<string, unknown>) {
    const p = payload.payload as Record<string, unknown> | undefined;
    return (p?.subscription as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;
  }

  private extractPaymentEntity(payload: Record<string, unknown>) {
    const p = payload.payload as Record<string, unknown> | undefined;
    return (p?.payment as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;
  }

  // True once the org has an ACTIVE or AUTHENTICATED subscription — the same
  // check TrialService uses to switch an org from Trial to Pro resource limits.
  // The plan whose included allowances (emailCredits, whatsappCredits, ...) apply to this
  // org right now: its subscribed plan if ACTIVE/AUTHENTICATED, otherwise the DB-seeded
  // Trial plan row (tier: 'trial') — never a hardcoded constant, so limits can change
  // without a deploy.
  private async getApplicablePlanFeatures(
    orgId: string,
  ): Promise<{ emailCredits: number; whatsappCredits: number }> {
    const sub = await this.prisma.orgSubscription.findUnique({
      where: { orgId },
      select: { status: true, plan: { select: { features: true } } },
    });
    if (sub?.status === SubscriptionStatus.ACTIVE || sub?.status === SubscriptionStatus.AUTHENTICATED) {
      return sub.plan.features as unknown as { emailCredits: number; whatsappCredits: number };
    }
    const trialPlan = await this.prisma.subscriptionPlan.findFirst({ where: { tier: 'trial' } });
    return trialPlan?.features as unknown as { emailCredits: number; whatsappCredits: number };
  }

  // Emails remaining this cycle: the plan's free monthly allotment plus any unused,
  // paid EMAIL_CREDITS addon capacity.
  async getEmailQuota(orgId: string): Promise<{ limit: number; used: number; remaining: number }> {
    const [org, addonCredits, features] = await Promise.all([
      this.resetEmailCycleIfStale(orgId),
      this.availableAddonCredits(orgId, AddonType.EMAIL_CREDITS),
      this.getApplicablePlanFeatures(orgId),
    ]);
    const baseLimit = features.emailCredits;
    const baseRemaining = Math.max(0, baseLimit - org.emailsSentThisCycle);
    return {
      limit: baseLimit + addonCredits.total,
      used: org.emailsSentThisCycle,
      remaining: baseRemaining + addonCredits.remaining,
    };
  }

  // Callers should check this BEFORE attempting to send an org-scoped email.
  // No orgId (shouldn't normally happen for a real send) never blocks.
  async hasEmailQuota(orgId: string | null | undefined): Promise<boolean> {
    if (!orgId) return true;
    const quota = await this.getEmailQuota(orgId);
    return quota.remaining > 0;
  }

  // Call once per email attempt, after hasEmailQuota() allowed it, to meter usage.
  // Consumes the free monthly allotment first, then the oldest paid EMAIL_CREDITS
  // addon with remaining capacity. Never throws — a metering failure must not
  // break the email that already went out (or was attempted).
  async recordEmailSent(orgId: string | null | undefined): Promise<void> {
    if (!orgId) return;
    try {
      const [org, features] = await Promise.all([
        this.resetEmailCycleIfStale(orgId),
        this.getApplicablePlanFeatures(orgId),
      ]);
      const baseLimit = features.emailCredits;
      if (org.emailsSentThisCycle < baseLimit) {
        await this.prisma.organization.update({
          where: { id: orgId },
          data: { emailsSentThisCycle: { increment: 1 } },
        });
        return;
      }

      await this.consumeOldestAddonCredit(orgId, AddonType.EMAIL_CREDITS);
    } catch (err) {
      this.logger.error(`Failed to record email usage for org ${orgId}`, err instanceof Error ? err.message : String(err));
    }
  }

  // Resets the org's free-allotment counter once the rolling cycle has elapsed.
  // Missing org (shouldn't happen for a real orgId) degrades to an empty, unsaved
  // cycle rather than throwing — metering must never block a caller.
  private async resetEmailCycleIfStale(
    orgId: string,
  ): Promise<{ emailsSentThisCycle: number; emailCycleStartedAt: Date }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { emailsSentThisCycle: true, emailCycleStartedAt: true },
    });
    if (!org) return { emailsSentThisCycle: 0, emailCycleStartedAt: new Date() };

    const cycleAgeMs = Date.now() - org.emailCycleStartedAt.getTime();
    if (cycleAgeMs < EMAIL_CYCLE_DAYS * MS_PER_DAY) return org;

    const reset = { emailsSentThisCycle: 0, emailCycleStartedAt: new Date() };
    await this.prisma.organization.update({ where: { id: orgId }, data: reset });
    return reset;
  }

  private async availableAddonCredits(orgId: string, type: AddonType): Promise<{ total: number; remaining: number }> {
    const addons = await this.prisma.subscriptionAddon.findMany({
      where: { type, status: AddonStatus.PAID, subscription: { orgId } },
    });
    return addons.reduce(
      (acc, a) => ({
        total: acc.total + a.quantity,
        remaining: acc.remaining + Math.max(0, a.quantity - a.usedCount),
      }),
      { total: 0, remaining: 0 },
    );
  }

  // Consumes one unit from the oldest paid addon of `type` with remaining capacity, if any.
  private async consumeOldestAddonCredit(orgId: string, type: AddonType): Promise<void> {
    const addons = await this.prisma.subscriptionAddon.findMany({
      where: { type, status: AddonStatus.PAID, subscription: { orgId } },
      orderBy: { createdAt: 'asc' },
    });
    const addon = addons.find((a) => a.usedCount < a.quantity);
    if (addon) {
      await this.prisma.subscriptionAddon.update({
        where: { id: addon.id },
        data: { usedCount: { increment: 1 } },
      });
    }
  }

  // WhatsApp credits remaining: the plan's one-time free allowance (which never resets;
  // 0 on the Trial plan — see Terms.tsx's #plan-limits section) plus any unused, paid
  // WHATSAPP_CREDITS addon capacity. Callers should only consult this for orgs sending
  // via GenXCRM's shared WhatsApp API — an org using its own connected WABA is unmetered
  // and never calls this.
  async getWhatsAppQuota(orgId: string): Promise<{ limit: number; used: number; remaining: number }> {
    const [org, addonCredits, features] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { whatsappCreditsUsed: true } }),
      this.availableAddonCredits(orgId, AddonType.WHATSAPP_CREDITS),
      this.getApplicablePlanFeatures(orgId),
    ]);
    const used = org?.whatsappCreditsUsed ?? 0;
    const baseCredits = features.whatsappCredits;
    const baseRemaining = Math.max(0, baseCredits - used);
    return {
      limit: baseCredits + addonCredits.total,
      used,
      remaining: baseRemaining + addonCredits.remaining,
    };
  }

  // Callers should check this BEFORE attempting to send a shared-API WhatsApp
  // message. No orgId never blocks.
  async hasWhatsAppQuota(orgId: string | null | undefined): Promise<boolean> {
    if (!orgId) return true;
    const quota = await this.getWhatsAppQuota(orgId);
    return quota.remaining > 0;
  }

  // Call once per shared-API WhatsApp send, after hasWhatsAppQuota() allowed it.
  // Consumes the one-time free credit first, then the oldest paid WHATSAPP_CREDITS
  // addon with remaining capacity. Never throws — a metering failure must not
  // break a message that already went out.
  async recordWhatsAppSent(orgId: string | null | undefined): Promise<void> {
    if (!orgId) return;
    try {
      const [org, features] = await Promise.all([
        this.prisma.organization.findUnique({ where: { id: orgId }, select: { whatsappCreditsUsed: true } }),
        this.getApplicablePlanFeatures(orgId),
      ]);
      const used = org?.whatsappCreditsUsed ?? 0;
      if (used < features.whatsappCredits) {
        await this.prisma.organization.update({
          where: { id: orgId },
          data: { whatsappCreditsUsed: { increment: 1 } },
        });
        return;
      }

      await this.consumeOldestAddonCredit(orgId, AddonType.WHATSAPP_CREDITS);
    } catch (err) {
      this.logger.error(
        `Failed to record WhatsApp usage for org ${orgId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async requireActiveSubscription(caller: AuthUser) {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.billing.noOrg);

    const sub = await this.prisma.orgSubscription.findUnique({ where: { orgId: caller.orgId } });
    if (!sub || !ACTIVE_STATUSES.includes(sub.status)) {
      throw new ForbiddenException(ErrorMessages.billing.noActiveSubscription);
    }
    return sub;
  }
}
