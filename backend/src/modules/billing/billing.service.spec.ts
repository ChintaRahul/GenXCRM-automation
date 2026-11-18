import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddonType,
  AddonStatus,
  BillingInterval,
  PlanStatus,
  SubscriptionStatus,
  Role,
  DiscountType,
  CouponRedemptionStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

// Mock Razorpay SDK so the constructor doesn't require real API keys in tests
const mockRzpInstance = {
  subscriptions: {
    create: jest.fn().mockResolvedValue({ id: 'sub_rzp_new' }),
    update: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({}),
  },
  paymentLink: { create: jest.fn().mockResolvedValue({ id: 'plink_123', short_url: 'https://rzp.io/l/addon' }) },
  orders: {
    create: jest.fn().mockResolvedValue({ id: 'order_rzp_123' }),
    fetch: jest.fn().mockResolvedValue({
      notes: { subscriptionId: 'sub-1', newUserCount: '5' },
    }),
  },
  payments: {
    fetch: jest.fn().mockResolvedValue({ status: 'captured', order_id: 'order_rzp_123' }),
    refund: jest.fn().mockResolvedValue({ id: 'rfnd_1' }),
  },
};
jest.mock('razorpay', () => jest.fn().mockImplementation(() => mockRzpInstance));

const mockCaller = (orgId = 'org-1'): AuthUser => ({
  id: 'user-1',
  name: 'Admin User',
  email: 'admin@test.com',
  role: Role.DIRECTOR,
  orgId,
  teamId: null,
});

const mockPlan = {
  id: 'plan-1',
  name: 'Starter',
  slug: 'starter-monthly',
  tier: 'starter',
  pricePerUser: 499,
  billingInterval: BillingInterval.MONTHLY,
  razorpayPlanId: 'plan_rzp_123',
  minUsers: 1,
  maxUsers: 5,
  features: {},
  isActive: true,
  createdAt: new Date(),
};

const mockSub = {
  id: 'sub-1',
  orgId: 'org-1',
  planId: 'plan-1',
  status: SubscriptionStatus.ACTIVE,
  razorpaySubId: 'sub_rzp_123',
  razorpayCustomerId: null,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(),
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  userCount: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BillingService', () => {
  let service: BillingService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: PrismaService,
          useValue: {
            subscriptionPlan: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
            orgSubscription: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            subscriptionAddon: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
            billingEvent: { create: jest.fn(), findMany: jest.fn() },
            organization: { update: jest.fn(), findUnique: jest.fn() },
            user: { count: jest.fn().mockResolvedValue(0) },
            coupon: { findUnique: jest.fn(), update: jest.fn() },
            couponRedemption: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get(BillingService);
    prisma = module.get(PrismaService);
  });

  describe('getPlans', () => {
    it('returns active plans ordered by tier and interval', async () => {
      (prisma.subscriptionPlan.findMany as jest.Mock).mockResolvedValue([mockPlan]);
      const result = await service.getPlans();
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('getActiveUserCount', () => {
    it('returns the org-wide active user count regardless of caller role', async () => {
      (prisma.user.count as jest.Mock).mockResolvedValue(7);
      const result = await service.getActiveUserCount(mockCaller());
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', isActive: true } }),
      );
      expect(result).toEqual({ count: 7 });
    });

    it('returns 0 when caller has no orgId', async () => {
      const callerNoOrg: AuthUser = {
        id: 'user-1',
        name: 'Admin',
        email: 'a@b.com',
        role: Role.DIRECTOR,
        orgId: null,
        teamId: null,
      };
      const result = await service.getActiveUserCount(callerNoOrg);
      expect(result).toEqual({ count: 0 });
    });
  });

  describe('getSubscription', () => {
    it('returns null when caller has no orgId', async () => {
      const callerNoOrg: AuthUser = {
        id: 'user-1',
        name: 'Admin',
        email: 'a@b.com',
        role: Role.DIRECTOR,
        orgId: null,
        teamId: null,
      };
      const result = await service.getSubscription(callerNoOrg);
      expect(result).toBeNull();
      expect(prisma.orgSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the caller orgId', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      const result = await service.getSubscription(mockCaller());
      expect(prisma.orgSubscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } }),
      );
      expect(result).toEqual(mockSub);
    });
  });

  describe('getBillingHistory', () => {
    it('returns [] when caller has no orgId', async () => {
      const callerNoOrg: AuthUser = {
        id: 'user-1',
        name: 'Admin',
        email: 'a@b.com',
        role: Role.DIRECTOR,
        orgId: null,
        teamId: null,
      };
      const result = await service.getBillingHistory(callerNoOrg);
      expect(result).toEqual([]);
      expect(prisma.orgSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('returns [] when no subscription exists for the org', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getBillingHistory(mockCaller());
      expect(result).toEqual([]);
      expect(prisma.billingEvent.findMany).not.toHaveBeenCalled();
    });

    it('scopes billing events to the org subscription', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.billingEvent.findMany as jest.Mock).mockResolvedValue([]);
      await service.getBillingHistory(mockCaller());
      expect(prisma.billingEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriptionId: 'sub-1' } }),
      );
    });
  });

  describe('subscribe', () => {
    it('throws ForbiddenException for the GenXCRM internal org and never calls Razorpay', async () => {
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';

      await expect(
        service.subscribe(
          { planId: 'plan-1', userCount: 1, billingInterval: BillingInterval.MONTHLY },
          mockCaller('org-internal'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRzpInstance.subscriptions.create).not.toHaveBeenCalled();

      delete process.env.GENXCRM_INTERNAL_ORG_ID;
    });

    it('creates a Razorpay subscription and OrgSubscription record', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.CREATED,
      });

      const result = await service.subscribe(
        { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: 'plan_rzp_123', quantity: 3, total_count: 12 }),
      );
      expect(prisma.orgSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-1', planId: 'plan-1', status: SubscriptionStatus.CREATED }),
        }),
      );
      expect(result).toHaveProperty('subscriptionId');
    });

    it('uses total_count 1 for annual billing', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({});

      await service.subscribe(
        { planId: 'plan-1', userCount: 2, billingInterval: BillingInterval.ANNUAL },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({ total_count: 1 }));
    });

    it('includes a one-time setup-fee addon on the first invoice when plan.setupFee > 0', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, setupFee: 5000 });
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({});

      await service.subscribe(
        { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          addons: [{ item: { name: 'One-time setup fee', amount: 500000, currency: 'INR' } }],
        }),
      );
    });

    it('omits the addons field when plan.setupFee is 0', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, setupFee: 0 });
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({});

      await service.subscribe(
        { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({ addons: undefined }),
      );
    });

    it('throws NotFoundException when plan not found', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.subscribe({ planId: 'bad-plan', userCount: 1, billingInterval: BillingInterval.MONTHLY }, mockCaller()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when plan has no razorpayPlanId', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, razorpayPlanId: null });
      await expect(
        service.subscribe({ planId: 'plan-1', userCount: 1, billingInterval: BillingInterval.MONTHLY }, mockCaller()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('switches plans on an ACTIVE subscription: repoints the record and retires the old Razorpay sub', async () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, id: 'plan-2' });
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: false,
        razorpaySubId: 'sub_rzp_old',
      });
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});

      const result = await service.subscribe(
        { planId: 'plan-2', userCount: 4, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      // Record repointed at the new plan + new Razorpay subscription, ready for checkout.
      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planId: 'plan-2',
            status: SubscriptionStatus.CREATED,
            razorpaySubId: 'sub_rzp_new',
            userCount: 4,
            cancelAtPeriodEnd: false,
          }),
        }),
      );
      // Old Razorpay subscription cancelled so the org isn't double-billed.
      expect(mockRzpInstance.subscriptions.cancel).toHaveBeenCalledWith('sub_rzp_old', { cancel_at_cycle_end: false });
      expect(result).toHaveProperty('subscriptionId', 'sub_rzp_new');
      delete process.env.RAZORPAY_KEY_ID;
    });

    it('does not throw if retiring the old Razorpay subscription fails during a switch', async () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, id: 'plan-2' });
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.ACTIVE,
        razorpaySubId: 'sub_rzp_old',
      });
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      mockRzpInstance.subscriptions.cancel.mockRejectedValueOnce(new Error('rzp down'));

      const result = await service.subscribe(
        { planId: 'plan-2', userCount: 4, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      expect(result).toHaveProperty('subscriptionId', 'sub_rzp_new');
      delete process.env.RAZORPAY_KEY_ID;
    });

    it('allows plan switch when ACTIVE subscription has cancelAtPeriodEnd=true', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: true,
      });
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});

      const result = await service.subscribe(
        { planId: 'plan-1', userCount: 2, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.CREATED, cancelAtPeriodEnd: false }),
        }),
      );
      expect(result).toHaveProperty('subscriptionId');
    });

    it('throws ForbiddenException when userCount is below the active user count', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.user.count as jest.Mock).mockResolvedValue(5);

      await expect(
        service.subscribe({ planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY }, mockCaller()),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRzpInstance.subscriptions.create).not.toHaveBeenCalled();
      expect(prisma.orgSubscription.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when userCount is below the plan minUsers (e.g. Enterprise with 17 seats)', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({
        ...mockPlan,
        id: 'plan-enterprise',
        minUsers: 21,
        maxUsers: null,
      });

      await expect(
        service.subscribe(
          { planId: 'plan-enterprise', userCount: 17, billingInterval: BillingInterval.MONTHLY },
          mockCaller(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRzpInstance.subscriptions.create).not.toHaveBeenCalled();
      expect(prisma.orgSubscription.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when userCount exceeds the plan maxUsers', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      await expect(
        service.subscribe(
          { planId: 'plan-1', userCount: 50, billingInterval: BillingInterval.MONTHLY },
          mockCaller(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRzpInstance.subscriptions.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller has no orgId', async () => {
      const callerNoOrg: AuthUser = {
        id: 'user-1',
        name: 'Admin',
        email: 'a@b.com',
        role: Role.DIRECTOR,
        orgId: null,
        teamId: null,
      };
      await expect(
        service.subscribe({ planId: 'plan-1', userCount: 1, billingInterval: BillingInterval.MONTHLY }, callerNoOrg),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException (not ForbiddenException) when both the plan is missing and userCount is below active users', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.count as jest.Mock).mockResolvedValue(5);

      await expect(
        service.subscribe({ planId: 'bad-plan', userCount: 3, billingInterval: BillingInterval.MONTHLY }, mockCaller()),
      ).rejects.toThrow(NotFoundException);
    });

    it('records a PENDING CouponRedemption and increments redemptionCount for a new subscription with a coupon', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'SAVE1000',
        discountType: DiscountType.FLAT,
        discountValue: 1000,
        applicablePlanTiers: [],
        maxRedemptions: 1,
        redemptionCount: 0,
        expiresAt: null,
        isActive: true,
      });

      await service.subscribe(
        { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY, couponCode: 'save1000' },
        mockCaller(),
      );

      expect(prisma.couponRedemption.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ couponId: 'coupon-1', orgId: 'org-1', subscriptionId: 'sub-new' }),
        }),
      );
      expect(prisma.coupon.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'coupon-1' }, data: { redemptionCount: { increment: 1 } } }),
      );
    });

    it('records a PENDING CouponRedemption against the existing subscription id on a plan switch with a coupon', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, id: 'plan-2' });
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.ACTIVE,
      });
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'SAVE1000',
        discountType: DiscountType.FLAT,
        discountValue: 1000,
        applicablePlanTiers: [],
        maxRedemptions: 1,
        redemptionCount: 0,
        expiresAt: null,
        isActive: true,
      });

      await service.subscribe(
        { planId: 'plan-2', userCount: 4, billingInterval: BillingInterval.MONTHLY, couponCode: 'SAVE1000' },
        mockCaller(),
      );

      expect(prisma.couponRedemption.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ couponId: 'coupon-1', orgId: 'org-1', subscriptionId: 'sub-1' }),
        }),
      );
    });

    it('repoints an existing redemption instead of erroring when the same org re-subscribes with the same coupon', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, id: 'plan-2' });
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.ACTIVE,
      });
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'SAVE1000',
        discountType: DiscountType.FLAT,
        discountValue: 1000,
        applicablePlanTiers: [],
        maxRedemptions: 10,
        redemptionCount: 1,
        expiresAt: null,
        isActive: true,
      });
      // This org already redeemed SAVE1000 once (e.g. a prior subscribe/switch call) —
      // CouponRedemption's @@unique([couponId, orgId]) means a second create() would throw.
      (prisma.couponRedemption.findUnique as jest.Mock).mockResolvedValue({
        id: 'redemption-existing',
        couponId: 'coupon-1',
        orgId: 'org-1',
        subscriptionId: 'sub-1',
      });

      await service.subscribe(
        { planId: 'plan-2', userCount: 4, billingInterval: BillingInterval.MONTHLY, couponCode: 'SAVE1000' },
        mockCaller(),
      );

      expect(prisma.couponRedemption.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'redemption-existing' },
          data: expect.objectContaining({ subscriptionId: 'sub-1', status: CouponRedemptionStatus.PENDING }),
        }),
      );
      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
      // Already counted on the first redemption — a repeat call must not double-increment.
      expect(prisma.coupon.update).not.toHaveBeenCalled();
    });

    it('passes offer_id and records the redemption as already APPLIED when the coupon has a matching Razorpay Offer', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'WELCOMEOFFER',
        discountType: DiscountType.FLAT,
        discountValue: 1000,
        applicablePlanTiers: [],
        maxRedemptions: null,
        redemptionCount: 0,
        expiresAt: null,
        isActive: true,
        razorpayOfferIds: { MONTHLY: { card: 'offer_monthly_card' }, ANNUAL: { card: 'offer_annual_card' } },
      });

      await service.subscribe(
        {
          planId: 'plan-1',
          userCount: 3,
          billingInterval: BillingInterval.MONTHLY,
          couponCode: 'WELCOMEOFFER',
          paymentMethod: 'card',
        },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({ offer_id: 'offer_monthly_card' }),
      );
      expect(prisma.couponRedemption.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            couponId: 'coupon-1',
            status: CouponRedemptionStatus.APPLIED,
            appliedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('falls back to the refund path (no offer_id, PENDING redemption) when paymentMethod is not given', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'WELCOMEOFFER',
        discountType: DiscountType.FLAT,
        discountValue: 1000,
        applicablePlanTiers: [],
        maxRedemptions: null,
        redemptionCount: 0,
        expiresAt: null,
        isActive: true,
        razorpayOfferIds: { MONTHLY: { card: 'offer_monthly_card' } },
      });

      await service.subscribe(
        { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY, couponCode: 'WELCOMEOFFER' },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ offer_id: expect.anything() }),
      );
      expect(prisma.couponRedemption.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ status: expect.anything() }),
        }),
      );
    });

    it('falls back to the refund path when no Offer is configured for the chosen payment method', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'WELCOMEOFFER',
        discountType: DiscountType.FLAT,
        discountValue: 1000,
        applicablePlanTiers: [],
        maxRedemptions: null,
        redemptionCount: 0,
        expiresAt: null,
        isActive: true,
        razorpayOfferIds: { MONTHLY: { card: 'offer_monthly_card' } },
      });

      await service.subscribe(
        {
          planId: 'plan-1',
          userCount: 3,
          billingInterval: BillingInterval.MONTHLY,
          couponCode: 'WELCOMEOFFER',
          paymentMethod: 'upi',
        },
        mockCaller(),
      );

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ offer_id: expect.anything() }),
      );
    });

    it('does not create a CouponRedemption when no coupon code is given', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });

      await service.subscribe(
        { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY },
        mockCaller(),
      );

      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
      expect(prisma.coupon.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid coupon code before creating a Razorpay subscription', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.subscribe(
          { planId: 'plan-1', userCount: 3, billingInterval: BillingInterval.MONTHLY, couponCode: 'NOPE' },
          mockCaller(),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockRzpInstance.subscriptions.create).not.toHaveBeenCalled();
      expect(prisma.orgSubscription.create).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    const makeRawBody = (payload: Record<string, unknown>) => Buffer.from(JSON.stringify(payload));

    it('throws UnauthorizedException on invalid HMAC signature', async () => {
      const secret = 'test-secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const payload = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_rzp_123' } } } };
      const rawBody = makeRawBody(payload);
      const badSig = 'deadbeef'.repeat(8);

      await expect(service.handleWebhook(rawBody, badSig, payload)).rejects.toThrow(UnauthorizedException);
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('throws UnauthorizedException when signature is missing (empty string) and secret is set', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'test-secret';

      const payload = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_rzp_123' } } } };
      const rawBody = makeRawBody(payload);

      await expect(service.handleWebhook(rawBody, '', payload)).rejects.toThrow(UnauthorizedException);
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('activates subscription and sets org planStatus to ACTIVE on subscription.activated', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_rzp_123' } } } };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.organization.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }) }),
      );
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planStatus: PlanStatus.ACTIVE }) }),
      );
    });

    it('creates a BillingEvent on subscription.charged', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = {
        event: 'subscription.charged',
        payload: {
          subscription: { entity: { id: 'sub_rzp_123' } },
          payment: { entity: { id: 'pay_123', amount: 99900, currency: 'INR', created_at: 1700000000 } },
        },
      };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.billingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-1',
            event: 'subscription.charged',
            amount: 999,
          }),
        }),
      );
    });

    it('refunds the discount and marks the redemption APPLIED when a coupon is pending on first charge', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = {
        event: 'subscription.charged',
        payload: {
          subscription: { entity: { id: 'sub_rzp_123' } },
          payment: { entity: { id: 'pay_123', amount: 99900, currency: 'INR', created_at: 1700000000 } },
        },
      };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.couponRedemption.findFirst as jest.Mock).mockResolvedValue({
        id: 'redemption-1',
        subscriptionId: 'sub-1',
        discountType: DiscountType.PERCENT,
        discountValue: 20,
        status: CouponRedemptionStatus.PENDING,
      });
      (prisma.couponRedemption.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(mockRzpInstance.payments.refund).toHaveBeenCalledWith('pay_123', { amount: Math.round(999 * 0.2 * 100) });
      expect(prisma.couponRedemption.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'redemption-1' },
          data: expect.objectContaining({ status: CouponRedemptionStatus.APPLIED, razorpayRefundId: 'rfnd_1' }),
        }),
      );
    });

    it('marks the redemption FAILED when the Razorpay refund call throws', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = {
        event: 'subscription.charged',
        payload: {
          subscription: { entity: { id: 'sub_rzp_123' } },
          payment: { entity: { id: 'pay_123', amount: 99900, currency: 'INR', created_at: 1700000000 } },
        },
      };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.couponRedemption.findFirst as jest.Mock).mockResolvedValue({
        id: 'redemption-1',
        subscriptionId: 'sub-1',
        discountType: DiscountType.FLAT,
        discountValue: 100,
        status: CouponRedemptionStatus.PENDING,
      });
      mockRzpInstance.payments.refund.mockRejectedValueOnce(new Error('refund failed'));
      (prisma.couponRedemption.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.couponRedemption.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'redemption-1' },
          data: { status: CouponRedemptionStatus.FAILED },
        }),
      );
    });

    it('sets status HALTED on subscription.halted', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = { event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_rzp_123' } } } };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: SubscriptionStatus.HALTED }) }),
      );
    });

    it('does nothing for unknown subscription IDs', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_unknown' } } } };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('sets status CANCELLED and org planStatus EXPIRED on subscription.cancelled', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = { event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_rzp_123' } } } };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.organization.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.CANCELLED, cancelledAt: expect.any(Date) }),
        }),
      );
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planStatus: PlanStatus.EXPIRED }) }),
      );
    });

    it('sets status CANCELLED and org planStatus EXPIRED on subscription.completed', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';

      const payload = { event: 'subscription.completed', payload: { subscription: { entity: { id: 'sub_rzp_123' } } } };
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.organization.update as jest.Mock).mockResolvedValue({});

      await service.handleWebhook(makeRawBody(payload), '', payload);

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.CANCELLED }),
        }),
      );
    });

    describe('payment_link.paid (addon confirmation)', () => {
      const pendingAddon = {
        id: 'addon-1',
        subscriptionId: 'sub-1',
        type: AddonType.EMAIL_CREDITS,
        quantity: 5000,
        usedCount: 0,
        pricePaid: 500,
        status: AddonStatus.PENDING,
        razorpayPaymentId: null,
        razorpayPaymentLinkId: 'plink_123',
        validUntil: null,
        createdAt: new Date(),
      };

      const makePayload = () => ({
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_123', status: 'paid' } },
          payment: { entity: { id: 'pay_addon_1', amount: 50000 } },
        },
      });

      it('marks a PENDING addon PAID and creates a BillingEvent', async () => {
        const payload = makePayload();
        (prisma.subscriptionAddon.findUnique as jest.Mock).mockResolvedValue(pendingAddon);
        (prisma.subscriptionAddon.update as jest.Mock).mockResolvedValue({});
        (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});

        await service.handleWebhook(makeRawBody(payload), '', payload);

        expect(prisma.subscriptionAddon.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'addon-1' },
            data: { status: AddonStatus.PAID, razorpayPaymentId: 'pay_addon_1' },
          }),
        );
        expect(prisma.billingEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ subscriptionId: 'sub-1', event: 'addon.paid', amount: 500 }),
          }),
        );
      });

      it('does nothing when the link id does not match any addon', async () => {
        const payload = makePayload();
        (prisma.subscriptionAddon.findUnique as jest.Mock).mockResolvedValue(null);

        await service.handleWebhook(makeRawBody(payload), '', payload);

        expect(prisma.subscriptionAddon.update).not.toHaveBeenCalled();
      });

      it('is idempotent when the addon is already PAID', async () => {
        const payload = makePayload();
        (prisma.subscriptionAddon.findUnique as jest.Mock).mockResolvedValue({
          ...pendingAddon,
          status: AddonStatus.PAID,
        });

        await service.handleWebhook(makeRawBody(payload), '', payload);

        expect(prisma.subscriptionAddon.update).not.toHaveBeenCalled();
        expect(prisma.billingEvent.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('purchaseAddon', () => {
    it('throws ForbiddenException for the GenXCRM internal org and never calls Razorpay or requires a subscription lookup', async () => {
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';

      await expect(
        service.purchaseAddon({ type: AddonType.EMAIL_CREDITS, quantity: 1 }, mockCaller('org-internal')),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.orgSubscription.findUnique).not.toHaveBeenCalled();
      expect(mockRzpInstance.paymentLink.create).not.toHaveBeenCalled();

      delete process.env.GENXCRM_INTERNAL_ORG_ID;
    });

    it('throws ForbiddenException when no active subscription', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.purchaseAddon({ type: AddonType.EMAIL_CREDITS, quantity: 1 }, mockCaller())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates a PENDING SubscriptionAddon record and returns payment link (credits withheld until paid)', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionAddon.create as jest.Mock).mockResolvedValue({});
      process.env.RAZORPAY_KEY_ID = 'rzp_test_key';

      const result = await service.purchaseAddon({ type: AddonType.EMAIL_CREDITS, quantity: 2 }, mockCaller());

      expect(prisma.subscriptionAddon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-1',
            type: AddonType.EMAIL_CREDITS,
            quantity: 10000,
            pricePaid: 400,
            status: AddonStatus.PENDING,
            razorpayPaymentLinkId: 'plink_123',
          }),
        }),
      );
      expect(result).toHaveProperty('paymentLink');
      delete process.env.RAZORPAY_KEY_ID;
    });

    it('throws ForbiddenException when Razorpay payment link creation fails', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
      mockRzpInstance.paymentLink.create.mockRejectedValueOnce(new Error('rzp down'));

      await expect(
        service.purchaseAddon({ type: AddonType.EMAIL_CREDITS, quantity: 2 }, mockCaller()),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.subscriptionAddon.create).not.toHaveBeenCalled();
      delete process.env.RAZORPAY_KEY_ID;
    });
  });

  describe('confirmPayment', () => {
    it('activates subscription and creates a BillingEvent', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.CREATED,
        razorpaySubId: 'sub_rzp_123',
      });
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({});
      (prisma.organization.update as jest.Mock).mockResolvedValue({});
      (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});

      const result = await service.confirmPayment('pay_abc', 'sub_rzp_123', mockCaller());

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }) }),
      );
      expect(prisma.billingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ razorpayPaymentId: 'pay_abc', event: 'subscription.authenticated' }),
        }),
      );
      expect(result.status).toBe('activated');
    });

    it('returns already_active when subscription is already ACTIVE', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.ACTIVE,
        razorpaySubId: 'sub_rzp_123',
      });

      const result = await service.confirmPayment('pay_abc', 'sub_rzp_123', mockCaller());
      expect(result.status).toBe('already_active');
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when subscription ID does not match', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.CREATED,
        razorpaySubId: 'sub_rzp_123',
      });

      await expect(
        service.confirmPayment('pay_abc', 'sub_rzp_WRONG', mockCaller()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateCoupon', () => {
    const mockCoupon = {
      id: 'coupon-1',
      code: 'WELCOME20',
      discountType: DiscountType.PERCENT,
      discountValue: 20,
      applicablePlanTiers: [] as string[],
      maxRedemptions: null as number | null,
      redemptionCount: 0,
      expiresAt: null as Date | null,
      isActive: true,
    };

    it('returns discount terms for a valid, unrestricted coupon (normalizing case)', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue(mockCoupon);
      const result = await service.validateCoupon('welcome20');
      expect(prisma.coupon.findUnique).toHaveBeenCalledWith({ where: { code: 'WELCOME20' } });
      expect(result).toMatchObject({ code: 'WELCOME20', discountType: DiscountType.PERCENT, discountValue: 20 });
    });

    it('throws NotFoundException for an unknown code', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.validateCoupon('NOPE')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for an inactive coupon', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({ ...mockCoupon, isActive: false });
      await expect(service.validateCoupon('WELCOME20')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for an expired coupon', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        ...mockCoupon,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.validateCoupon('WELCOME20')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException once maxRedemptions is reached', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        ...mockCoupon,
        maxRedemptions: 5,
        redemptionCount: 5,
      });
      await expect(service.validateCoupon('WELCOME20')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the plan tier is not in the coupon\'s allow-list', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        ...mockCoupon,
        applicablePlanTiers: ['enterprise'],
      });
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, tier: 'starter' });
      await expect(service.validateCoupon('WELCOME20', 'plan-1')).rejects.toThrow(ForbiddenException);
    });

    it('allows a plan tier that is in the allow-list', async () => {
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        ...mockCoupon,
        applicablePlanTiers: ['starter'],
      });
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, tier: 'starter' });
      await expect(service.validateCoupon('WELCOME20', 'plan-1')).resolves.toMatchObject({ code: 'WELCOME20' });
    });
  });

  describe('createSubscriptionForNewOrg', () => {
    it('creates the Razorpay subscription and OrgSubscription without a coupon', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });

      const result = await service.createSubscriptionForNewOrg('org-new', 'plan-1', 2, BillingInterval.MONTHLY);

      expect(mockRzpInstance.subscriptions.create).toHaveBeenCalled();
      expect(prisma.orgSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-new', planId: 'plan-1', userCount: 2 }),
        }),
      );
      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
      expect(result).toEqual({ subscriptionId: 'sub_rzp_new', razorpayKeyId: '' });
    });

    it('records a PENDING CouponRedemption and increments redemptionCount when a coupon is applied', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-new' });
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({
        id: 'coupon-1',
        code: 'WELCOME20',
        discountType: DiscountType.PERCENT,
        discountValue: 20,
        applicablePlanTiers: [],
        maxRedemptions: null,
        redemptionCount: 0,
        expiresAt: null,
        isActive: true,
      });

      await service.createSubscriptionForNewOrg('org-new', 'plan-1', 2, BillingInterval.MONTHLY, 'welcome20');

      expect(prisma.couponRedemption.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ couponId: 'coupon-1', orgId: 'org-new', subscriptionId: 'sub-new' }),
        }),
      );
      expect(prisma.coupon.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'coupon-1' }, data: { redemptionCount: { increment: 1 } } }),
      );
    });

    it('throws NotFoundException when the plan does not exist', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.createSubscriptionForNewOrg('org-new', 'missing-plan', 1, BillingInterval.MONTHLY),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when seats are outside the plan range', async () => {
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      await expect(
        service.createSubscriptionForNewOrg('org-new', 'plan-1', 999, BillingInterval.MONTHLY),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelSubscription', () => {
    it('sets cancelAtPeriodEnd to true', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({ ...mockSub, cancelAtPeriodEnd: true });

      const _result = await service.cancelSubscription(mockCaller());
      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cancelAtPeriodEnd: true }) }),
      );
    });

    it('throws ForbiddenException when no active subscription', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.cancelSubscription(mockCaller())).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateSeats', () => {
    it('updates userCount on subscription when decreasing seats', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({ ...mockSub, userCount: 2 });

      await service.updateSeats(2, mockCaller());
      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userCount: 2 }) }),
      );
    });

    it('throws ForbiddenException when increasing seats (must go through checkout)', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);

      await expect(service.updateSeats(5, mockCaller())).rejects.toThrow(ForbiddenException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the decreased userCount is still below plan.minUsers', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ ...mockPlan, minUsers: 2 });

      await expect(service.updateSeats(1, mockCaller())).rejects.toThrow(ForbiddenException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });
  });

  describe('initiateSeatUpdate', () => {
    const futurePeriodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    it('throws ForbiddenException for the GenXCRM internal org and never calls Razorpay or requires a subscription lookup', async () => {
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';

      await expect(service.initiateSeatUpdate(5, mockCaller('org-internal'))).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.orgSubscription.findUnique).not.toHaveBeenCalled();
      expect(mockRzpInstance.orders.create).not.toHaveBeenCalled();

      delete process.env.GENXCRM_INTERNAL_ORG_ID;
    });

    it('applies the change directly with no payment when decreasing seats', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        currentPeriodEnd: futurePeriodEnd,
      });
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({ ...mockSub, userCount: 2 });

      const result = await service.initiateSeatUpdate(2, mockCaller());

      expect(result.requiresPayment).toBe(false);
      expect(mockRzpInstance.orders.create).not.toHaveBeenCalled();
      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userCount: 2 }) }),
      );
    });

    it('creates a Razorpay order with the prorated amount when increasing seats', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        currentPeriodEnd: futurePeriodEnd,
      });
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);

      const result = await service.initiateSeatUpdate(5, mockCaller());

      expect(result.requiresPayment).toBe(true);
      if (result.requiresPayment) {
        expect(result.additionalSeats).toBe(2);
        expect(result.orderId).toBe('order_rzp_123');
        expect(result.amount).toBeGreaterThan(0);
      }
      expect(mockRzpInstance.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'INR', amount: expect.any(Number) }),
      );
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('falls back to a full 30-day charge when currentPeriodEnd is not set', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        currentPeriodEnd: null,
      });
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);

      const result = await service.initiateSeatUpdate(5, mockCaller());

      expect(result.requiresPayment).toBe(true);
      if (result.requiresPayment) {
        expect(result.remainingDays).toBe(30);
        expect(result.amount).toBe(Math.round((mockPlan.pricePerUser / 30) * 2 * 30));
      }
    });

    it('throws ForbiddenException when requested seat count exceeds plan maxUsers', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);

      await expect(service.initiateSeatUpdate(50, mockCaller())).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when Razorpay order creation fails', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSub,
        currentPeriodEnd: futurePeriodEnd,
      });
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      mockRzpInstance.orders.create.mockRejectedValueOnce(new Error('rzp down'));

      await expect(service.initiateSeatUpdate(5, mockCaller())).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when decreasing seats below the active user count, even within plan range', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.user.count as jest.Mock).mockResolvedValue(3);

      await expect(service.initiateSeatUpdate(2, mockCaller())).rejects.toThrow(ForbiddenException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });
  });

  describe('confirmSeatUpdate', () => {
    const validPayload = {
      userCount: 5,
      razorpayOrderId: 'order_rzp_123',
      razorpayPaymentId: 'pay_rzp_456',
    };

    const sign = (orderId: string, paymentId: string, secret: string) =>
      crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    beforeEach(() => {
      process.env.RAZORPAY_KEY_SECRET = 'test-secret';
    });

    afterEach(() => {
      delete process.env.RAZORPAY_KEY_SECRET;
    });

    it('applies the seat change and logs a BillingEvent on a valid signature', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({ ...mockSub, userCount: 5 });
      (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});

      const razorpaySignature = sign(validPayload.razorpayOrderId, validPayload.razorpayPaymentId, 'test-secret');

      await service.confirmSeatUpdate({ ...validPayload, razorpaySignature }, mockCaller());

      expect(prisma.orgSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userCount: 5 }) }),
      );
      expect(prisma.billingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'seats.upgraded',
            razorpayPaymentId: 'pay_rzp_456',
          }),
        }),
      );
    });

    it('throws UnauthorizedException on an invalid signature', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);

      await expect(
        service.confirmSeatUpdate({ ...validPayload, razorpaySignature: 'deadbeef'.repeat(8) }, mockCaller()),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the paid order was created for a different userCount', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      mockRzpInstance.orders.fetch.mockResolvedValueOnce({
        notes: { subscriptionId: 'sub-1', newUserCount: '2' }, // order was for 2 seats, not 5
      });

      const razorpaySignature = sign(validPayload.razorpayOrderId, validPayload.razorpayPaymentId, 'test-secret');

      await expect(
        service.confirmSeatUpdate({ ...validPayload, razorpaySignature }, mockCaller()),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the paid order belongs to a different subscription', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      mockRzpInstance.orders.fetch.mockResolvedValueOnce({
        notes: { subscriptionId: 'sub-other-org', newUserCount: '5' },
      });

      const razorpaySignature = sign(validPayload.razorpayOrderId, validPayload.razorpayPaymentId, 'test-secret');

      await expect(
        service.confirmSeatUpdate({ ...validPayload, razorpaySignature }, mockCaller()),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the payment was never captured', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      mockRzpInstance.payments.fetch.mockResolvedValueOnce({ status: 'failed', order_id: 'order_rzp_123' });

      const razorpaySignature = sign(validPayload.razorpayOrderId, validPayload.razorpayPaymentId, 'test-secret');

      await expect(
        service.confirmSeatUpdate({ ...validPayload, razorpaySignature }, mockCaller()),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the payment belongs to a different order', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      mockRzpInstance.payments.fetch.mockResolvedValueOnce({ status: 'captured', order_id: 'order_rzp_other' });

      const razorpaySignature = sign(validPayload.razorpayOrderId, validPayload.razorpayPaymentId, 'test-secret');

      await expect(
        service.confirmSeatUpdate({ ...validPayload, razorpaySignature }, mockCaller()),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.orgSubscription.update).not.toHaveBeenCalled();
    });

    it('applies the seat change when Razorpay returns notes.newUserCount as a number', async () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(mockSub);
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.orgSubscription.update as jest.Mock).mockResolvedValue({ ...mockSub, userCount: 5 });
      (prisma.billingEvent.create as jest.Mock).mockResolvedValue({});
      mockRzpInstance.orders.fetch.mockResolvedValueOnce({
        notes: { subscriptionId: 'sub-1', newUserCount: 5 },
      });

      const razorpaySignature = sign(validPayload.razorpayOrderId, validPayload.razorpayPaymentId, 'test-secret');

      await expect(
        service.confirmSeatUpdate({ ...validPayload, razorpaySignature }, mockCaller()),
      ).resolves.toBeDefined();
      expect(prisma.orgSubscription.update).toHaveBeenCalled();
    });
  });

  describe('email quota', () => {
    const freshOrg = { emailsSentThisCycle: 0, emailCycleStartedAt: new Date() };
    const trialFeatures = { emailCredits: 1000, whatsappCredits: 0 };
    const proFeatures = { emailCredits: 10000, whatsappCredits: 1000 };

    // No ACTIVE/AUTHENTICATED subscription — quotas fall back to the DB-seeded Trial
    // plan row (tier: 'trial') rather than a hardcoded constant.
    const mockTrialPlan = () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.subscriptionPlan.findFirst as jest.Mock).mockResolvedValue({ features: trialFeatures });
    };
    const mockProPlan = () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        plan: { features: proFeatures },
      });
    };

    describe('getEmailQuota / hasEmailQuota', () => {
      it('reports the Trial plan’s 1000 limit with no addons', async () => {
        mockTrialPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(freshOrg);
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.getEmailQuota('org-1');
        expect(result).toEqual({ limit: 1000, used: 0, remaining: 1000 });
        expect(prisma.subscriptionPlan.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { tier: 'trial' } }),
        );
      });

      it('adds unused paid EMAIL_CREDITS addon capacity to the limit', async () => {
        mockTrialPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
          emailsSentThisCycle: 1000,
          emailCycleStartedAt: new Date(),
        });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([
          { id: 'addon-1', quantity: 5000, usedCount: 200, status: AddonStatus.PAID, createdAt: new Date() },
        ]);

        const result = await service.getEmailQuota('org-1');
        expect(result).toEqual({ limit: 6000, used: 1000, remaining: 4800 });
      });

      it('resets the free allotment once the 30-day cycle has elapsed', async () => {
        mockTrialPlan();
        const stale = { emailsSentThisCycle: 999, emailCycleStartedAt: new Date(Date.now() - 31 * 86_400_000) };
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(stale);
        (prisma.organization.update as jest.Mock).mockResolvedValue({});
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.getEmailQuota('org-1');
        expect(prisma.organization.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'org-1' },
            data: expect.objectContaining({ emailsSentThisCycle: 0 }),
          }),
        );
        expect(result).toEqual({ limit: 1000, used: 0, remaining: 1000 });
      });

      it('hasEmailQuota returns false once both the free allotment and addons are exhausted', async () => {
        mockTrialPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
          emailsSentThisCycle: 1000,
          emailCycleStartedAt: new Date(),
        });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([
          { id: 'addon-1', quantity: 100, usedCount: 100, status: AddonStatus.PAID, createdAt: new Date() },
        ]);

        expect(await service.hasEmailQuota('org-1')).toBe(false);
      });

      it('hasEmailQuota never blocks when orgId is missing', async () => {
        expect(await service.hasEmailQuota(null)).toBe(true);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      });

      it('reports the subscribed plan’s 10000 base limit when the org has an ACTIVE subscription', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(freshOrg);
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.getEmailQuota('org-1');
        expect(result).toEqual({ limit: 10000, used: 0, remaining: 10000 });
        expect(prisma.subscriptionPlan.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('recordEmailSent', () => {
      it('increments the free-allotment counter while under the base limit', async () => {
        mockTrialPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(freshOrg);
        (prisma.organization.update as jest.Mock).mockResolvedValue({});

        await service.recordEmailSent('org-1');

        expect(prisma.organization.update).toHaveBeenCalledWith({
          where: { id: 'org-1' },
          data: { emailsSentThisCycle: { increment: 1 } },
        });
        expect(prisma.subscriptionAddon.findMany).not.toHaveBeenCalled();
      });

      it('consumes the oldest paid addon with remaining capacity once the base limit is used up', async () => {
        mockTrialPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
          emailsSentThisCycle: 1000,
          emailCycleStartedAt: new Date(),
        });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([
          { id: 'addon-old', quantity: 100, usedCount: 100, status: AddonStatus.PAID, createdAt: new Date(1) },
          { id: 'addon-new', quantity: 5000, usedCount: 0, status: AddonStatus.PAID, createdAt: new Date(2) },
        ]);
        (prisma.subscriptionAddon.update as jest.Mock).mockResolvedValue({});

        await service.recordEmailSent('org-1');

        expect(prisma.subscriptionAddon.update).toHaveBeenCalledWith({
          where: { id: 'addon-new' },
          data: { usedCount: { increment: 1 } },
        });
      });

      it('does nothing when orgId is missing', async () => {
        await service.recordEmailSent(null);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      });

      it('swallows a metering failure instead of throwing', async () => {
        (prisma.organization.findUnique as jest.Mock).mockRejectedValue(new Error('db down'));
        await expect(service.recordEmailSent('org-1')).resolves.toBeUndefined();
      });

      it('keeps incrementing the free allotment past 1000 for an ACTIVE-subscription org', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
          emailsSentThisCycle: 5000,
          emailCycleStartedAt: new Date(),
        });
        (prisma.organization.update as jest.Mock).mockResolvedValue({});

        await service.recordEmailSent('org-1');

        expect(prisma.organization.update).toHaveBeenCalledWith({
          where: { id: 'org-1' },
          data: { emailsSentThisCycle: { increment: 1 } },
        });
        expect(prisma.subscriptionAddon.findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('whatsapp quota', () => {
    const freshOrg = { whatsappCreditsUsed: 0 };
    const trialFeatures = { emailCredits: 1000, whatsappCredits: 0 };
    const proFeatures = { emailCredits: 10000, whatsappCredits: 1000 };

    const mockTrialPlan = () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.subscriptionPlan.findFirst as jest.Mock).mockResolvedValue({ features: trialFeatures });
    };
    const mockProPlan = () => {
      (prisma.orgSubscription.findUnique as jest.Mock).mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        plan: { features: proFeatures },
      });
    };

    describe('getWhatsAppQuota / hasWhatsAppQuota', () => {
      it('reports the subscribed plan’s 1000 one-time credit limit with no addons', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(freshOrg);
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.getWhatsAppQuota('org-1');
        expect(result).toEqual({ limit: 1000, used: 0, remaining: 1000 });
      });

      it('reports 0 credits for a Trial-status org — no shared-API WhatsApp without a connected WABA', async () => {
        mockTrialPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(freshOrg);
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.getWhatsAppQuota('org-1');
        expect(result).toEqual({ limit: 0, used: 0, remaining: 0 });
        expect(await service.hasWhatsAppQuota('org-1')).toBe(false);
      });

      it('adds unused paid WHATSAPP_CREDITS addon capacity to the limit', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ whatsappCreditsUsed: 1000 });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([
          { id: 'addon-1', quantity: 1000, usedCount: 200, status: AddonStatus.PAID, createdAt: new Date() },
        ]);

        const result = await service.getWhatsAppQuota('org-1');
        expect(result).toEqual({ limit: 2000, used: 1000, remaining: 800 });
      });

      it('does not reset even after 30+ days — the credit is one-time, not cyclical', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ whatsappCreditsUsed: 1000 });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.getWhatsAppQuota('org-1');
        expect(prisma.organization.update).not.toHaveBeenCalled();
        expect(result.remaining).toBe(0);
      });

      it('hasWhatsAppQuota returns false once the free allotment and addons are exhausted', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ whatsappCreditsUsed: 1000 });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([]);

        expect(await service.hasWhatsAppQuota('org-1')).toBe(false);
      });

      it('hasWhatsAppQuota never blocks when orgId is missing', async () => {
        expect(await service.hasWhatsAppQuota(null)).toBe(true);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      });
    });

    describe('recordWhatsAppSent', () => {
      it('increments the free-credit counter while under the 1000 base limit', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(freshOrg);
        (prisma.organization.update as jest.Mock).mockResolvedValue({});

        await service.recordWhatsAppSent('org-1');

        expect(prisma.organization.update).toHaveBeenCalledWith({
          where: { id: 'org-1' },
          data: { whatsappCreditsUsed: { increment: 1 } },
        });
        expect(prisma.subscriptionAddon.findMany).not.toHaveBeenCalled();
      });

      it('consumes the oldest paid WHATSAPP_CREDITS addon once the free credit is used up', async () => {
        mockProPlan();
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ whatsappCreditsUsed: 1000 });
        (prisma.subscriptionAddon.findMany as jest.Mock).mockResolvedValue([
          { id: 'addon-old', quantity: 100, usedCount: 100, status: AddonStatus.PAID, createdAt: new Date(1) },
          { id: 'addon-new', quantity: 1000, usedCount: 0, status: AddonStatus.PAID, createdAt: new Date(2) },
        ]);
        (prisma.subscriptionAddon.update as jest.Mock).mockResolvedValue({});

        await service.recordWhatsAppSent('org-1');

        expect(prisma.subscriptionAddon.update).toHaveBeenCalledWith({
          where: { id: 'addon-new' },
          data: { usedCount: { increment: 1 } },
        });
      });

      it('does nothing when orgId is missing', async () => {
        await service.recordWhatsAppSent(null);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      });

      it('swallows a metering failure instead of throwing', async () => {
        (prisma.organization.findUnique as jest.Mock).mockRejectedValue(new Error('db down'));
        await expect(service.recordWhatsAppSent('org-1')).resolves.toBeUndefined();
      });
    });
  });
});
