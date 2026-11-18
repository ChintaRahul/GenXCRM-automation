import { REPORT_BUILDERS } from './mfg-report-builders';
import type { PrismaService } from '../../prisma/prisma.service';

function mockPrisma(overrides: Record<string, Record<string, jest.Mock>>): PrismaService {
  const base: Record<string, Record<string, jest.Mock>> = {
    mfgLead: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    opportunity: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: { value: 0 } }) },
    opportunityStageHistory: { findMany: jest.fn().mockResolvedValue([]) },
    masterValue: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    quotation: { findMany: jest.fn().mockResolvedValue([]) },
    paymentMilestone: { findMany: jest.fn().mockResolvedValue([]) },
    receipt: { groupBy: jest.fn().mockResolvedValue([]) },
    installedAsset: { findMany: jest.fn().mockResolvedValue([]) },
    coverage: { findMany: jest.fn().mockResolvedValue([]) },
    salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
    serviceTicket: { findMany: jest.fn().mockResolvedValue([]) },
    slaPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    slaTimer: { findMany: jest.fn().mockResolvedValue([]) },
    automationRun: { findMany: jest.fn().mockResolvedValue([]) },
  };
  for (const [model, methods] of Object.entries(overrides)) Object.assign(base[model], methods);
  return base as unknown as PrismaService;
}

describe('mfg-report-builders', () => {
  describe('Lead source & campaign performance', () => {
    it('groups by source and computes conversion % per source', async () => {
      const prisma = mockPrisma({
        mfgLead: {
          findMany: jest.fn().mockResolvedValue([
            { source: 'Website', status: 'Converted' },
            { source: 'Website', status: 'New' },
            { source: null, status: 'Qualified' },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Lead source & campaign performance'](prisma, 'org-1');
      const website = result.rows.find((r) => r.source === 'Website')!;
      expect(website).toEqual({ source: 'Website', total: 2, qualified: 1, converted: 1, conversionPct: 50 });
      const unknown = result.rows.find((r) => r.source === 'Unknown')!;
      expect(unknown).toMatchObject({ total: 1, qualified: 1, converted: 0 });
    });
  });

  describe('Salesperson / team performance', () => {
    it('lists deal owners even when no one has a monthly target, and asks for target holders too', async () => {
      const userFindMany = jest.fn().mockResolvedValue([{ id: 'u1', name: 'Asha', monthlyTarget: null }]);
      const prisma = mockPrisma({
        opportunity: {
          findMany: jest.fn().mockResolvedValue([
            { ownerId: 'u1', stage: 'Qualified', value: 1000 },
            { ownerId: 'u1', stage: 'Won', value: 500 },
          ]),
        },
        user: { findMany: userFindMany },
      });
      const result = await REPORT_BUILDERS['Salesperson / team performance'](prisma, 'org-1');
      expect(userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', OR: [{ monthlyTarget: { gt: 0 } }, { id: { in: ['u1'] } }] } }),
      );
      expect(result.rows).toEqual([{ name: 'Asha', pipeline: 1000, won: 500, target: 0, attainmentPct: 0 }]);
    });
  });

  describe('Opportunity stage conversion', () => {
    it('includes every seeded stage plus Won/Lost, even with zero deals', async () => {
      const prisma = mockPrisma({ opportunity: { findMany: jest.fn().mockResolvedValue([{ stage: 'Won', value: 500 }]) } });
      const result = await REPORT_BUILDERS['Opportunity stage conversion'](prisma, 'org-1');
      expect(result.rows.find((r) => r.stage === 'Won')).toEqual({ stage: 'Won', count: 1, value: 500 });
      expect(result.rows.find((r) => r.stage === 'Qualified')).toEqual({ stage: 'Qualified', count: 0, value: 0 });
    });
  });

  describe('Pipeline & weighted pipeline', () => {
    it('excludes Won/Lost and weights each stage by its seeded probability', async () => {
      const prisma = mockPrisma({
        opportunity: {
          findMany: jest.fn().mockResolvedValue([
            { stage: 'Qualified', value: 1000 }, // 10%
            { stage: 'Negotiation', value: 1000 }, // 60%
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Pipeline & weighted pipeline'](prisma, 'org-1');
      expect(result.totals).toEqual({ value: 2000, weighted: 700 });
    });
  });

  describe('Win/loss & lost reason', () => {
    it('breaks lost deals down by reason and includes a single Won summary row', async () => {
      const prisma = mockPrisma({
        opportunity: {
          aggregate: jest.fn().mockResolvedValue({ _count: 2, _sum: { value: 5000 } }),
          findMany: jest.fn().mockResolvedValue([
            { lostReason: 'Price', value: 200 },
            { lostReason: 'Price', value: 300 },
            { lostReason: null, value: 100 },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Win/loss & lost reason'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ reason: 'Won', count: 2, value: 5000 });
      expect(result.rows).toContainEqual({ reason: 'Price', count: 2, value: 500 });
      expect(result.rows).toContainEqual({ reason: 'Not recorded', count: 1, value: 100 });
    });
  });

  describe('Payment outstanding & aging', () => {
    it('buckets each milestone\'s true outstanding (amount minus receipts) by days overdue', async () => {
      const now = Date.now();
      const prisma = mockPrisma({
        paymentMilestone: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'pm-1', amount: 1000, dueDate: new Date(now - 10 * 86_400_000), accountId: 'a1', account: { name: 'Acme' } },
            { id: 'pm-2', amount: 500, dueDate: new Date(now + 5 * 86_400_000), accountId: 'a2', account: { name: 'Beta' } },
          ]),
        },
        receipt: { groupBy: jest.fn().mockResolvedValue([{ paymentMilestoneId: 'pm-1', _sum: { amount: 400 } }]) },
      });
      const result = await REPORT_BUILDERS['Payment outstanding & aging'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ bucket: '1–30d overdue', count: 1, amount: 600 });
      expect(result.rows).toContainEqual({ bucket: 'Not yet due', count: 1, amount: 500 });
    });

    it('excludes a milestone whose receipts already cover its full amount', async () => {
      const prisma = mockPrisma({
        paymentMilestone: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'pm-1', amount: 1000, dueDate: new Date(Date.now() - 86_400_000), accountId: 'a1', account: { name: 'Acme' } },
          ]),
        },
        receipt: { groupBy: jest.fn().mockResolvedValue([{ paymentMilestoneId: 'pm-1', _sum: { amount: 1000 } }]) },
      });
      const result = await REPORT_BUILDERS['Payment outstanding & aging'](prisma, 'org-1');
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('SLA compliance (all policies)', () => {
    it('computes compliance % as (total - breached) / total, defaulting to 100% with no timers', async () => {
      const prisma = mockPrisma({
        slaPolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Lead first response', moduleKey: 'leads' }, { id: 'p2', name: 'No timers yet', moduleKey: 'opps' }]) },
        slaTimer: { findMany: jest.fn().mockResolvedValue([{ slaPolicyId: 'p1', status: 'Breached' }, { slaPolicyId: 'p1', status: 'On track' }]) },
      });
      const result = await REPORT_BUILDERS['SLA compliance (all policies)'](prisma, 'org-1');
      expect(result.rows.find((r) => r.policy === 'Lead first response')).toMatchObject({ total: 2, breached: 1, compliancePct: 50 });
      expect(result.rows.find((r) => r.policy === 'No timers yet')).toMatchObject({ total: 0, breached: 0, compliancePct: 100 });
    });
  });

  describe('Lead response SLA', () => {
    it('computes on-time % per leads-scoped policy', async () => {
      const prisma = mockPrisma({
        slaPolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Lead first response' }]) },
        slaTimer: { findMany: jest.fn().mockResolvedValue([{ slaPolicyId: 'p1', status: 'Met' }, { slaPolicyId: 'p1', status: 'Breached' }]) },
      });
      const result = await REPORT_BUILDERS['Lead response SLA'](prisma, 'org-1');
      expect(result.rows[0]).toMatchObject({ policy: 'Lead first response', total: 2, met: 1, breached: 1, onTimePct: 50 });
    });
  });

  describe('Opportunity aging / stagnation', () => {
    it('buckets open opportunities by days since their latest stage change', async () => {
      const now = Date.now();
      const prisma = mockPrisma({
        opportunity: { findMany: jest.fn().mockResolvedValue([{ id: 'op-1', stage: 'Qualified' }, { id: 'op-2', stage: 'Negotiation' }]) },
        opportunityStageHistory: {
          findMany: jest.fn().mockResolvedValue([
            { opportunityId: 'op-1', changedAt: new Date(now - 5 * 86_400_000) },
            { opportunityId: 'op-2', changedAt: new Date(now - 45 * 86_400_000) },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Opportunity aging / stagnation'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ bucket: '0–15d', count: 1 });
      expect(result.rows).toContainEqual({ bucket: '31–60d', count: 1 });
    });
  });

  describe('Expected PO / order booking', () => {
    it('lists opportunities in PO expected/received stages, sorted by expected close', async () => {
      const prisma = mockPrisma({
        opportunity: {
          findMany: jest.fn().mockResolvedValue([
            { title: 'Later deal', value: 1000, stage: 'PO expected', closeDate: new Date('2026-12-01') },
            { title: 'Sooner deal', value: 2000, stage: 'PO received', closeDate: new Date('2026-11-01') },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Expected PO / order booking'](prisma, 'org-1');
      expect(result.rows[0]).toMatchObject({ title: 'Sooner deal' });
      expect(result.totals).toEqual({ value: 3000 });
    });
  });

  describe('Average sales cycle duration', () => {
    it('averages the days between creation and the Won stage change', async () => {
      const prisma = mockPrisma({
        opportunity: { findMany: jest.fn().mockResolvedValue([{ id: 'op-1', createdAt: new Date('2026-01-01') }]) },
        opportunityStageHistory: { findMany: jest.fn().mockResolvedValue([{ opportunityId: 'op-1', changedAt: new Date('2026-01-11') }]) },
      });
      const result = await REPORT_BUILDERS['Average sales cycle duration'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ metric: 'Average cycle (days)', value: 10 });
    });
  });

  describe('Competitor analysis', () => {
    it('computes win rate per competitor', async () => {
      const prisma = mockPrisma({
        opportunity: {
          findMany: jest.fn().mockResolvedValue([
            { competitor: 'Avery Weigh-Tronix', stage: 'Won', value: 1000 },
            { competitor: 'Avery Weigh-Tronix', stage: 'Lost', value: 500 },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Competitor analysis'](prisma, 'org-1');
      expect(result.rows[0]).toMatchObject({ competitor: 'Avery Weigh-Tronix', won: 1, lost: 1, winRatePct: 50 });
    });
  });

  describe('Order / dispatch status', () => {
    it('groups sales orders by status', async () => {
      const prisma = mockPrisma({
        salesOrder: { findMany: jest.fn().mockResolvedValue([{ status: 'Dispatched', value: 1000 }, { status: 'Dispatched', value: 500 }]) },
      });
      const result = await REPORT_BUILDERS['Order / dispatch status'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ status: 'Dispatched', count: 2, value: 1500 });
    });
  });

  describe('Industry-wise sales', () => {
    it('groups won deals by account industry', async () => {
      const prisma = mockPrisma({
        opportunity: { findMany: jest.fn().mockResolvedValue([{ value: 1000, account: { industry: 'Steel & metals' } }]) },
      });
      const result = await REPORT_BUILDERS['Industry-wise sales'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ industry: 'Steel & metals', count: 1, value: 1000 });
    });
  });

  describe('Customer / account-wise sales', () => {
    it('groups won deals by account name', async () => {
      const prisma = mockPrisma({
        opportunity: { findMany: jest.fn().mockResolvedValue([{ value: 1000, account: { name: 'Kaveri Steel' } }]) },
      });
      const result = await REPORT_BUILDERS['Customer / account-wise sales'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ account: 'Kaveri Steel', count: 1, value: 1000 });
    });
  });

  describe('Territory / region-wise sales', () => {
    it('groups won deals by account territory', async () => {
      const prisma = mockPrisma({
        opportunity: { findMany: jest.fn().mockResolvedValue([{ value: 1000, account: { territory: 'South' } }]) },
      });
      const result = await REPORT_BUILDERS['Territory / region-wise sales'](prisma, 'org-1');
      expect(result.rows).toContainEqual({ territory: 'South', count: 1, value: 1000 });
    });
  });

  describe('Repeat business / cross-sell', () => {
    it('only includes accounts with more than one won deal', async () => {
      const prisma = mockPrisma({
        opportunity: {
          findMany: jest.fn().mockResolvedValue([
            { accountId: 'a1', value: 1000, account: { name: 'Kaveri Steel' } },
            { accountId: 'a1', value: 500, account: { name: 'Kaveri Steel' } },
            { accountId: 'a2', value: 2000, account: { name: 'Beta Mills' } },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Repeat business / cross-sell'](prisma, 'org-1');
      expect(result.rows).toEqual([{ account: 'Kaveri Steel', count: 2, value: 1500 }]);
      expect(result.totals).toEqual({ repeatAccountCount: 1, totalAccountCount: 2 });
    });
  });

  describe('Warranty expiry', () => {
    it('buckets assets by days until (or since) warranty end', async () => {
      const now = Date.now();
      const prisma = mockPrisma({
        installedAsset: {
          findMany: jest.fn().mockResolvedValue([
            { serial: 'SN-1', model: 'WB-500', warrantyEnd: new Date(now + 10 * 86_400_000), account: { name: 'Acme' } },
            { serial: 'SN-2', model: 'WB-500', warrantyEnd: new Date(now - 5 * 86_400_000), account: { name: 'Beta' } },
          ]),
        },
      });
      const result = await REPORT_BUILDERS['Warranty expiry'](prisma, 'org-1');
      expect(result.rows.find((r) => r.serial === 'SN-1')).toMatchObject({ bucket: 'Within 30 days' });
      expect(result.rows.find((r) => r.serial === 'SN-2')).toMatchObject({ bucket: 'Already expired' });
    });
  });

  describe('Service SLA & ticket aging', () => {
    it('buckets open tickets by age and excludes Closed ones via the where clause', async () => {
      const now = Date.now();
      const findMany = jest.fn().mockResolvedValue([{ status: 'Open', priority: 'High', createdAt: new Date(now - 2 * 86_400_000) }]);
      const prisma = mockPrisma({ serviceTicket: { findMany } });
      const result = await REPORT_BUILDERS['Service SLA & ticket aging'](prisma, 'org-1');
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { not: 'Closed' } }) }));
      expect(result.rows).toContainEqual({ bucket: '2–3d', count: 1 });
      expect(result.totals).toEqual({ openCount: 1 });
    });
  });

  describe('Automation execution log', () => {
    it('scopes to the org via the automationRule relation and returns the 100 most recent runs', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { status: 'OK', runAt: new Date('2026-09-01'), automationRule: { trigger: 'Lead created', action: 'Send welcome email' } },
      ]);
      const prisma = mockPrisma({ automationRun: { findMany } });
      const result = await REPORT_BUILDERS['Automation execution log'](prisma, 'org-1');
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { automationRule: { orgId: 'org-1' } }, take: 100 }),
      );
      expect(result.rows[0]).toMatchObject({ trigger: 'Lead created', action: 'Send welcome email', status: 'OK' });
    });
  });
});
