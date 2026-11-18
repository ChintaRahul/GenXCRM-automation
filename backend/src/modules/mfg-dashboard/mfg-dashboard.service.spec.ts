import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { MfgDashboardService } from './mfg-dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  mfgActivity: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  mfgLead: { count: jest.fn() },
  slaTimer: { count: jest.fn() },
  quotation: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  quotationLine: { groupBy: jest.fn() },
  opportunity: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  opportunityStageHistory: { findMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  siteVisit: { findMany: jest.fn() },
  evaluation: { findMany: jest.fn() },
  purchaseOrder: { aggregate: jest.fn() },
  paymentMilestone: { findMany: jest.fn() },
  receipt: { groupBy: jest.fn() },
  approval: { findMany: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
  masterValue: { findMany: jest.fn().mockResolvedValue([]) },
};

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('MfgDashboardService', () => {
  let service: MfgDashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Sensible defaults so every getMyDay/getTeam call resolves without per-test setup
    // unless a test cares about a specific value.
    mockPrisma.mfgActivity.count.mockResolvedValue(0);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([]);
    mockPrisma.mfgActivity.groupBy.mockResolvedValue([]);
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.slaTimer.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.groupBy.mockResolvedValue([]);
    mockPrisma.quotationLine.groupBy.mockResolvedValue([]);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    mockPrisma.opportunity.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: 0 });
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.groupBy.mockResolvedValue([]);
    mockPrisma.opportunityStageHistory.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({ monthlyTarget: 0 });
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
    mockPrisma.evaluation.findMany.mockResolvedValue([]);
    mockPrisma.purchaseOrder.aggregate.mockResolvedValue({ _count: 0, _sum: { value: 0 } });
    mockPrisma.paymentMilestone.findMany.mockResolvedValue([]);
    mockPrisma.receipt.groupBy.mockResolvedValue([]);
    mockPrisma.approval.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [MfgDashboardService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(MfgDashboardService);
  });

  describe('getMyDay', () => {
    it('combines overdue + today counts into dueToday, keeping overdueCount separate', async () => {
      mockPrisma.mfgActivity.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2); // overdue, dueToday
      const result = await service.getMyDay(directorUser);
      expect(result.kpis.overdueCount).toBe(3);
      expect(result.kpis.dueToday).toBe(5);
    });

    it('buckets action-queue items into overdue/today/soon/later by dueDate', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86_400_000);
      const inTwoDays = new Date(now.getTime() + 2 * 86_400_000);
      mockPrisma.mfgActivity.findMany.mockResolvedValue([
        { id: 'a1', type: 'Call', subject: 'Overdue call', dueDate: yesterday, priority: 'High', account: null, opportunity: null },
        { id: 'a2', type: 'Email', subject: 'No due date', dueDate: null, priority: 'Low', account: null, opportunity: null },
        { id: 'a3', type: 'Meeting', subject: 'Later', dueDate: inTwoDays, priority: 'Medium', account: { name: 'Acme' }, opportunity: { title: 'Deal' } },
      ]);
      const result = await service.getMyDay(directorUser);
      const byId = Object.fromEntries(result.actionQueue.map((a) => [a.id, a]));
      expect(byId.a1.state).toBe('overdue');
      expect(byId.a2.state).toBe('later');
      expect(byId.a3.accountName).toBe('Acme');
      expect(byId.a3.opportunityTitle).toBe('Deal');
    });

    it('sums quotation line amounts for "quotes awaiting reply" value (Quotation has no stored total)', async () => {
      mockPrisma.quotation.findMany.mockResolvedValue([{ id: 'q1' }, { id: 'q2' }]);
      mockPrisma.quotationLine.groupBy.mockResolvedValue([
        { quotationId: 'q1', _sum: { amount: 10000 } },
        { quotationId: 'q2', _sum: { amount: 25000 } },
      ]);
      const result = await service.getMyDay(directorUser);
      expect(result.kpis.quotesAwaitingReply).toEqual({ count: 2, value: 35000 });
    });

    it('computes quarterTarget pct from monthlyTarget * 3 and booked-this-quarter value', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ monthlyTarget: 100_000 });
      mockPrisma.opportunity.aggregate.mockResolvedValue({ _sum: { value: 204_000 } });
      const result = await service.getMyDay(directorUser);
      expect(result.kpis.quarterTarget).toEqual({ pct: 68, booked: 204_000, target: 300_000 });
    });

    it('returns 0% quarterTarget instead of dividing by zero when no monthlyTarget is set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ monthlyTarget: 0 });
      const result = await service.getMyDay(directorUser);
      expect(result.kpis.quarterTarget.pct).toBe(0);
    });

    it('groups open opportunities into the 3 pipeline phases with per-stage and phase totals', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([
        { stage: 'Qualified', value: 100, account: { name: 'Acme' } },
        { stage: 'Negotiation', value: 500, account: { name: 'Acme' } },
        { stage: 'Negotiation', value: 300, account: { name: 'Acme' } },
      ]);
      const result = await service.getMyDay(directorUser);
      const discovery = result.pipelineByPhase.find((p) => p.phase === 'Discovery')!;
      const closing = result.pipelineByPhase.find((p) => p.phase === 'Closing')!;
      expect(discovery.total).toBe(100);
      expect(closing.total).toBe(800);
      expect(closing.stages.find((s) => s.stage === 'Negotiation')?.value).toBe(800);
    });

    it('flags deals with an overdue nextActionDate as needing attention, sorted by value desc', async () => {
      mockPrisma.opportunity.findMany.mockImplementation((args: { orderBy?: unknown }) => {
        if (args?.orderBy) {
          return Promise.resolve([
            { id: 'op-1', title: 'Big deal', value: 900, stage: 'Negotiation', account: { name: 'Acme' } },
          ]);
        }
        return Promise.resolve([]);
      });
      const result = await service.getMyDay(directorUser);
      expect(result.dealsNeedingAttention).toEqual([
        { id: 'op-1', title: 'Big deal', accountName: 'Acme', stage: 'Negotiation', value: 900, reason: 'Next action overdue' },
      ]);
    });

    it('merges site visits and evaluations into one sorted visitsAndTrials list', async () => {
      const day1 = new Date(Date.now() + 86_400_000);
      const day2 = new Date(Date.now() + 2 * 86_400_000);
      mockPrisma.siteVisit.findMany.mockResolvedValue([{ id: 'v1', title: 'Site visit', visitDate: day2, account: { name: 'Acme' } }]);
      mockPrisma.evaluation.findMany.mockResolvedValue([{ id: 'e1', title: 'Trial', type: 'Trial', plannedDate: day1, account: { name: 'Beta' } }]);
      const result = await service.getMyDay(directorUser);
      expect(result.visitsAndTrials.map((v) => v.id)).toEqual(['e1', 'v1']);
      expect(result.visitsAndTrials[0].kind).toBe('trial');
      expect(result.visitsAndTrials[1].kind).toBe('visit');
    });
  });

  describe('getTeam', () => {
    it('computes weighted pipeline using each stage\'s seeded probability', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([
        { id: 'o1', stage: 'Qualified', value: 1000, ownerId: 'u1', createdAt: new Date() }, // 10% -> 100
        { id: 'o2', stage: 'Negotiation', value: 1000, ownerId: 'u1', createdAt: new Date() }, // 60% -> 600
      ]);
      const result = await service.getTeam(directorUser);
      expect(result.kpis.activePipeline).toBe(2000);
      expect(result.kpis.weightedPipeline).toBe(700);
    });

    it('uses the org\'s configured Masters stage probability over the seeded default', async () => {
      mockPrisma.masterValue.findMany.mockResolvedValue([{ value: 'Negotiation', numericValue: 70 }]);
      mockPrisma.opportunity.findMany.mockResolvedValue([{ id: 'o2', stage: 'Negotiation', value: 1000, ownerId: 'u1', createdAt: new Date() }]);
      const result = await service.getTeam(directorUser);
      expect(result.kpis.weightedPipeline).toBe(700);
    });

    it('reports target vs achievement from the monthly targets of reps and deals won in the period', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'A', monthlyTarget: 100_000 }, { id: 'u2', name: 'B', monthlyTarget: 100_000 }]);
      mockPrisma.opportunity.aggregate.mockResolvedValue({ _sum: { value: 50_000 }, _count: 1 });
      const result = await service.getTeam(directorUser);
      expect(result.kpis.targetVsAchievement.month).toEqual({ target: 200_000, achieved: 50_000, pct: 25 });
      expect(result.kpis.targetVsAchievement.quarter.target).toBe(600_000);
    });

    it('computes qualification rate as qualified/new, 0 when there are no new leads', async () => {
      mockPrisma.mfgLead.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      const result = await service.getTeam(directorUser);
      expect(result.kpis.qualificationRatePct).toBe(0);
    });

    it('computes win rate as won / (won + lost)', async () => {
      mockPrisma.opportunity.aggregate.mockResolvedValue({ _count: 3, _sum: { value: 900 } });
      mockPrisma.opportunity.count.mockResolvedValue(1); // lost count (first count() call in getTeam)
      const result = await service.getTeam(directorUser);
      expect(result.kpis.wonLost).toEqual({ won: 3, lost: 1, winRatePct: 75, wonValue: 900 });
    });

    it('computes each unpaid milestone\'s true outstanding as amount minus receipts already recorded', async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      mockPrisma.paymentMilestone.findMany.mockResolvedValue([
        { id: 'pm-1', amount: 1000, dueDate: yesterday, milestone: 'Advance', accountId: 'a1', account: { name: 'Acme' } },
        { id: 'pm-2', amount: 500, dueDate: yesterday, milestone: 'Retention', accountId: 'a2', account: { name: 'Beta' } },
      ]);
      mockPrisma.receipt.groupBy.mockResolvedValue([{ paymentMilestoneId: 'pm-1', _sum: { amount: 400 } }]);
      const result = await service.getTeam(directorUser);
      expect(result.kpis.outstanding.amount).toBe(600 + 500);
      expect(result.overduePayments.find((p) => p.id === 'pm-1')?.amount).toBe(600);
    });

    it('excludes a milestone whose receipts already cover its full amount from outstanding/overdue', async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      mockPrisma.paymentMilestone.findMany.mockResolvedValue([
        { id: 'pm-1', amount: 1000, dueDate: yesterday, milestone: 'Advance', accountId: 'a1', account: { name: 'Acme' } },
      ]);
      mockPrisma.receipt.groupBy.mockResolvedValue([{ paymentMilestoneId: 'pm-1', _sum: { amount: 1000 } }]);
      const result = await service.getTeam(directorUser);
      expect(result.kpis.outstanding.amount).toBe(0);
      expect(result.overduePayments).toHaveLength(0);
    });

    it('computes funnel step conversion as current/previous step count, null for the first step', async () => {
      mockPrisma.mfgLead.count.mockResolvedValue(50);
      mockPrisma.opportunity.count.mockResolvedValue(25);
      const result = await service.getTeam(directorUser);
      expect(result.funnel[0].conversionPct).toBeNull();
      expect(result.funnel[1].conversionPct).toBe(50); // 25 / 50
    });

    it('counts quotations as this month’s opportunities that are quoted or past that stage, and caps conversion at 100%', async () => {
      mockPrisma.mfgLead.count.mockResolvedValue(6);
      mockPrisma.opportunity.count.mockResolvedValue(7);
      const result = await service.getTeam(directorUser);
      expect(mockPrisma.opportunity.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            OR: [{ quotations: { some: { isDeleted: false } } }, { stage: { in: expect.arrayContaining(['Quotation sent', 'PO received', 'Won']) } }],
          }),
        }),
      );
      expect(result.funnel[1].conversionPct).toBe(100); // 7 / 6 capped
      expect(Math.max(...result.funnel.map((f) => f.conversionPct ?? 0))).toBeLessThanOrEqual(100);
    });

    it('shades an opportunity into the 31-60d aging bucket based on days since its last stage change', async () => {
      const oppId = 'op-aging-1';
      mockPrisma.opportunity.findMany.mockImplementation((args: { where?: { id?: { in?: string[] } } }) => {
        if (args?.where?.id?.in) {
          return Promise.resolve([{ id: oppId, stage: 'Technical discussion', createdAt: new Date(Date.now() - 90 * 86_400_000) }]);
        }
        return Promise.resolve([{ id: oppId, stage: 'Technical discussion', value: 500, ownerId: 'u1' }]);
      });
      mockPrisma.opportunityStageHistory.findMany.mockResolvedValue([
        { opportunityId: oppId, changedAt: new Date(Date.now() - 45 * 86_400_000) },
      ]);
      const result = await service.getTeam(directorUser);
      const group = result.aging.find((g) => g.group === 'Technical / visit')!;
      expect(group.buckets.find((b) => b.bucket === '31–60d')?.count).toBe(1);
      expect(group.buckets.find((b) => b.bucket === '0–15d')?.count).toBe(0);
    });

    it('computes each rep\'s target-attainment pct, 0 when no target is set', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep One', monthlyTarget: 100_000 }]);
      mockPrisma.opportunity.groupBy.mockResolvedValue([{ ownerId: 'rep-1', _sum: { value: 85_000 } }]);
      const result = await service.getTeam(directorUser);
      const row = result.teamPerformance.find((r) => r.userId === 'rep-1')!;
      expect(row.pct).toBe(85);
    });
  });
});
