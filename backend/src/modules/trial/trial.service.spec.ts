import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlanStatus, SubscriptionStatus } from '@prisma/client';
import { TrialService } from './trial.service';
import { PrismaService } from '../../prisma/prisma.service';

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  user: { count: jest.fn() },
  lead: { count: jest.fn() },
  nurturingSequence: { count: jest.fn() },
  team: { count: jest.fn() },
  orgSubscription: { findUnique: jest.fn() },
  subscriptionPlan: { findFirst: jest.fn() },
};

const mockOrg = { name: 'Acme Edu', planStatus: PlanStatus.TRIAL, trialEndsAt: futureDate };

const trialPlanFeatures = { leads: 100, users: 5, sequences: 2, teams: 1 };
const proPlanFeatures = { leads: 10000, users: -1, sequences: 10, teams: 10 };

describe('TrialService', () => {
  let service: TrialService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [TrialService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(TrialService);

    mockPrisma.user.count.mockResolvedValue(2);
    mockPrisma.lead.count.mockResolvedValue(10);
    mockPrisma.nurturingSequence.count.mockResolvedValue(1);
    mockPrisma.team.count.mockResolvedValue(1);
    mockPrisma.subscriptionPlan.findFirst.mockResolvedValue({ features: trialPlanFeatures });
  });

  describe('getStatus', () => {
    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('org-1')).rejects.toThrow(NotFoundException);
    });

    it('returns active trial status with positive daysRemaining', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      const result = await service.getStatus('org-1');
      expect(result.planStatus).toBe(PlanStatus.TRIAL);
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.isExpired).toBe(false);
    });

    it('returns usage counts from db', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      const result = await service.getStatus('org-1');
      expect(result.usage).toEqual({ leads: 10, users: 2, sequences: 1, teams: 1 });
    });

    it('returns the Trial plan row features (tier: trial) in limits field', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      const result = await service.getStatus('org-1');
      expect(result.limits).toEqual(trialPlanFeatures);
      expect(mockPrisma.subscriptionPlan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tier: 'trial' } }),
      );
    });

    it('auto-expires trial and returns EXPIRED when trialEndsAt is in the past', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ ...mockOrg, trialEndsAt: pastDate });
      mockPrisma.organization.update.mockResolvedValue({});
      const result = await service.getStatus('org-1');
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { planStatus: PlanStatus.EXPIRED },
      });
      expect(result.planStatus).toBe(PlanStatus.EXPIRED);
      expect(result.isExpired).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });

    it('does not call update when already EXPIRED', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        ...mockOrg,
        planStatus: PlanStatus.EXPIRED,
        trialEndsAt: pastDate,
      });
      const result = await service.getStatus('org-1');
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
      expect(result.isExpired).toBe(true);
    });

    it('returns ACTIVE and skips trial logic when OrgSubscription is ACTIVE', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        plan: { features: proPlanFeatures },
      });
      const result = await service.getStatus('org-1');
      expect(result.planStatus).toBe(PlanStatus.ACTIVE);
      expect(result.isExpired).toBe(false);
      expect(result.daysRemaining).toBe(0);
    });

    it('syncs org.planStatus to ACTIVE when subscription is ACTIVE but org is still TRIAL', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        plan: { features: proPlanFeatures },
      });
      mockPrisma.organization.update.mockResolvedValue({});
      await service.getStatus('org-1');
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { planStatus: PlanStatus.ACTIVE },
      });
    });

    it('returns ACTIVE without calling update when org.planStatus is already ACTIVE', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ ...mockOrg, planStatus: PlanStatus.ACTIVE });
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        plan: { features: proPlanFeatures },
      });
      await service.getStatus('org-1');
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('returns the subscribed plan features (not the Trial row) in limits field when ACTIVE', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        plan: { features: proPlanFeatures },
      });
      const result = await service.getStatus('org-1');
      expect(result.limits).toEqual(proPlanFeatures);
      expect(mockPrisma.subscriptionPlan.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('checkLimit', () => {
    it('returns early when orgId is null', async () => {
      await service.checkLimit(null, 'leads');
      expect(mockPrisma.orgSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('returns early when orgId is undefined', async () => {
      await service.checkLimit(undefined, 'leads');
      expect(mockPrisma.orgSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('returns early when subscription is ACTIVE', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 5,
        plan: { features: proPlanFeatures },
      });
      await service.checkLimit('org-1', 'leads');
      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('returns early when subscription is AUTHENTICATED', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.AUTHENTICATED,
        userCount: 5,
        plan: { features: proPlanFeatures },
      });
      await service.checkLimit('org-1', 'leads');
      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('throws SEAT_LIMIT_REACHED when active org is at its paid seat count', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 1,
        plan: { features: proPlanFeatures },
      });
      mockPrisma.user.count.mockResolvedValue(7);
      await expect(service.checkLimit('org-1', 'users')).rejects.toThrow(ForbiddenException);
      await expect(service.checkLimit('org-1', 'users')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SEAT_LIMIT_REACHED', limit: 1, current: 7 }),
      });
    });

    it('allows a new user when active org is below its paid seat count', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 10,
        plan: { features: proPlanFeatures },
      });
      mockPrisma.user.count.mockResolvedValue(7);
      await expect(service.checkLimit('org-1', 'users')).resolves.toBeUndefined();
    });

    it('does not enforce seats on non-user resources for active orgs', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 1,
        plan: { features: proPlanFeatures },
      });
      await expect(service.checkLimit('org-1', 'leads')).resolves.toBeUndefined();
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
    });

    it('throws PLAN_LIMIT_REACHED when an active org is at its subscribed plan leads cap', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 5,
        plan: { features: proPlanFeatures },
      });
      mockPrisma.lead.count.mockResolvedValue(10000);
      await expect(service.checkLimit('org-1', 'leads')).rejects.toThrow(ForbiddenException);
      await expect(service.checkLimit('org-1', 'leads')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PLAN_LIMIT_REACHED', resource: 'leads', limit: 10000, current: 10000 }),
      });
    });

    it('allows an active org below its subscribed plan sequences cap', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 5,
        plan: { features: proPlanFeatures },
      });
      mockPrisma.nurturingSequence.count.mockResolvedValue(9);
      await expect(service.checkLimit('org-1', 'sequences')).resolves.toBeUndefined();
    });

    it('throws PLAN_LIMIT_REACHED when an active org is at its subscribed plan teams cap', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        userCount: 5,
        plan: { features: proPlanFeatures },
      });
      mockPrisma.team.count.mockResolvedValue(10);
      await expect(service.checkLimit('org-1', 'teams')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PLAN_LIMIT_REACHED', resource: 'teams', limit: 10 }),
      });
    });

    it('throws ForbiddenException with TRIAL_EXPIRED code when trial has expired', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue({ ...mockOrg, trialEndsAt: pastDate });
      mockPrisma.organization.update.mockResolvedValue({});
      await expect(service.checkLimit('org-1', 'leads')).rejects.toThrow(ForbiddenException);
      await expect(service.checkLimit('org-1', 'leads')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TRIAL_EXPIRED' }),
      });
    });

    it('throws ForbiddenException with LIMIT_REACHED when resource is at the Trial plan limit', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.lead.count.mockResolvedValue(100);
      await expect(service.checkLimit('org-1', 'leads')).rejects.toThrow(ForbiddenException);
      await expect(service.checkLimit('org-1', 'leads')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LIMIT_REACHED', resource: 'leads' }),
      });
    });

    it('does not throw when resource count is below limit', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.lead.count.mockResolvedValue(50);
      await expect(service.checkLimit('org-1', 'leads')).resolves.toBeUndefined();
    });

    it('returns early when planStatus is not TRIAL', async () => {
      mockPrisma.orgSubscription.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue({ ...mockOrg, planStatus: PlanStatus.ACTIVE });
      await expect(service.checkLimit('org-1', 'leads')).resolves.toBeUndefined();
    });
  });
});
