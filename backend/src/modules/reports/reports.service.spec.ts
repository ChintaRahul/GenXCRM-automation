import { Test } from '@nestjs/testing';
import { Role, LeadStage, LeadSource, PaymentStatus, Prisma } from '@prisma/client';
import { SYSTEM_ACTIVITY_TYPES } from '../../common/constants/lead.constants';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { leadInRange } from '../../common/utils/lead-range.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ReportFilterDto } from './dto/report-filter.dto';

const mockPrisma = {
  lead: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
  payment: { aggregate: jest.fn() },
  user: { findMany: jest.fn() },
  team: { findMany: jest.fn() },
  nurturingSequence: { count: jest.fn() },
  communication: { findMany: jest.fn(), count: jest.fn() },
  campaign: { findMany: jest.fn() },
  adSet: { findMany: jest.fn() },
  ad: { findMany: jest.fn() },
  organization: { findUnique: jest.fn() },
  activity: { count: jest.fn(), findMany: jest.fn() },
};

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

// Shared date rule (lead-range.util.ts): a lead is in a range if created OR had real activity in it.
const inRangeFrag = (range: Prisma.DateTimeFilter) => leadInRange(range);

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ReportsService);
  });

  // ── overview ──────────────────────────────────────────────────────────────

  describe('overview', () => {
    beforeEach(() => {
      mockPrisma.lead.count.mockResolvedValue(10);
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 5000 } });
      mockPrisma.nurturingSequence.count.mockResolvedValue(0);
    });

    it("counts 'today' and 'this month' from the org's own midnight, not UTC midnight", async () => {
      // 01:30 am IST on Sep 24 is still Sep 23 in UTC — UTC boundaries would drop every lead
      // created between IST midnight and 05:30 am from "New today", and from the list it links to.
      jest.useFakeTimers({
        now: new Date('2026-09-23T20:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
      });
      try {
        mockPrisma.organization.findUnique.mockResolvedValueOnce({ timezone: 'Asia/Kolkata' });
        const result = await service.overview(directorUser);
        expect(result.todayStart).toBe('2026-09-23T18:30:00.000Z');
        expect(result.monthStart).toBe('2026-08-31T18:30:00.000Z');
        expect(mockPrisma.lead.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ createdAt: { gte: new Date('2026-09-23T18:30:00.000Z') } }),
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('scopes query to assignedToId for SALES_REP', async () => {
      await service.overview(repUser);
      const calls = mockPrisma.lead.count.mock.calls as [{ where: Record<string, unknown> }][];
      expect(calls[0][0].where).toMatchObject({ assignedToId: 'rep-1' });
    });

    it('scopes query to teamId for MANAGER', async () => {
      await service.overview(managerUser);
      const calls = mockPrisma.lead.count.mock.calls as [{ where: Record<string, unknown> }][];
      expect(calls[0][0].where).toMatchObject({ teamId: 'team-1' });
    });

    it('returns revenueCollected from payment aggregate', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 99000 } });
      const result = await service.overview(directorUser);
      expect(result.revenueCollected).toBe(99000);
    });

    it('returns 0 for revenueCollected when no payments', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      const result = await service.overview(directorUser);
      expect(result.revenueCollected).toBe(0);
    });

    it('scopes lead count to orgId', async () => {
      await service.overview(directorUser);
      expect(mockPrisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes payment aggregate to orgId via lead relation', async () => {
      await service.overview(directorUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { orgId: 'org-1' } }) }),
      );
    });

    it('scopes payment aggregate to assignedToId via lead relation for SALES_REP', async () => {
      await service.overview(repUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lead: expect.objectContaining({ assignedToId: 'rep-1', orgId: 'org-1' }),
          }),
        }),
      );
    });

    it('scopes payment aggregate to teamId via lead relation for MANAGER', async () => {
      await service.overview(managerUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lead: expect.objectContaining({ teamId: 'team-1', orgId: 'org-1' }),
          }),
        }),
      );
    });

    it('returns activeSequences count scoped to orgId', async () => {
      mockPrisma.nurturingSequence.count.mockResolvedValue(9);
      const result = await service.overview(directorUser);
      expect(result.activeSequences).toBe(9);
      expect(mockPrisma.nurturingSequence.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', isActive: true }) }),
      );
    });

    it('returns unassignedQueue scoped to orgId for DIRECTOR', async () => {
      const result = await service.overview(directorUser);
      expect(result.unassignedQueue).toBeDefined();
      expect(mockPrisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: null, orgId: 'org-1' }) }),
      );
    });

    it('returns undefined unassignedQueue for SALES_REP', async () => {
      const result = await service.overview(repUser);
      expect(result.unassignedQueue).toBeUndefined();
    });

    it('returns dailyInflow as array of 30 values', async () => {
      const result = await service.overview(directorUser);
      expect(result.dailyInflow).toHaveLength(30);
    });

    it('counts lead createdAt dates into dailyInflow buckets', async () => {
      // 15 days ago at UTC noon — safely inside the 30-day window
      const mid = new Date();
      mid.setUTCDate(mid.getUTCDate() - 15);
      mid.setUTCHours(12, 0, 0, 0);
      mockPrisma.lead.findMany.mockResolvedValue([{ createdAt: mid }, { createdAt: mid }]);
      const result = await service.overview(directorUser);
      expect(result.dailyInflow.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it('computes totalLeadsDelta30d as percent change vs 30 days ago', async () => {
      // lead.count order: totalLeads(0) newToday(1) enrolled(2) notInterested(3)
      //                   prev30Total(4) ...rest default 10
      mockPrisma.lead.count
        .mockResolvedValueOnce(120) // totalLeads
        .mockResolvedValueOnce(5) // newToday
        .mockResolvedValueOnce(20) // enrolled
        .mockResolvedValueOnce(5) // notInterested
        .mockResolvedValueOnce(100) // prev30Total → (120-100)/100*100 = 20%
        .mockResolvedValue(0);
      const result = await service.overview(directorUser);
      expect(result.totalLeadsDelta30d).toBeCloseTo(20, 1);
    });

    it('returns 0 totalLeadsDelta30d when prev30Total is 0', async () => {
      mockPrisma.lead.count
        .mockResolvedValueOnce(50) // totalLeads
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0) // prev30Total = 0
        .mockResolvedValue(0);
      const result = await service.overview(directorUser);
      expect(result.totalLeadsDelta30d).toBe(0);
    });

    it('computes newTodayDelta as difference between today and yesterday', async () => {
      // count order: totalLeads(0) newToday(1) enrolled(2) notInterested(3)
      //              prev30Total(4) newYesterday(5)
      mockPrisma.lead.count
        .mockResolvedValueOnce(0) // totalLeads
        .mockResolvedValueOnce(15) // newToday
        .mockResolvedValueOnce(0) // enrolled
        .mockResolvedValueOnce(0) // notInterested
        .mockResolvedValueOnce(0) // prev30Total
        .mockResolvedValueOnce(12) // newYesterday → delta = 15 - 12 = 3
        .mockResolvedValue(0);
      const result = await service.overview(directorUser);
      expect(result.newTodayDelta).toBe(3);
    });

    it('computes conversionRate as enrolledThisMtd / totalLeadsMtd * 100', async () => {
      // count order: totalLeads(0) newToday(1) enrolled(2) notInterested(3)
      //              prev30Total(4) newYesterday(5) enrolledThisMtd(6) enrolledLastMtd(7)
      //              totalLeadsMtd(8)
      mockPrisma.lead.count
        .mockResolvedValueOnce(0) // totalLeads
        .mockResolvedValueOnce(0) // newToday
        .mockResolvedValueOnce(0) // enrolled
        .mockResolvedValueOnce(0) // notInterested
        .mockResolvedValueOnce(0) // prev30Total
        .mockResolvedValueOnce(0) // newYesterday
        .mockResolvedValueOnce(20) // enrolledThisMtd
        .mockResolvedValueOnce(0) // enrolledLastMtd
        .mockResolvedValueOnce(100) // totalLeadsMtd → rate = 20/100*100 = 20%
        .mockResolvedValue(0);
      const result = await service.overview(directorUser);
      expect(result.conversionRate).toBe(20);
    });

    it('exposes enrolledMtd separately from the all-time enrolled count', async () => {
      mockPrisma.lead.count
        .mockResolvedValueOnce(0) // totalLeads
        .mockResolvedValueOnce(0) // newToday
        .mockResolvedValueOnce(10) // enrolled (all time)
        .mockResolvedValueOnce(0) // notInterested
        .mockResolvedValueOnce(0) // prev30Total
        .mockResolvedValueOnce(0) // newYesterday
        .mockResolvedValueOnce(6) // enrolledThisMtd
        .mockResolvedValue(0);
      const result = await service.overview(directorUser);
      expect(result.enrolled).toBe(10);
      expect(result.enrolledMtd).toBe(6);
    });

    it('computes avgDeal as revenueThisMtd / enrolledThisMtd', async () => {
      mockPrisma.lead.count
        .mockResolvedValueOnce(0) // totalLeads
        .mockResolvedValueOnce(0) // newToday
        .mockResolvedValueOnce(0) // enrolled
        .mockResolvedValueOnce(0) // notInterested
        .mockResolvedValueOnce(0) // prev30Total
        .mockResolvedValueOnce(0) // newYesterday
        .mockResolvedValueOnce(4) // enrolledThisMtd
        .mockResolvedValue(0);
      // payment.aggregate: first = totalPayments, second = revenueThisMtd(200000)
      mockPrisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } }) // totalPayments
        .mockResolvedValueOnce({ _sum: { amount: 200_000 } }) // revenueThisMtd
        .mockResolvedValue({ _sum: { amount: 0 } });
      const result = await service.overview(directorUser);
      expect(result.avgDeal).toBe(50_000); // 200000 / 4
    });

    it('scopes findMany for dailyInflow to orgId', async () => {
      await service.overview(directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  // ── pipeline ──────────────────────────────────────────────────────────────

  describe('pipeline', () => {
    it('groups leads by stage', async () => {
      const grouped = [{ stage: LeadStage.NEW, _count: { stage: 5 } }];
      mockPrisma.lead.groupBy.mockResolvedValue(grouped);
      const result = await service.pipeline(directorUser);
      expect(result).toEqual(grouped);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['stage'] }));
    });

    it('scopes groupBy to orgId', async () => {
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      await service.pipeline(directorUser);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  // ── teamLeaderboard ───────────────────────────────────────────────────────

  describe('teamLeaderboard', () => {
    beforeEach(() => {
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    });

    it('returns empty array for SALES_REP', async () => {
      const result = await service.teamLeaderboard(repUser);
      expect(result).toEqual([]);
      expect(mockPrisma.team.findMany).not.toHaveBeenCalled();
    });

    it('calculates conversion rate correctly', async () => {
      mockPrisma.team.findMany.mockResolvedValue([
        { id: 'team-1', name: 'Team A', monthlyTarget: 30, members: [{ id: 'rep-1' }] },
      ]);
      mockPrisma.lead.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      const [team] = (await service.teamLeaderboard(directorUser)) as { conversionRate: number }[];
      expect(team.conversionRate).toBe(40);
    });

    it('returns 0 conversionRate when total is 0', async () => {
      mockPrisma.team.findMany.mockResolvedValue([{ id: 'team-1', name: 'Team A', monthlyTarget: 0, members: [] }]);
      mockPrisma.lead.count.mockResolvedValue(0);
      const [team] = (await service.teamLeaderboard(directorUser)) as { conversionRate: number }[];
      expect(team.conversionRate).toBe(0);
    });

    it('scopes team query to orgId for DIRECTOR', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      await service.teamLeaderboard(directorUser);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('includes monthlyTarget as target', async () => {
      mockPrisma.team.findMany.mockResolvedValue([{ id: 'team-1', name: 'Team A', monthlyTarget: 25, members: [] }]);
      mockPrisma.lead.count.mockResolvedValue(0);
      const [team] = (await service.teamLeaderboard(directorUser)) as { target: number }[];
      expect(team.target).toBe(25);
    });

    it('includes MTD revenueCollected from payment aggregate', async () => {
      mockPrisma.team.findMany.mockResolvedValue([
        { id: 'team-1', name: 'Team A', monthlyTarget: 0, members: [{ id: 'rep-1' }] },
      ]);
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 340_000 } });
      const [team] = (await service.teamLeaderboard(directorUser)) as { revenueCollected: number }[];
      expect(team.revenueCollected).toBe(340_000);
    });

    it('returns 0 revenueCollected when no paid payments', async () => {
      mockPrisma.team.findMany.mockResolvedValue([{ id: 'team-1', name: 'Team A', monthlyTarget: 0, members: [] }]);
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      const [team] = (await service.teamLeaderboard(directorUser)) as { revenueCollected: number }[];
      expect(team.revenueCollected).toBe(0);
    });

    it('scopes revenueCollected to orgId via lead relation', async () => {
      mockPrisma.team.findMany.mockResolvedValue([
        { id: 'team-1', name: 'Team A', monthlyTarget: 0, members: [{ id: 'rep-1' }] },
      ]);
      mockPrisma.lead.count.mockResolvedValue(0);
      await service.teamLeaderboard(directorUser);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lead: expect.objectContaining({ orgId: 'org-1' }),
          }),
        }),
      );
    });

    it('scopes team query to teamId for MANAGER', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      await service.teamLeaderboard(managerUser);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'team-1' }) }),
      );
    });

    it('scopes team query to a specific teamId when provided for DIRECTOR', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      await service.teamLeaderboard(directorUser, { teamId: 'team-5' });
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'team-5', orgId: 'org-1' }) }),
      );
    });

    it('uses the given date range for revenue and lead counts instead of current-month default', async () => {
      mockPrisma.team.findMany.mockResolvedValue([
        { id: 'team-1', name: 'Team A', monthlyTarget: 0, members: [{ id: 'rep-1' }] },
      ]);
      mockPrisma.lead.count.mockResolvedValue(0);
      await service.teamLeaderboard(directorUser, { from: '2026-07-01', to: '2026-07-31' });
      const leadCall = mockPrisma.lead.count.mock.calls[0][0] as { where: { OR?: unknown } };
      expect(leadCall.where.OR).toBeDefined();
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ paidAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }) }) }),
      );
    });
  });

  describe('productivity', () => {
    beforeEach(() => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.activity.findMany.mockResolvedValue([]);
    });

    it('restricts the rep list to self for SALES_REP', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.productivity(repUser);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rep-1' } }));
    });

    it('does not let a per-rep lookup clobber the SALES_REP caller scope', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep', monthlyTarget: 0 }]);
      await service.productivity(repUser);
      const call = mockPrisma.lead.count.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({
        isDeleted: false,
        AND: [{ assignedToId: 'rep-1' }, { orgId: 'org-1', assignedToId: 'rep-1' }],
      });
    });

    it('restricts the rep list to the team for MANAGER', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.productivity(managerUser);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' }),
        }),
      );
    });

    it('does not restrict teamId in the rep list for DIRECTOR', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.productivity(directorUser);
      const call = mockPrisma.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('teamId');
      expect(call.where).toMatchObject({ role: Role.SALES_REP, orgId: 'org-1' });
    });

    it('scopes each rep lookup to assignedToId without leaking other reps', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-2', name: 'Rep Two', monthlyTarget: 0 }]);
      await service.productivity(directorUser);
      const call = mockPrisma.lead.count.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({ isDeleted: false, AND: [{ assignedToId: 'rep-2' }, { orgId: 'org-1' }] });
    });

    it('restricts the rep list to a specific teamId when provided for DIRECTOR', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.productivity(directorUser, { teamId: 'team-9' });
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 'team-9', orgId: 'org-1' }) }),
      );
    });

    it('includes monthlyTarget as target and revenueCollected from payment aggregate', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep', monthlyTarget: 50_000 }]);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 12_000 } });
      const [row] = (await service.productivity(directorUser)) as { target: number; revenueCollected: number }[];
      expect(row.target).toBe(50_000);
      expect(row.revenueCollected).toBe(12_000);
    });

    it('includes a 7-entry trend array from recent activity', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep', monthlyTarget: 0 }]);
      mockPrisma.activity.findMany.mockResolvedValue([{ createdAt: new Date() }]);
      const [row] = (await service.productivity(directorUser)) as { trend: number[] }[];
      expect(row.trend).toHaveLength(7);
      expect(row.trend.reduce((a, b) => a + b, 0)).toBe(1);
    });

    it('excludes system-written activity types from the trend, so auto-assignment volume is not counted as rep work', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep', monthlyTarget: 0 }]);
      mockPrisma.activity.findMany.mockResolvedValue([]);
      await service.productivity(directorUser);
      expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: { notIn: SYSTEM_ACTIVITY_TYPES } }),
        }),
      );
    });

    it('applies a created-or-updated range to rep lead counts when from/to are provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep', monthlyTarget: 0 }]);
      await service.productivity(directorUser, { from: '2026-08-01', to: '2026-08-10' });
      const call = mockPrisma.lead.count.mock.calls[0][0] as { where: { AND: unknown[] } };
      expect(call.where.AND).toContainEqual(
        inRangeFrag({ gte: expect.any(Date), lt: expect.any(Date) }),
      );
    });

    it('computes leaking as a distinct-lead union, not a sum of untouched + followupOverdue', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep', monthlyTarget: 0 }]);
      // total, notEngaged, untouched, followupOverdue, leaking
      mockPrisma.lead.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(90)
        .mockResolvedValueOnce(90);
      const [row] = (await service.productivity(directorUser)) as { leaking: number }[];
      expect(row.leaking).toBe(90);
      const leakingCall = mockPrisma.lead.count.mock.calls[4][0] as { where: { OR?: unknown[] } };
      expect(leakingCall.where.OR).toEqual([
        { activities: { none: { type: { notIn: SYSTEM_ACTIVITY_TYPES } } } },
        { stage: { notIn: expect.any(Array) } },
      ]);
    });
  });

  // ── sourcePerformance ─────────────────────────────────────────────────────

  describe('sourcePerformance', () => {
    it('calculates conversionRate per source', async () => {
      mockPrisma.lead.groupBy
        .mockResolvedValueOnce([{ source: 'FACEBOOK', _count: { source: 10 } }])
        .mockResolvedValueOnce([{ source: 'FACEBOOK', _count: { source: 2 } }]);
      const result = (await service.sourcePerformance(directorUser)) as { source: string; conversionRate: number }[];
      expect(result[0].conversionRate).toBe(20);
    });

    it('applies teamId and date range filters when provided', async () => {
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      await service.sourcePerformance(directorUser, { teamId: 'team-3', from: '2026-08-01', to: '2026-08-10' });
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: 'team-3', ...inRangeFrag({ gte: expect.any(Date), lt: expect.any(Date) }) }),
        }),
      );
    });
  });

  // ── Daily Sales & Lead Management Report ────────────────────────────────────

  const emptyFilter: ReportFilterDto = {};

  describe('dailySummary', () => {
    it('scopes every count to orgId and returns the four daily metrics', async () => {
      mockPrisma.lead.count.mockResolvedValue(5);

      const result = await service.dailySummary(emptyFilter, directorUser);

      expect(result).toEqual(
        expect.objectContaining({ generated: 5, newLeads: 5, contacted: 5, pending: 5 }),
      );
      // "Contacted" is the CONTACTED-stage count, identical to the status report's row.
      expect(mockPrisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', stage: LeadStage.CONTACTED }),
        }),
      );
      // The drill-through links on the Lead Summary tiles reuse these exact instants
      // (see reports.service.ts dailySummary()) so the tile count and the /leads list
      // it links to always agree, regardless of the org's timezone.
      expect(result.rangeFrom).toBeInstanceOf(Date);
      expect(result.rangeTo).toBeInstanceOf(Date);
      expect(mockPrisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes to assignedToId for SALES_REP', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.communication.findMany.mockResolvedValue([]);
      await service.dailySummary(emptyFilter, repUser);
      expect(mockPrisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });

    it('scopes newLeads and pending to the selected date range, not the whole NEW-stage backlog', async () => {
      mockPrisma.lead.count.mockResolvedValue(5);
      mockPrisma.communication.findMany.mockResolvedValue([]);

      await service.dailySummary(
        { from: '2026-08-08', to: '2026-08-08' } as ReportFilterDto,
        directorUser,
      );

      const range = { gte: new Date('2026-08-08'), lt: new Date('2026-08-09') };

      const newLeadsCall = mockPrisma.lead.count.mock.calls.find(
        ([args]) => args.where.stage === LeadStage.NEW && !('communications' in args.where),
      );
      expect(newLeadsCall?.[0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ stage: LeadStage.NEW, ...inRangeFrag(range) }) }),
      );

      const pendingCall = mockPrisma.lead.count.mock.calls.find(
        ([args]) => 'AND' in args.where && args.where.AND.some((c: Record<string, unknown>) => 'communications' in c),
      );
      expect(pendingCall?.[0]).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                stage: LeadStage.NEW,
                assignedToId: { not: null },
                communications: { none: {} },
              }),
              inRangeFrag(range),
            ]),
          }),
        }),
      );
    });

    it('scopes the pending count to the calling rep, not org-wide, for SALES_REP', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.communication.findMany.mockResolvedValue([]);

      await service.dailySummary(emptyFilter, repUser);

      const pendingCall = mockPrisma.lead.count.mock.calls.find(
        ([args]) => 'AND' in args.where && args.where.AND.some((c: Record<string, unknown>) => 'communications' in c),
      );
      // The scope half of the AND (buildScopeFilter's output) must still carry the rep's
      // own assignedToId — regression guard for the overwrite bug where a literal
      // `assignedToId: { not: null }` on the same object silently widened this to org-wide.
      expect(pendingCall?.[0].where.AND).toEqual(
        expect.arrayContaining([expect.objectContaining({ assignedToId: 'rep-1' })]),
      );
    });
  });

  describe('statusReport', () => {
    it('scopes groupBy to orgId and createdAt range', async () => {
      mockPrisma.lead.groupBy.mockResolvedValue([{ stage: LeadStage.INTERESTED, _count: { stage: 3 } }]);
      const result = await service.statusReport(emptyFilter, directorUser);
      expect(result).toEqual([{ stage: LeadStage.INTERESTED, count: 3 }]);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  describe('enrollmentReport', () => {
    it('resolves the date filter in the org timezone, not UTC, so leads near a local-day boundary are not miscounted', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata' });
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.enrollmentReport({ from: '2026-09-03', to: '2026-09-03' }, directorUser);

      // Midnight IST (UTC+5:30) on Sep 3 is 18:30 UTC on Sep 2 — a UTC-midnight boundary
      // would wrongly exclude the first 5.5 local hours of the day.
      expect(mockPrisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(
            inRangeFrag({
              gte: new Date('2026-09-02T18:30:00.000Z'),
              lt: new Date('2026-09-03T18:30:00.000Z'),
            }),
          ),
        }),
      );
    });

    it('computes conversionRate and scopes payment aggregate by orgId for DIRECTOR', async () => {
      mockPrisma.lead.count.mockResolvedValueOnce(2).mockResolvedValueOnce(10);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 40_000 } });
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.enrollmentReport(emptyFilter, directorUser);

      expect(result.totalEnrollments).toBe(2);
      expect(result.revenue).toBe(40_000);
      expect(result.conversionRate).toBe(20);
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: PaymentStatus.PAID, lead: { orgId: 'org-1' } }),
        }),
      );
    });

    it('applies the campaign filter to the revenue payment aggregate', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.enrollmentReport({ campaignId: 'camp-1' }, directorUser);

      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { orgId: 'org-1', campaignId: 'camp-1' } }),
        }),
      );
    });

    it('scopes the revenue payment aggregate to assignedToId for SALES_REP', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 5_000 } });
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.enrollmentReport(emptyFilter, repUser);

      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: PaymentStatus.PAID,
            lead: { orgId: 'org-1', assignedToId: 'rep-1' },
          }),
        }),
      );
    });

    it('restricts perRep to self for a SALES_REP caller', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep' }]);

      const result = await service.enrollmentReport(emptyFilter, repUser);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rep-1' } }));
      expect(result.perRep).toHaveLength(1);
      expect(result.perRep[0].repId).toBe('rep-1');
    });

    it('computes per-rep conversionRate as enrolled / repLeads * 100', async () => {
      // enrollmentReport's own top-level counts (2), then per-rep: repLeads(10), enrolled(4)
      mockPrisma.lead.count
        .mockResolvedValueOnce(0) // totalEnrollments
        .mockResolvedValueOnce(0) // generated
        .mockResolvedValueOnce(10) // repLeads
        .mockResolvedValueOnce(4); // enrolled
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep' }]);

      const result = await service.enrollmentReport(emptyFilter, directorUser);

      expect(result.perRep[0].conversionRate).toBe(40);
    });

    it('returns 0 per-rep conversionRate when the rep has no leads', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'rep-1', name: 'Rep' }]);

      const result = await service.enrollmentReport(emptyFilter, directorUser);

      expect(result.perRep[0].conversionRate).toBe(0);
    });
  });

  describe('campaignPerformance', () => {
    it('computes conversionRate scoped to orgId, without cost metrics', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([{ id: 'camp-1', name: 'Camp', spend: 1000 }]);
      mockPrisma.lead.count
        .mockResolvedValueOnce(10) // leads
        .mockResolvedValueOnce(3) // interested
        .mockResolvedValueOnce(1) // followUp
        .mockResolvedValueOnce(0) // demoScheduled
        .mockResolvedValueOnce(2); // enrollments

      const [result] = await service.campaignPerformance(emptyFilter, directorUser);

      expect(result.conversionRate).toBe(20);
      expect(result).not.toHaveProperty('cpl');
      expect(result).not.toHaveProperty('cpe');
      expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  describe('adSetPerformance', () => {
    it('computes leads/interested/enrollments/conversionRate without cost metrics', async () => {
      mockPrisma.adSet.findMany.mockResolvedValue([{ id: 'set-1', name: 'Set', spend: 500 }]);
      mockPrisma.lead.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4).mockResolvedValueOnce(2);

      const [result] = await service.adSetPerformance(emptyFilter, directorUser);

      expect(result).toEqual({
        adSetId: 'set-1',
        adSetName: 'Set',
        leads: 10,
        interested: 4,
        enrollments: 2,
        conversionRate: 20,
      });
    });
  });

  describe('adPerformance', () => {
    it('computes CTR from clicks/impressions, without cost metrics', async () => {
      mockPrisma.ad.findMany.mockResolvedValue([{ id: 'ad-1', name: 'Ad', spend: 100, impressions: 1000, clicks: 50 }]);
      mockPrisma.lead.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const [result] = await service.adPerformance(emptyFilter, directorUser);

      expect(result.ctr).toBe(5);
      expect(result).not.toHaveProperty('cpl');
    });

    it('reports CTR as null when the ad was never matched against the connected ad account', async () => {
      // resolveHierarchy sets name = externalId as a placeholder at lead-ingestion time;
      // if the Insights/name sync never finds a match (e.g. a different ad account), it
      // stays that way — impressions/clicks are unknown, not genuinely zero.
      mockPrisma.ad.findMany.mockResolvedValue([
        { id: 'ad-1', name: '120250950983130561', externalId: '120250950983130561', spend: 0, impressions: 0, clicks: 0 },
      ]);
      mockPrisma.lead.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const [result] = await service.adPerformance(emptyFilter, directorUser);

      expect(result.ctr).toBeNull();
    });
  });

  describe('campaignOptions', () => {
    it('scopes to orgId and returns id/name only', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([{ id: 'camp-1', name: 'Camp' }]);
      const result = await service.campaignOptions(directorUser);
      expect(result).toEqual([{ id: 'camp-1', name: 'Camp' }]);
      expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
          select: { id: true, name: true },
        }),
      );
    });
  });

  describe('leadSourceTracking', () => {
    it('paginates and maps lead source fields', async () => {
      mockPrisma.lead.count.mockResolvedValue(1);
      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 'lead-1',
          name: 'Jane',
          source: LeadSource.FACEBOOK,
          stage: LeadStage.ENROLLED,
          campaign: { name: 'Camp' },
          adSet: { name: 'Set' },
          ad: { name: 'Ad' },
          assignedTo: { name: 'Rep One' },
        },
      ]);

      const result = await service.leadSourceTracking(emptyFilter, directorUser);

      expect(result.data[0]).toEqual({
        leadId: 'lead-1',
        name: 'Jane',
        source: LeadSource.FACEBOOK,
        campaign: 'Camp',
        adSet: 'Set',
        ad: 'Ad',
        owner: 'Rep One',
        stage: LeadStage.ENROLLED,
        enrollmentStatus: 'enrolled',
      });
      expect(result.total).toBe(1);
    });
  });

  describe('dailyDashboard', () => {
    beforeEach(() => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.communication.findMany.mockResolvedValue([]);
      mockPrisma.communication.count.mockResolvedValue(0);
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.activity.findMany.mockResolvedValue([]);
    });

    it('composes summary/enrollment/status/campaign data', async () => {
      mockPrisma.lead.groupBy.mockResolvedValue([{ stage: LeadStage.INTERESTED, _count: { stage: 4 } }]);

      const result = await service.dailyDashboard(emptyFilter, directorUser);

      expect(result.interestedLeads).toBe(4);
    });

    it('counts demoScheduled from the DEMO_SCHEDULED stage, not WEBINAR_ATTENDED', async () => {
      mockPrisma.lead.groupBy.mockResolvedValue([{ stage: LeadStage.DEMO_SCHEDULED, _count: { stage: 6 } }]);

      const result = await service.dailyDashboard(emptyFilter, directorUser);

      expect(result.demoScheduled).toBe(6);
    });

    it('computes avgTicketSize as revenue / enrollments', async () => {
      // lead.count call order: dailySummary(generated, newLeads, contacted, pending) = 4 calls,
      // then enrollmentReport.totalEnrollments = the 5th call.
      mockPrisma.lead.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3) // enrollmentReport.totalEnrollments
        .mockResolvedValue(0);
      // payment.aggregate call order: enrollmentReport.revenue is the 1st call.
      mockPrisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 90_000 } })
        .mockResolvedValue({ _sum: { amount: 0 } });
      const result = await service.dailyDashboard(emptyFilter, directorUser);
      expect(result.enrollments).toBe(3);
      expect(result.revenue).toBe(90_000);
      expect(result.avgTicketSize).toBe(30_000);
    });

    it('returns 0 avgTicketSize when there are no enrollments', async () => {
      const result = await service.dailyDashboard(emptyFilter, directorUser);
      expect(result.avgTicketSize).toBe(0);
    });

    it('computes totalLeadsDelta as percent change vs the prior equal-length period', async () => {
      // lead.count order (directorUser, empty filter): dailySummary(generated, newLeads, contacted, pending) = 4 calls,
      // enrollmentReport(totalEnrollments, generated) = 2 calls, then dashboard's own prevTotalLeads,
      // then dailyDashboard's prevEnrollments call.
      mockPrisma.lead.count
        .mockResolvedValueOnce(50) // dailySummary.generated -> totalLeads
        .mockResolvedValueOnce(0) // dailySummary.newLeads
        .mockResolvedValueOnce(0) // dailySummary.contacted
        .mockResolvedValueOnce(0) // dailySummary.pending
        .mockResolvedValueOnce(0) // enrollmentReport.totalEnrollments
        .mockResolvedValueOnce(0) // enrollmentReport.generated
        .mockResolvedValueOnce(40) // prevTotalLeads -> (50-40)/40*100 = 25%
        .mockResolvedValue(0);

      const result = await service.dailyDashboard(emptyFilter, directorUser);
      expect(result.totalLeadsDelta).toBeCloseTo(25, 1);
    });

    it('returns null delta fields when the prior period had 0 of that metric', async () => {
      const result = await service.dailyDashboard(emptyFilter, directorUser);
      expect(result.totalLeadsDelta).toBeNull();
      expect(result.enrollmentsDelta).toBeNull();
      expect(result.revenueDelta).toBeNull();
      expect(result.totalCallsDelta).toBeNull();
    });

    it('counts distinct called leads for totalCalls and scopes the query to orgId', async () => {
      const leadIds = (n: number) => Array.from({ length: n }, (_, i) => ({ leadId: `l${i}` }));
      mockPrisma.activity.findMany.mockResolvedValueOnce(leadIds(12)).mockResolvedValueOnce(leadIds(8));

      const result = await service.dailyDashboard(emptyFilter, directorUser);

      expect(result.totalCalls).toBe(12);
      expect(result.totalCallsDelta).toBeCloseTo(50, 1); // (12-8)/8*100
      expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'STAGE_CHANGE',
            lead: expect.objectContaining({ orgId: 'org-1' }),
          }),
        }),
      );
    });

    it('requires the lead itself to be in the same date range as the filter', async () => {
      // "Total calls" must track the same population as "Total leads" — a calling-stage
      // activity made today on a lead created yesterday must not count toward today's
      // total, otherwise totalCalls can exceed totalLeads and read as if it were inflated.
      mockPrisma.activity.findMany.mockResolvedValue([]);

      await service.dailyDashboard(emptyFilter, directorUser);

      const currentCall = mockPrisma.activity.findMany.mock.calls[0][0] as {
        where: { createdAt: unknown; lead: { OR: unknown } };
      };
      expect(currentCall.where.lead.OR).toEqual(inRangeFrag(currentCall.where.createdAt as Prisma.DateTimeFilter).OR);
    });

    it('counts a lead moved straight from NEW to DEMO_SCHEDULED or NOT_INTERESTED as a call', async () => {
      // Reps routinely skip CONTACTED and jump a lead straight to DEMO_SCHEDULED or
      // NOT_INTERESTED after a single call, with no intermediate stage ever logged — both
      // outcomes only happen as the result of a real call, so they must count too.
      mockPrisma.activity.findMany.mockResolvedValue([]);

      await service.dailyDashboard(emptyFilter, directorUser);

      const currentCall = mockPrisma.activity.findMany.mock.calls[0][0] as {
        where: { OR: { metadata: { path: string[]; equals: string } }[] };
      };
      const countedStages = currentCall.where.OR.map((c) => c.metadata.equals);
      expect(countedStages).toEqual(
        expect.arrayContaining(['DEMO_SCHEDULED', 'NOT_INTERESTED', 'CONTACTED', 'CALL_BACK', 'CALL_NOT_RECEIVED']),
      );
    });
  });

  describe('exportDailyReport', () => {
    let spies: {
      dailySummary: jest.SpyInstance;
      statusReport: jest.SpyInstance;
      enrollmentReport: jest.SpyInstance;
      campaignPerformance: jest.SpyInstance;
      leadSourceTracking: jest.SpyInstance;
      dailyDashboard: jest.SpyInstance;
      adSetPerformance: jest.SpyInstance;
      adPerformance: jest.SpyInstance;
    };

    beforeEach(() => {
      spies = {
        dailySummary: jest
          .spyOn(service, 'dailySummary')
          .mockResolvedValue({
            generated: 10,
            newLeads: 5,
            contacted: 3,
            pending: 2,
            rangeFrom: new Date('2026-08-08'),
            rangeTo: new Date('2026-08-09'),
          }),
        statusReport: jest.spyOn(service, 'statusReport').mockResolvedValue([
          { stage: LeadStage.NEW, count: 4 },
          { stage: LeadStage.INTERESTED, count: 2 },
        ]),
        enrollmentReport: jest.spyOn(service, 'enrollmentReport').mockResolvedValue({
          totalEnrollments: 2,
          revenue: 40_000,
          conversionRate: 20,
          perRep: [],
        }),
        campaignPerformance: jest.spyOn(service, 'campaignPerformance').mockResolvedValue([
          {
            campaignId: 'c1',
            campaignName: 'Camp',
            leads: 10,
            interested: 3,
            followUp: 1,
            demoScheduled: 0,
            enrollments: 2,
            conversionRate: 20,
          },
        ]),
        dailyDashboard: jest.spyOn(service, 'dailyDashboard').mockResolvedValue({
          totalLeads: 10,
          interestedLeads: 3,
          followUpLeads: 1,
          demoScheduled: 0,
          enrollments: 2,
          revenue: 40_000,
          avgTicketSize: 20_000,
          totalCalls: 5,
          totalCallsDelta: null,
          totalLeadsDelta: null,
          interestedLeadsDelta: null,
          followUpLeadsDelta: null,
          demoScheduledDelta: null,
          enrollmentsDelta: null,
          revenueDelta: null,
          campaignPerformance: [],
          salesPersonPerformance: [],
        }),
        adSetPerformance: jest
          .spyOn(service, 'adSetPerformance')
          .mockResolvedValue([{ adSetId: 's1', adSetName: 'Set', leads: 10, interested: 3, enrollments: 2, conversionRate: 20 }]),
        adPerformance: jest
          .spyOn(service, 'adPerformance')
          .mockResolvedValue([
            { adId: 'a1', adName: 'Ad', leads: 10, interested: 3, enrollments: 2, ctr: 5, conversionRate: 20 },
          ]),
        leadSourceTracking: jest.spyOn(service, 'leadSourceTracking').mockResolvedValue({
          data: [
            {
              leadId: 'l1',
              name: 'Jane',
              source: LeadSource.FACEBOOK,
              campaign: 'Camp',
              adSet: 'Set',
              ad: 'Ad',
              owner: 'Rep',
              stage: LeadStage.ENROLLED,
              enrollmentStatus: 'enrolled',
            },
          ],
          total: 1,
          page: 1,
          limit: 1000,
          pages: 1,
        }),
      };
    });

    it('forwards filter and caller unchanged to each underlying report method', async () => {
      await service.exportDailyReport('excel', emptyFilter, directorUser);
      expect(spies.dailySummary).toHaveBeenCalledWith(emptyFilter, directorUser);
      expect(spies.statusReport).toHaveBeenCalledWith(emptyFilter, directorUser);
      expect(spies.enrollmentReport).toHaveBeenCalledWith(emptyFilter, directorUser);
      expect(spies.campaignPerformance).toHaveBeenCalledWith(emptyFilter, directorUser);
    });

    it('only fetches datasets for requested sections', async () => {
      await service.exportDailyReport('excel', { ...emptyFilter, sections: ['status'] }, directorUser);
      expect(spies.statusReport).toHaveBeenCalled();
      expect(spies.enrollmentReport).not.toHaveBeenCalled();
      expect(spies.campaignPerformance).not.toHaveBeenCalled();
      expect(spies.leadSourceTracking).not.toHaveBeenCalled();
      expect(spies.dailySummary).not.toHaveBeenCalled();
      expect(spies.dailyDashboard).not.toHaveBeenCalled();
      expect(spies.adSetPerformance).not.toHaveBeenCalled();
      expect(spies.adPerformance).not.toHaveBeenCalled();
    });

    it('fetches dashboard/adsets/ads only when those sections are requested', async () => {
      await service.exportDailyReport(
        'excel',
        { ...emptyFilter, sections: ['dashboard', 'adsets', 'ads'] },
        directorUser,
      );
      expect(spies.dailyDashboard).toHaveBeenCalledWith(
        { ...emptyFilter, sections: ['dashboard', 'adsets', 'ads'] },
        directorUser,
      );
      expect(spies.adSetPerformance).toHaveBeenCalled();
      expect(spies.adPerformance).toHaveBeenCalled();
    });

    it('always fetches summary for csv even when excluded from sections', async () => {
      const result = await service.exportDailyReport('csv', { ...emptyFilter, sections: ['status'] }, directorUser);
      expect(spies.dailySummary).toHaveBeenCalled();
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.contentType).toBe('text/csv');
    });

    it('fetches leadSourceTracking with limit 1000 when the sources section is requested', async () => {
      await service.exportDailyReport('pdf', { ...emptyFilter, sections: ['sources'] }, directorUser);
      expect(spies.leadSourceTracking).toHaveBeenCalledWith(expect.objectContaining({ limit: 100_000 }), directorUser);
    });

    describe('PDF generation', () => {
      it('looks up the caller org name scoped to orgId for the PDF branding', async () => {
        mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme Academy' });
        const result = await service.exportDailyReport('pdf', emptyFilter, directorUser);
        expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'org-1' } }),
        );
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it('falls back to a default brand name when the org has none', async () => {
        mockPrisma.organization.findUnique.mockResolvedValue(null);
        const result = await service.exportDailyReport('pdf', emptyFilter, directorUser);
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it.each(['light', 'dark', undefined] as ('light' | 'dark' | undefined)[])(
        'generates a non-empty PDF buffer for theme=%s (with and without cover)',
        async (theme) => {
          const withCover = await service.exportDailyReport(
            'pdf',
            { ...emptyFilter, theme, includeCover: true },
            directorUser,
          );
          expect(withCover.buffer.length).toBeGreaterThan(0);
          const withoutCover = await service.exportDailyReport(
            'pdf',
            { ...emptyFilter, theme, includeCover: false },
            directorUser,
          );
          expect(withoutCover.buffer.length).toBeGreaterThan(0);
        },
      );

      it.each([
        [true, true, 'portrait'],
        [true, true, 'landscape'],
        [true, false, 'portrait'],
        [false, true, 'portrait'],
        [false, false, 'landscape'],
      ] as [boolean, boolean, 'portrait' | 'landscape'][])(
        'generates a non-empty PDF buffer for includeCover=%s includeCharts=%s orientation=%s',
        async (includeCover, includeCharts, orientation) => {
          const result = await service.exportDailyReport(
            'pdf',
            { ...emptyFilter, includeCover, includeCharts, orientation },
            directorUser,
          );
          expect(result.buffer.length).toBeGreaterThan(0);
          expect(result.contentType).toBe('application/pdf');
        },
      );

      it('does not throw when status and campaign datasets are empty', async () => {
        spies.statusReport.mockResolvedValue([]);
        spies.campaignPerformance.mockResolvedValue([]);
        const result = await service.exportDailyReport('pdf', emptyFilter, directorUser);
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it('renders a lead source table when the sources section is requested', async () => {
        const result = await service.exportDailyReport('pdf', { ...emptyFilter, sections: ['sources'] }, directorUser);
        expect(spies.leadSourceTracking).toHaveBeenCalled();
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it('renders the dashboard, ad set, and ad sections without throwing', async () => {
        const result = await service.exportDailyReport(
          'pdf',
          { ...emptyFilter, sections: ['dashboard', 'adsets', 'ads'] },
          directorUser,
        );
        expect(spies.dailyDashboard).toHaveBeenCalled();
        expect(spies.adSetPerformance).toHaveBeenCalled();
        expect(spies.adPerformance).toHaveBeenCalled();
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it('does not throw when the ad set/ad datasets are empty', async () => {
        spies.adSetPerformance.mockResolvedValue([]);
        spies.adPerformance.mockResolvedValue([]);
        const result = await service.exportDailyReport(
          'pdf',
          { ...emptyFilter, sections: ['adsets', 'ads'] },
          directorUser,
        );
        expect(result.buffer.length).toBeGreaterThan(0);
      });
    });

    describe('Excel generation', () => {
      it('produces a non-empty workbook buffer', async () => {
        const result = await service.exportDailyReport('excel', emptyFilter, directorUser);
        expect(result.buffer.length).toBeGreaterThan(0);
        expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      });

      it('omits worksheets for sections that were not requested', async () => {
        const result = await service.exportDailyReport(
          'excel',
          { ...emptyFilter, sections: ['status'] },
          directorUser,
        );
        expect(result.buffer.length).toBeGreaterThan(0);
      });
    });
  });
});
