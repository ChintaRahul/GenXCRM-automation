import type { PrismaService } from '../../prisma/prisma.service';
import type { ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { STAGES } from '../manufacturing-defaults/manufacturing-defaults.data';
import { loadStageProbabilities } from '../manufacturing-defaults/stage-probability';

const OPEN_STAGES_EXCLUDED = ['Won', 'Lost'];

type ReportBuilder = (prisma: PrismaService, orgId: string) => Promise<ModuleTableResult>;

// One builder per standard report `name` seeded by manufacturing-defaults.data.ts's
// REPORT_DEFAULTS. Every report not listed here falls back to a "not yet implemented"
// placeholder table (see MfgReportsService.getDataTable) rather than throwing, so browsing
// the Reports list never crashes on an unbuilt category.
export const REPORT_BUILDERS: Record<string, ReportBuilder> = {
  'Lead source & campaign performance': async (prisma, orgId) => {
    const leads = await prisma.mfgLead.findMany({ where: { orgId, isDeleted: false }, select: { source: true, status: true } });
    const bySource = new Map<string, { total: number; qualified: number; converted: number }>();
    for (const lead of leads) {
      const key = lead.source ?? 'Unknown';
      const entry = bySource.get(key) ?? { total: 0, qualified: 0, converted: 0 };
      entry.total += 1;
      if (lead.status === 'Qualified' || lead.status === 'Converted') entry.qualified += 1;
      if (lead.status === 'Converted') entry.converted += 1;
      bySource.set(key, entry);
    }
    return {
      columns: [
        { key: 'source', label: 'Source', type: 'text' },
        { key: 'total', label: 'Leads', type: 'num' },
        { key: 'qualified', label: 'Qualified', type: 'num' },
        { key: 'converted', label: 'Converted', type: 'num' },
        { key: 'conversionPct', label: 'Conversion %', type: 'num' },
      ],
      rows: Array.from(bySource.entries()).map(([source, e]) => ({
        source, total: e.total, qualified: e.qualified, converted: e.converted,
        conversionPct: e.total > 0 ? Math.round((e.converted / e.total) * 100) : 0,
      })),
    };
  },

  'Lead-to-opportunity conversion': async (prisma, orgId) => {
    const [totalLeads, convertedLeads] = await Promise.all([
      prisma.mfgLead.count({ where: { orgId, isDeleted: false } }),
      prisma.mfgLead.count({ where: { orgId, isDeleted: false, status: 'Converted' } }),
    ]);
    return {
      columns: [
        { key: 'metric', label: 'Metric', type: 'text' },
        { key: 'value', label: 'Value', type: 'num' },
      ],
      rows: [
        { metric: 'Total leads', value: totalLeads },
        { metric: 'Converted to opportunity', value: convertedLeads },
        { metric: 'Conversion rate %', value: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0 },
      ],
    };
  },

  'Opportunity stage conversion': async (prisma, orgId) => {
    const opps = await prisma.opportunity.findMany({ where: { orgId, isDeleted: false }, select: { stage: true, value: true } });
    const byStage = new Map<string, { count: number; value: number }>();
    for (const [stage] of STAGES) byStage.set(stage, { count: 0, value: 0 });
    byStage.set('Won', { count: 0, value: 0 });
    byStage.set('Lost', { count: 0, value: 0 });
    for (const o of opps) {
      const entry = byStage.get(o.stage) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byStage.set(o.stage, entry);
    }
    return {
      columns: [
        { key: 'stage', label: 'Stage', type: 'text' },
        { key: 'count', label: 'Deals', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byStage.entries()).map(([stage, e]) => ({ stage, count: e.count, value: e.value })),
    };
  },

  'Pipeline & weighted pipeline': async (prisma, orgId) => {
    const opps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: { notIn: OPEN_STAGES_EXCLUDED } },
      select: { stage: true, value: true },
    });
    const stageProbability = await loadStageProbabilities(prisma, orgId);
    const byStage = new Map<string, { count: number; value: number; weighted: number }>();
    for (const o of opps) {
      const entry = byStage.get(o.stage) ?? { count: 0, value: 0, weighted: 0 };
      const probability = stageProbability.get(o.stage) ?? 0;
      entry.count += 1;
      entry.value += o.value;
      entry.weighted += (o.value * probability) / 100;
      byStage.set(o.stage, entry);
    }
    const rows = Array.from(byStage.entries()).map(([stage, e]) => ({ stage, count: e.count, value: e.value, weighted: Math.round(e.weighted) }));
    return {
      columns: [
        { key: 'stage', label: 'Stage', type: 'text' },
        { key: 'count', label: 'Deals', type: 'num' },
        { key: 'value', label: 'Pipeline value', type: 'money' },
        { key: 'weighted', label: 'Weighted value', type: 'money' },
      ],
      rows,
      totals: {
        value: rows.reduce((s, r) => s + r.value, 0),
        weighted: rows.reduce((s, r) => s + r.weighted, 0),
      },
    };
  },

  'Salesperson / team performance': async (prisma, orgId) => {
    const opps = await prisma.opportunity.findMany({ where: { orgId, isDeleted: false }, select: { ownerId: true, stage: true, value: true } });
    // Everyone with a target, plus everyone who owns a deal — so the report is useful before targets are set.
    const ownerIds = [...new Set(opps.map((o) => o.ownerId).filter((id): id is string => Boolean(id)))];
    const reps = await prisma.user.findMany({
      where: { orgId, OR: [{ monthlyTarget: { gt: 0 } }, { id: { in: ownerIds } }] },
      select: { id: true, name: true, monthlyTarget: true },
    });
    return {
      columns: [
        { key: 'name', label: 'Salesperson', type: 'text' },
        { key: 'pipeline', label: 'Open pipeline', type: 'money' },
        { key: 'won', label: 'Won value', type: 'money' },
        { key: 'target', label: 'Target', type: 'money' },
        { key: 'attainmentPct', label: 'Attainment %', type: 'num' },
      ],
      rows: reps.map((rep) => {
        const mine = opps.filter((o) => o.ownerId === rep.id);
        const pipeline = mine.filter((o) => !OPEN_STAGES_EXCLUDED.includes(o.stage)).reduce((s, o) => s + o.value, 0);
        const won = mine.filter((o) => o.stage === 'Won').reduce((s, o) => s + o.value, 0);
        const target = rep.monthlyTarget ?? 0;
        return { name: rep.name, pipeline, won, target, attainmentPct: target > 0 ? Math.round((won / target) * 100) : 0 };
      }),
    };
  },

  'Win/loss & lost reason': async (prisma, orgId) => {
    const [won, lostOpps] = await Promise.all([
      prisma.opportunity.aggregate({ where: { orgId, isDeleted: false, stage: 'Won' }, _count: true, _sum: { value: true } }),
      prisma.opportunity.findMany({ where: { orgId, isDeleted: false, stage: 'Lost' }, select: { lostReason: true, value: true } }),
    ]);
    const byReason = new Map<string, { count: number; value: number }>();
    for (const o of lostOpps) {
      const key = o.lostReason ?? 'Not recorded';
      const entry = byReason.get(key) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byReason.set(key, entry);
    }
    const rows: Record<string, unknown>[] = [{ reason: 'Won', count: won._count, value: won._sum.value ?? 0 }];
    for (const [reason, e] of byReason.entries()) rows.push({ reason, count: e.count, value: e.value });
    return {
      columns: [
        { key: 'reason', label: 'Outcome / lost reason', type: 'text' },
        { key: 'count', label: 'Deals', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows,
    };
  },

  'Quotation conversion & revision analysis': async (prisma, orgId) => {
    const quotations = await prisma.quotation.findMany({ where: { orgId, isDeleted: false }, select: { status: true } });
    const byStatus = new Map<string, number>();
    for (const q of quotations) byStatus.set(q.status, (byStatus.get(q.status) ?? 0) + 1);
    const total = quotations.length;
    const accepted = byStatus.get('Accepted') ?? 0;
    return {
      columns: [
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'count', label: 'Count', type: 'num' },
      ],
      rows: Array.from(byStatus.entries()).map(([status, count]) => ({ status, count })),
      totals: { count: total, conversionPct: total > 0 ? Math.round((accepted / total) * 100) : 0 },
    };
  },

  'Product / SKU-wise sales': async (prisma, orgId) => {
    const wonOpps = await prisma.opportunity.findMany({ where: { orgId, isDeleted: false, stage: 'Won' }, select: { product: true, value: true } });
    const byProduct = new Map<string, { count: number; value: number }>();
    for (const o of wonOpps) {
      const entry = byProduct.get(o.product) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byProduct.set(o.product, entry);
    }
    return {
      columns: [
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'count', label: 'Deals won', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byProduct.entries())
        .map(([product, e]) => ({ product, count: e.count, value: e.value }))
        .sort((a, b) => b.value - a.value),
    };
  },

  'Payment outstanding & aging': async (prisma, orgId) => {
    const now = new Date();
    const milestones = await prisma.paymentMilestone.findMany({
      where: { orgId, isDeleted: false, status: { not: 'Received' } },
      select: { id: true, amount: true, dueDate: true, accountId: true, account: { select: { name: true } } },
    });
    const ids = milestones.map((m) => m.id);
    const receipts = ids.length
      ? await prisma.receipt.groupBy({ by: ['paymentMilestoneId'], where: { paymentMilestoneId: { in: ids } }, _sum: { amount: true } })
      : [];
    const receivedById = new Map(receipts.map((r) => [r.paymentMilestoneId, r._sum.amount ?? 0]));
    const bucket = (days: number) => (days <= 0 ? 'Not yet due' : days <= 30 ? '1–30d overdue' : days <= 60 ? '31–60d overdue' : '60d+ overdue');
    const byBucket = new Map<string, { count: number; amount: number }>();
    for (const m of milestones) {
      const outstanding = m.amount - (receivedById.get(m.id) ?? 0);
      if (outstanding <= 0) continue;
      const days = Math.floor((now.getTime() - m.dueDate.getTime()) / 86_400_000);
      const key = bucket(days);
      const entry = byBucket.get(key) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += outstanding;
      byBucket.set(key, entry);
    }
    return {
      columns: [
        { key: 'bucket', label: 'Ageing bucket', type: 'text' },
        { key: 'count', label: 'Milestones', type: 'num' },
        { key: 'amount', label: 'Outstanding', type: 'money' },
      ],
      rows: Array.from(byBucket.entries()).map(([bucketLabel, e]) => ({ bucket: bucketLabel, count: e.count, amount: e.amount })),
    };
  },

  'Installed base': async (prisma, orgId) => {
    const assets = await prisma.installedAsset.findMany({ where: { orgId, isDeleted: false }, select: { model: true, status: true } });
    const byModel = new Map<string, Map<string, number>>();
    for (const a of assets) {
      const statuses = byModel.get(a.model) ?? new Map<string, number>();
      statuses.set(a.status, (statuses.get(a.status) ?? 0) + 1);
      byModel.set(a.model, statuses);
    }
    return {
      columns: [
        { key: 'model', label: 'Model', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'count', label: 'Count', type: 'num' },
      ],
      rows: Array.from(byModel.entries()).flatMap(([model, statuses]) =>
        Array.from(statuses.entries()).map(([status, count]) => ({ model, status, count })),
      ),
    };
  },

  'AMC renewal': async (prisma, orgId) => {
    const coverages = await prisma.coverage.findMany({ where: { orgId, isDeleted: false }, select: { status: true, value: true } });
    const byStatus = new Map<string, { count: number; value: number }>();
    for (const c of coverages) {
      const entry = byStatus.get(c.status) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += c.value ?? 0;
      byStatus.set(c.status, entry);
    }
    return {
      columns: [
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'count', label: 'Coverages', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byStatus.entries()).map(([status, e]) => ({ status, count: e.count, value: e.value })),
    };
  },

  'SLA compliance (all policies)': async (prisma, orgId) => {
    const policies = await prisma.slaPolicy.findMany({ where: { orgId, isDeleted: false }, select: { id: true, name: true, moduleKey: true } });
    const timers = await prisma.slaTimer.findMany({ where: { orgId, isDeleted: false }, select: { slaPolicyId: true, status: true } });
    const byPolicy = new Map<string, { total: number; breached: number }>();
    for (const t of timers) {
      const entry = byPolicy.get(t.slaPolicyId) ?? { total: 0, breached: 0 };
      entry.total += 1;
      if (t.status === 'Breached') entry.breached += 1;
      byPolicy.set(t.slaPolicyId, entry);
    }
    return {
      columns: [
        { key: 'policy', label: 'Policy', type: 'text' },
        { key: 'module', label: 'Module', type: 'text' },
        { key: 'total', label: 'Timers', type: 'num' },
        { key: 'breached', label: 'Breached', type: 'num' },
        { key: 'compliancePct', label: 'Compliance %', type: 'num' },
      ],
      rows: policies.map((p) => {
        const e = byPolicy.get(p.id) ?? { total: 0, breached: 0 };
        return {
          policy: p.name, module: p.moduleKey, total: e.total, breached: e.breached,
          compliancePct: e.total > 0 ? Math.round(((e.total - e.breached) / e.total) * 100) : 100,
        };
      }),
    };
  },

  'Lead response SLA': async (prisma, orgId) => {
    const policies = await prisma.slaPolicy.findMany({ where: { orgId, isDeleted: false, moduleKey: 'leads' }, select: { id: true, name: true } });
    const policyIds = policies.map((p) => p.id);
    const timers = policyIds.length
      ? await prisma.slaTimer.findMany({ where: { orgId, isDeleted: false, slaPolicyId: { in: policyIds } }, select: { slaPolicyId: true, status: true } })
      : [];
    const byPolicy = new Map<string, { total: number; breached: number; met: number }>();
    for (const t of timers) {
      const entry = byPolicy.get(t.slaPolicyId) ?? { total: 0, breached: 0, met: 0 };
      entry.total += 1;
      if (t.status === 'Breached') entry.breached += 1;
      if (t.status === 'Met') entry.met += 1;
      byPolicy.set(t.slaPolicyId, entry);
    }
    return {
      columns: [
        { key: 'policy', label: 'Policy', type: 'text' },
        { key: 'total', label: 'Leads tracked', type: 'num' },
        { key: 'met', label: 'Met on time', type: 'num' },
        { key: 'breached', label: 'Breached', type: 'num' },
        { key: 'onTimePct', label: 'On-time %', type: 'num' },
      ],
      rows: policies.map((p) => {
        const e = byPolicy.get(p.id) ?? { total: 0, breached: 0, met: 0 };
        return { policy: p.name, total: e.total, met: e.met, breached: e.breached, onTimePct: e.total > 0 ? Math.round((e.met / e.total) * 100) : 100 };
      }),
    };
  },

  'Opportunity aging / stagnation': async (prisma, orgId) => {
    const opps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: { notIn: OPEN_STAGES_EXCLUDED } },
      select: { id: true, stage: true },
    });
    const latestChanges = await prisma.opportunityStageHistory.findMany({
      where: { opportunityId: { in: opps.map((o) => o.id) } },
      orderBy: { changedAt: 'desc' },
      select: { opportunityId: true, changedAt: true },
    });
    const latestByOpp = new Map<string, Date>();
    for (const c of latestChanges) if (!latestByOpp.has(c.opportunityId)) latestByOpp.set(c.opportunityId, c.changedAt);
    const now = Date.now();
    const bucket = (days: number) => (days <= 15 ? '0–15d' : days <= 30 ? '16–30d' : days <= 60 ? '31–60d' : '60d+');
    const byBucket = new Map<string, number>();
    for (const o of opps) {
      const since = latestByOpp.get(o.id);
      const days = since ? Math.floor((now - since.getTime()) / 86_400_000) : 0;
      const key = bucket(days);
      byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
    }
    return {
      columns: [
        { key: 'bucket', label: 'Days in current stage', type: 'text' },
        { key: 'count', label: 'Opportunities', type: 'num' },
      ],
      rows: ['0–15d', '16–30d', '31–60d', '60d+'].map((bucketLabel) => ({ bucket: bucketLabel, count: byBucket.get(bucketLabel) ?? 0 })),
    };
  },

  'Expected PO / order booking': async (prisma, orgId) => {
    const opps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: { in: ['PO expected', 'PO received'] } },
      select: { title: true, value: true, stage: true, closeDate: true },
    });
    return {
      columns: [
        { key: 'title', label: 'Opportunity', type: 'text' },
        { key: 'stage', label: 'Stage', type: 'text' },
        { key: 'value', label: 'Value', type: 'money' },
        { key: 'closeDate', label: 'Expected close', type: 'date' },
      ],
      rows: opps
        .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime())
        .map((o) => ({ title: o.title, stage: o.stage, value: o.value, closeDate: o.closeDate.toISOString() })),
      totals: { value: opps.reduce((s, o) => s + o.value, 0) },
    };
  },

  'Average sales cycle duration': async (prisma, orgId) => {
    const wonOpps = await prisma.opportunity.findMany({ where: { orgId, isDeleted: false, stage: 'Won' }, select: { id: true, createdAt: true } });
    const wonChanges = await prisma.opportunityStageHistory.findMany({
      where: { opportunityId: { in: wonOpps.map((o) => o.id) }, toStage: 'Won' },
      select: { opportunityId: true, changedAt: true },
    });
    const wonAtByOpp = new Map(wonChanges.map((c) => [c.opportunityId, c.changedAt]));
    const cycleDays = wonOpps
      .map((o) => {
        const wonAt = wonAtByOpp.get(o.id);
        return wonAt ? Math.floor((wonAt.getTime() - o.createdAt.getTime()) / 86_400_000) : null;
      })
      .filter((d): d is number => d !== null);
    const avg = cycleDays.length ? Math.round(cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length) : 0;
    return {
      columns: [
        { key: 'metric', label: 'Metric', type: 'text' },
        { key: 'value', label: 'Value', type: 'num' },
      ],
      rows: [
        { metric: 'Deals won', value: wonOpps.length },
        { metric: 'Average cycle (days)', value: avg },
        { metric: 'Shortest cycle (days)', value: cycleDays.length ? Math.min(...cycleDays) : 0 },
        { metric: 'Longest cycle (days)', value: cycleDays.length ? Math.max(...cycleDays) : 0 },
      ],
    };
  },

  'Competitor analysis': async (prisma, orgId) => {
    const opps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, competitor: { not: null } },
      select: { competitor: true, stage: true, value: true },
    });
    const byCompetitor = new Map<string, { total: number; won: number; lost: number; value: number }>();
    for (const o of opps) {
      const key = o.competitor as string;
      const entry = byCompetitor.get(key) ?? { total: 0, won: 0, lost: 0, value: 0 };
      entry.total += 1;
      entry.value += o.value;
      if (o.stage === 'Won') entry.won += 1;
      if (o.stage === 'Lost') entry.lost += 1;
      byCompetitor.set(key, entry);
    }
    return {
      columns: [
        { key: 'competitor', label: 'Competitor', type: 'text' },
        { key: 'total', label: 'Deals faced', type: 'num' },
        { key: 'won', label: 'Won', type: 'num' },
        { key: 'lost', label: 'Lost', type: 'num' },
        { key: 'value', label: 'Value at stake', type: 'money' },
        { key: 'winRatePct', label: 'Win rate %', type: 'num' },
      ],
      rows: Array.from(byCompetitor.entries()).map(([competitor, e]) => ({
        competitor, total: e.total, won: e.won, lost: e.lost, value: e.value,
        winRatePct: e.won + e.lost > 0 ? Math.round((e.won / (e.won + e.lost)) * 100) : 0,
      })),
    };
  },

  'Order / dispatch status': async (prisma, orgId) => {
    const orders = await prisma.salesOrder.findMany({ where: { orgId, isDeleted: false }, select: { status: true, value: true } });
    const byStatus = new Map<string, { count: number; value: number }>();
    for (const o of orders) {
      const entry = byStatus.get(o.status) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byStatus.set(o.status, entry);
    }
    return {
      columns: [
        { key: 'status', label: 'Order status', type: 'text' },
        { key: 'count', label: 'Orders', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byStatus.entries()).map(([status, e]) => ({ status, count: e.count, value: e.value })),
    };
  },

  'Industry-wise sales': async (prisma, orgId) => {
    const wonOpps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: 'Won' },
      select: { value: true, account: { select: { industry: true } } },
    });
    const byIndustry = new Map<string, { count: number; value: number }>();
    for (const o of wonOpps) {
      const key = o.account?.industry ?? 'Unknown';
      const entry = byIndustry.get(key) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byIndustry.set(key, entry);
    }
    return {
      columns: [
        { key: 'industry', label: 'Industry', type: 'text' },
        { key: 'count', label: 'Deals won', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byIndustry.entries())
        .map(([industry, e]) => ({ industry, count: e.count, value: e.value }))
        .sort((a, b) => b.value - a.value),
    };
  },

  'Customer / account-wise sales': async (prisma, orgId) => {
    const wonOpps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: 'Won' },
      select: { value: true, account: { select: { name: true } } },
    });
    const byAccount = new Map<string, { count: number; value: number }>();
    for (const o of wonOpps) {
      const key = o.account?.name ?? 'Unknown';
      const entry = byAccount.get(key) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byAccount.set(key, entry);
    }
    return {
      columns: [
        { key: 'account', label: 'Account', type: 'text' },
        { key: 'count', label: 'Deals won', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byAccount.entries())
        .map(([account, e]) => ({ account, count: e.count, value: e.value }))
        .sort((a, b) => b.value - a.value),
    };
  },

  'Territory / region-wise sales': async (prisma, orgId) => {
    const wonOpps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: 'Won' },
      select: { value: true, account: { select: { territory: true } } },
    });
    const byTerritory = new Map<string, { count: number; value: number }>();
    for (const o of wonOpps) {
      const key = o.account?.territory ?? 'Unknown';
      const entry = byTerritory.get(key) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byTerritory.set(key, entry);
    }
    return {
      columns: [
        { key: 'territory', label: 'Territory', type: 'text' },
        { key: 'count', label: 'Deals won', type: 'num' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: Array.from(byTerritory.entries())
        .map(([territory, e]) => ({ territory, count: e.count, value: e.value }))
        .sort((a, b) => b.value - a.value),
    };
  },

  'Repeat business / cross-sell': async (prisma, orgId) => {
    const wonOpps = await prisma.opportunity.findMany({
      where: { orgId, isDeleted: false, stage: 'Won' },
      select: { value: true, accountId: true, account: { select: { name: true } } },
    });
    const byAccount = new Map<string, { name: string; count: number; value: number }>();
    for (const o of wonOpps) {
      const entry = byAccount.get(o.accountId) ?? { name: o.account?.name ?? 'Unknown', count: 0, value: 0 };
      entry.count += 1;
      entry.value += o.value;
      byAccount.set(o.accountId, entry);
    }
    const repeatAccounts = Array.from(byAccount.values()).filter((e) => e.count > 1);
    return {
      columns: [
        { key: 'account', label: 'Account', type: 'text' },
        { key: 'count', label: 'Deals won', type: 'num' },
        { key: 'value', label: 'Total value', type: 'money' },
      ],
      rows: repeatAccounts.map((e) => ({ account: e.name, count: e.count, value: e.value })).sort((a, b) => b.count - a.count),
      totals: { repeatAccountCount: repeatAccounts.length, totalAccountCount: byAccount.size },
    };
  },

  'Warranty expiry': async (prisma, orgId) => {
    const now = Date.now();
    const assets = await prisma.installedAsset.findMany({
      where: { orgId, isDeleted: false, warrantyEnd: { not: null } },
      select: { serial: true, model: true, warrantyEnd: true, account: { select: { name: true } } },
    });
    const bucket = (days: number) => (days < 0 ? 'Already expired' : days <= 30 ? 'Within 30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : 'Beyond 90 days');
    return {
      columns: [
        { key: 'serial', label: 'Serial', type: 'text' },
        { key: 'model', label: 'Model', type: 'text' },
        { key: 'account', label: 'Account', type: 'text' },
        { key: 'warrantyEnd', label: 'Warranty end', type: 'date' },
        { key: 'bucket', label: 'Status', type: 'text' },
      ],
      rows: assets
        .map((a) => {
          const days = Math.floor((a.warrantyEnd!.getTime() - now) / 86_400_000);
          return { serial: a.serial, model: a.model, account: a.account?.name ?? 'Unknown', warrantyEnd: a.warrantyEnd!.toISOString(), bucket: bucket(days) };
        })
        .sort((a, b) => Date.parse(a.warrantyEnd) - Date.parse(b.warrantyEnd)),
    };
  },

  'Service SLA & ticket aging': async (prisma, orgId) => {
    const now = Date.now();
    const tickets = await prisma.serviceTicket.findMany({
      where: { orgId, isDeleted: false, status: { not: 'Closed' } },
      select: { status: true, priority: true, createdAt: true },
    });
    const bucket = (days: number) => (days <= 1 ? '0–1d' : days <= 3 ? '2–3d' : days <= 7 ? '4–7d' : '7d+');
    const byBucket = new Map<string, number>();
    for (const t of tickets) {
      const days = Math.floor((now - t.createdAt.getTime()) / 86_400_000);
      const key = bucket(days);
      byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
    }
    return {
      columns: [
        { key: 'bucket', label: 'Ticket age', type: 'text' },
        { key: 'count', label: 'Open tickets', type: 'num' },
      ],
      rows: ['0–1d', '2–3d', '4–7d', '7d+'].map((bucketLabel) => ({ bucket: bucketLabel, count: byBucket.get(bucketLabel) ?? 0 })),
      totals: { openCount: tickets.length },
    };
  },

  'Automation execution log': async (prisma, orgId) => {
    const runs = await prisma.automationRun.findMany({
      where: { automationRule: { orgId } },
      orderBy: { runAt: 'desc' },
      take: 100,
      select: { id: true, status: true, runAt: true, details: true, automationRule: { select: { trigger: true, action: true } } },
    });
    return {
      columns: [
        { key: 'trigger', label: 'Trigger', type: 'text' },
        { key: 'action', label: 'Action', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'runAt', label: 'Ran at', type: 'date' },
      ],
      rows: runs.map((r) => ({ trigger: r.automationRule.trigger, action: r.automationRule.action, status: r.status, runAt: r.runAt.toISOString() })),
    };
  },
};
