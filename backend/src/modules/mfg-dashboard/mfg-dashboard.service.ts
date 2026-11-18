import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { loadStageProbabilities } from '../manufacturing-defaults/stage-probability';

const MODULE_KEY = 'reports';
const OPEN_STAGES_EXCLUDED = ['Won', 'Lost'];

// The 3-phase / 5-group stage bucketing from Mfg Dashboard.dc.html's `PH`/`AG` constants.
const PIPELINE_PHASES: { phase: string; stages: string[] }[] = [
  { phase: 'Discovery', stages: ['Qualified', 'Requirement collected', 'Technical discussion', 'Site visit', 'Demo / trial'] },
  { phase: 'Proposal', stages: ['Solution proposed', 'Costing', 'Quotation sent'] },
  { phase: 'Closing', stages: ['Negotiation', 'Approval pending', 'PO expected', 'PO received'] },
];
const AGING_GROUPS: { group: string; stages: string[] }[] = [
  { group: 'Discovery', stages: ['Qualified', 'Requirement collected'] },
  { group: 'Technical / visit', stages: ['Technical discussion', 'Site visit', 'Demo / trial'] },
  { group: 'Costing', stages: ['Solution proposed', 'Costing'] },
  { group: 'Quotation sent', stages: ['Quotation sent'] },
  { group: 'Negotiation / approval', stages: ['Negotiation', 'Approval pending', 'PO expected', 'PO received'] },
];
const AGING_BUCKETS = [
  { label: '0–15d', min: 0, max: 15 },
  { label: '16–30d', min: 16, max: 30 },
  { label: '31–60d', min: 31, max: 60 },
  { label: '60d+', min: 61, max: Infinity },
];

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function quarterStart(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function quarterEnd(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 1);
}
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

// Opportunity stages at or after "Quotation sent".
const QUOTED_OR_LATER_STAGES = ['Quotation sent', 'Negotiation', 'Approval pending', 'PO expected', 'PO received', 'Won'];

@Injectable()
export class MfgDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyDay(caller: AuthUser) {
    const orgId = caller.orgId ?? '';
    const ownerId = caller.id;
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = addDays(todayStart, 1);
    const qStart = quarterStart(now);
    const qEnd = quarterEnd(now);

    const [
      overdueCount,
      dueTodayCount,
      openActivities,
      newLeadsToContact,
      leadsPastSla,
      quotesAwaiting,
      posExpectedOpps,
      bookedThisQuarter,
      caller_,
      dealsAtRisk,
      siteVisits,
      evaluations,
      openOppsForPipeline,
    ] = await Promise.all([
      this.prisma.mfgActivity.count({ where: { orgId, ownerId, status: 'Open', dueDate: { lt: todayStart } } }),
      this.prisma.mfgActivity.count({ where: { orgId, ownerId, status: 'Open', dueDate: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.mfgActivity.findMany({
        where: { orgId, ownerId, status: 'Open' },
        orderBy: { dueDate: 'asc' },
        take: 50,
        include: { account: { select: { name: true } }, opportunity: { select: { title: true } } },
      }),
      this.prisma.mfgLead.count({ where: { orgId, ownerId, status: 'New', isDeleted: false } }),
      this.prisma.slaTimer.count({
        where: { orgId, entityType: 'MfgLead', status: 'Breached', stoppedAt: null, slaPolicy: { moduleKey: 'leads' } },
      }),
      this.prisma.quotation.findMany({ where: { orgId, ownerId, status: 'Sent', isDeleted: false }, select: { id: true } }),
      this.prisma.opportunity.findMany({
        where: { orgId, ownerId, stage: 'PO expected', isDeleted: false },
        select: { id: true, value: true, title: true },
      }),
      this.prisma.opportunity.aggregate({
        where: { orgId, ownerId, stage: 'Won', isDeleted: false, closeDate: { gte: qStart, lt: qEnd } },
        _sum: { value: true },
      }),
      this.prisma.user.findUnique({ where: { id: ownerId }, select: { monthlyTarget: true } }),
      this.prisma.opportunity.findMany({
        where: { orgId, ownerId, isDeleted: false, stage: { notIn: OPEN_STAGES_EXCLUDED }, nextActionDate: { lt: now } },
        orderBy: { value: 'desc' },
        take: 10,
        select: { id: true, title: true, value: true, stage: true, nextActionDate: true, account: { select: { name: true } } },
      }),
      this.prisma.siteVisit.findMany({
        where: { orgId, ownerId, visitDate: { gte: todayStart, lt: addDays(todayStart, 7) } },
        select: { id: true, title: true, visitDate: true, account: { select: { name: true } } },
      }),
      this.prisma.evaluation.findMany({
        where: { orgId, ownerId, plannedDate: { gte: todayStart, lt: addDays(todayStart, 7) } },
        select: { id: true, title: true, type: true, plannedDate: true, account: { select: { name: true } } },
      }),
      this.prisma.opportunity.findMany({
        where: { orgId, ownerId, isDeleted: false, stage: { notIn: OPEN_STAGES_EXCLUDED } },
        select: { stage: true, value: true },
      }),
    ]);

    // Real quotation-value lookup for the "awaiting reply" KPI (the aggregate call above only
    // fetches ids; Quotation has no stored total, so value comes from summing its lines).
    const quoteIds = quotesAwaiting.map((q) => q.id);
    const quoteLineTotals = quoteIds.length
      ? await this.prisma.quotationLine.groupBy({ by: ['quotationId'], where: { quotationId: { in: quoteIds } }, _sum: { amount: true } })
      : [];
    const quotesAwaitingValue = quoteLineTotals.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0);

    const quarterTarget = (caller_?.monthlyTarget ?? 0) * 3;
    const booked = bookedThisQuarter._sum.value ?? 0;

    const actionQueue = openActivities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      accountName: a.account?.name ?? null,
      opportunityTitle: a.opportunity?.title ?? null,
      dueDate: a.dueDate,
      priority: a.priority,
      state: !a.dueDate ? 'later' : a.dueDate < todayStart ? 'overdue' : a.dueDate < todayEnd ? 'today' : a.dueDate < addDays(todayEnd, 1) ? 'soon' : 'later',
    }));

    const pipelineByPhase = PIPELINE_PHASES.map(({ phase, stages }) => {
      const rows = stages.map((stage) => ({
        stage,
        value: openOppsForPipeline.filter((o) => o.stage === stage).reduce((sum, o) => sum + o.value, 0),
      }));
      return { phase, stages: rows, total: rows.reduce((sum, r) => sum + r.value, 0) };
    });

    return {
      kpis: {
        dueToday: dueTodayCount + overdueCount,
        overdueCount,
        newLeadsToContact,
        leadsPastSla,
        quotesAwaitingReply: { count: quotesAwaiting.length, value: quotesAwaitingValue },
        posExpectedThisMonth: { count: posExpectedOpps.length, value: posExpectedOpps.reduce((s, o) => s + o.value, 0) },
        quarterTarget: { pct: quarterTarget > 0 ? Math.round((booked / quarterTarget) * 100) : 0, booked, target: quarterTarget },
      },
      actionQueue,
      dealsNeedingAttention: dealsAtRisk.map((o) => ({
        id: o.id,
        title: o.title,
        accountName: o.account.name,
        stage: o.stage,
        value: o.value,
        reason: 'Next action overdue',
      })),
      visitsAndTrials: [
        ...siteVisits.map((v) => ({ id: v.id, kind: 'visit' as const, title: v.title, accountName: v.account.name, date: v.visitDate })),
        ...evaluations.map((e) => ({ id: e.id, kind: 'trial' as const, title: e.title, accountName: e.account.name, date: e.plannedDate })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime()),
      pipelineByPhase,
    };
  }

  private targetProgress(target: number, achieved: number) {
    return { target, achieved, pct: target > 0 ? Math.round((achieved / target) * 100) : 0 };
  }

  async getTeam(caller: AuthUser) {
    const orgId = caller.orgId ?? '';
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);
    const qStart = quarterStart(now);
    const qEnd = quarterEnd(now);
    const ownerScope = await resolveOwnerScope(this.prisma, caller, MODULE_KEY);
    const scoped = { orgId, ...ownerScope };

    const [
      newLeads,
      qualifiedLeads,
      openOpps,
      quotationsIssued,
      quotationsRevised,
      posAccepted,
      wonOpps,
      lostOpps,
      unpaidMilestones,
      pendingApprovals,
      repsWithTarget,
      wonThisMonth,
    ] = await Promise.all([
      this.prisma.mfgLead.count({ where: { ...scoped, createdAt: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.mfgLead.count({ where: { ...scoped, status: 'Qualified', createdAt: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.opportunity.findMany({ where: { ...scoped, isDeleted: false, stage: { notIn: OPEN_STAGES_EXCLUDED } }, select: { id: true, stage: true, value: true, ownerId: true } }),
      this.prisma.quotation.count({ where: { ...scoped, quotationDate: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.quotation.count({ where: { ...scoped, status: 'Revised', quotationDate: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.purchaseOrder.aggregate({ where: { ...scoped, status: 'Accepted', poDate: { gte: monthStart, lt: monthEnd }, isDeleted: false }, _count: true, _sum: { value: true } }),
      this.prisma.opportunity.aggregate({ where: { ...scoped, stage: 'Won', isDeleted: false, closeDate: { gte: qStart, lt: qEnd } }, _count: true, _sum: { value: true } }),
      this.prisma.opportunity.count({ where: { ...scoped, stage: 'Lost', isDeleted: false, closeDate: { gte: qStart, lt: qEnd } } }),
      this.prisma.paymentMilestone.findMany({ where: { ...scoped, isDeleted: false, status: { not: 'Received' } }, select: { id: true, amount: true, dueDate: true, milestone: true, accountId: true, account: { select: { name: true } } } }),
      this.prisma.approval.findMany({ where: { orgId, status: 'Requested', isDeleted: false }, orderBy: { requestedAt: 'asc' }, take: 20, select: { id: true, title: true, type: true, currentApprover: true, requestedAt: true } }),
      this.prisma.user.findMany({ where: { orgId, monthlyTarget: { gt: 0 } }, select: { id: true, name: true, monthlyTarget: true } }),
      this.prisma.opportunity.aggregate({ where: { ...scoped, stage: 'Won', isDeleted: false, closeDate: { gte: monthStart, lt: monthEnd } }, _sum: { value: true } }),
    ]);

    const activePipeline = openOpps.reduce((s, o) => s + o.value, 0);
    const stageProbability = await loadStageProbabilities(this.prisma, orgId);
    const weightedPipeline = openOpps.reduce((s, o) => s + (o.value * (stageProbability.get(o.stage) ?? 0)) / 100, 0);
    const wonCount = wonOpps._count;
    const lostCount = lostOpps;
    const winRatePct = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

    const milestoneIds = unpaidMilestones.map((m) => m.id);
    const receiptTotals = milestoneIds.length
      ? await this.prisma.receipt.groupBy({ by: ['paymentMilestoneId'], where: { paymentMilestoneId: { in: milestoneIds } }, _sum: { amount: true } })
      : [];
    const receivedByMilestone = new Map(receiptTotals.map((r) => [r.paymentMilestoneId, r._sum.amount ?? 0]));
    const overduePayments = unpaidMilestones
      .map((m) => ({ ...m, outstanding: m.amount - (receivedByMilestone.get(m.id) ?? 0) }))
      .filter((m) => m.outstanding > 0);
    const outstandingTotal = overduePayments.reduce((s, m) => s + m.outstanding, 0);
    const overdueOnly = overduePayments.filter((m) => m.dueDate < now);

    // Conversion funnel, matching Mfg Dashboard.dc.html's Leads -> Opportunities -> Quotations ->
    // Negotiation -> PO received chain. Every step after Leads counts this month's opportunities
    // that reached it (a cohort), so the steps only narrow and conversion never exceeds 100%.
    const [funnelLeads, funnelOpps, funnelQuotes, funnelNegotiation, funnelPoReceived] = await Promise.all([
      this.prisma.mfgLead.count({ where: { ...scoped, createdAt: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.opportunity.count({ where: { ...scoped, createdAt: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.opportunity.count({
        where: {
          ...scoped,
          createdAt: { gte: monthStart, lt: monthEnd },
          isDeleted: false,
          // Quoted = has a quotation, or has reached any stage at or past "Quotation sent" (a deal can
          // move on without its quotation being logged), so this step is never smaller than the next.
          OR: [{ quotations: { some: { isDeleted: false } } }, { stage: { in: QUOTED_OR_LATER_STAGES } }],
        },
      }),
      this.prisma.opportunity.count({ where: { ...scoped, stage: { in: ['Negotiation', 'Approval pending', 'PO expected', 'PO received', 'Won'] }, createdAt: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
      this.prisma.opportunity.count({ where: { ...scoped, stage: { in: ['PO received', 'Won'] }, createdAt: { gte: monthStart, lt: monthEnd }, isDeleted: false } }),
    ]);
    const funnelSteps = [
      { label: 'Leads', count: funnelLeads },
      { label: 'Opportunities', count: funnelOpps },
      { label: 'Quotations', count: funnelQuotes },
      { label: 'Negotiation', count: funnelNegotiation },
      { label: 'PO received', count: funnelPoReceived },
    ];
    const funnel = funnelSteps.map((step, i) => ({
      ...step,
      conversionPct: i === 0 ? null : funnelSteps[i - 1].count > 0 ? Math.min(100, Math.round((step.count / funnelSteps[i - 1].count) * 100)) : 0,
    }));

    // Opportunity aging heatmap: bucket every open opportunity (in scope) into its phase group
    // x days-in-current-stage bucket, using the latest stage-history row (same logic as
    // OpportunitiesService.findOne's daysInStage).
    const openOppIds = openOpps.map((o) => o.id);
    const latestStageChanges = openOppIds.length
      ? await this.prisma.opportunityStageHistory.findMany({
          where: { opportunityId: { in: openOppIds } },
          orderBy: { changedAt: 'desc' },
          distinct: ['opportunityId'],
          select: { opportunityId: true, changedAt: true },
        })
      : [];
    const stageChangedAtByOppId = new Map(latestStageChanges.map((h) => [h.opportunityId, h.changedAt]));
    const openOppsWithCreatedAt = openOppIds.length
      ? await this.prisma.opportunity.findMany({ where: { id: { in: openOppIds } }, select: { id: true, stage: true, createdAt: true } })
      : [];
    const aging = AGING_GROUPS.map(({ group, stages }) => {
      const oppsInGroup = openOppsWithCreatedAt.filter((o) => stages.includes(o.stage));
      const counts = AGING_BUCKETS.map((bucket) => {
        const count = oppsInGroup.filter((o) => {
          const since = stageChangedAtByOppId.get(o.id) ?? o.createdAt;
          const days = daysBetween(since, now);
          return days >= bucket.min && days <= bucket.max;
        }).length;
        return { bucket: bucket.label, count };
      });
      return { group, buckets: counts };
    });

    // Team performance table: one row per user with a monthly target set, scoped to the
    // same org/team boundary as everything else on this view.
    const repIds = repsWithTarget.map((r) => r.id);
    const emptyQuoteGroups: { ownerId: string | null; _count: number }[] = [];
    const emptyOppGroups: { ownerId: string | null; _sum: { value: number | null } }[] = [];
    const emptyActivityGroups: { ownerId: string | null; _count: number }[] = [];
    const [repQuoteCounts, repBookedTotals] = await Promise.all([
      repIds.length
        ? this.prisma.quotation.groupBy({ by: ['ownerId'], where: { orgId, ownerId: { in: repIds }, status: { in: ['Sent', 'Approval pending', 'Approved'] }, isDeleted: false }, _count: true })
        : Promise.resolve(emptyQuoteGroups),
      repIds.length
        ? this.prisma.opportunity.groupBy({ by: ['ownerId'], where: { orgId, ownerId: { in: repIds }, stage: 'Won', isDeleted: false, closeDate: { gte: monthStart, lt: monthEnd } }, _sum: { value: true } })
        : Promise.resolve(emptyOppGroups),
    ]);
    const repOverdueCounts = repIds.length
      ? await this.prisma.mfgActivity.groupBy({ by: ['ownerId'], where: { orgId, ownerId: { in: repIds }, status: 'Open', dueDate: { lt: now } }, _count: true })
      : emptyActivityGroups;
    const quoteCountByRep = new Map(repQuoteCounts.map((r) => [r.ownerId, r._count] as const));
    const bookedByRep = new Map(repBookedTotals.map((r) => [r.ownerId, r._sum.value ?? 0] as const));
    const overdueByRep = new Map(repOverdueCounts.map((r) => [r.ownerId, r._count] as const));
    const pipelineByRep = new Map<string, number>();
    for (const o of openOpps) {
      if (!o.ownerId) continue;
      pipelineByRep.set(o.ownerId, (pipelineByRep.get(o.ownerId) ?? 0) + o.value);
    }

    const teamPerformance = repsWithTarget.map((rep) => {
      const booked = bookedByRep.get(rep.id) ?? 0;
      const target = rep.monthlyTarget ?? 0;
      const pct = target > 0 ? Math.round((booked / target) * 100) : 0;
      return {
        userId: rep.id,
        name: rep.name,
        pipeline: pipelineByRep.get(rep.id) ?? 0,
        quotesOut: quoteCountByRep.get(rep.id) ?? 0,
        booked,
        target,
        pct,
        overdueCount: overdueByRep.get(rep.id) ?? 0,
      };
    });

    return {
      kpis: {
        newLeads,
        qualifiedLeads,
        qualificationRatePct: newLeads > 0 ? Math.round((qualifiedLeads / newLeads) * 100) : 0,
        activePipeline,
        weightedPipeline,
        quotationsIssued: { count: quotationsIssued, revised: quotationsRevised },
        poBooked: { count: posAccepted._count, value: posAccepted._sum.value ?? 0 },
        wonLost: { won: wonCount, lost: lostCount, winRatePct, wonValue: wonOpps._sum.value ?? 0 },
        outstanding: { amount: outstandingTotal, overdueAmount: overdueOnly.reduce((s, m) => s + m.outstanding, 0), overdueCount: overdueOnly.length },
        // Targets are each rep's monthlyTarget; achievement is the value of deals Won in the period.
        targetVsAchievement: {
          month: this.targetProgress(repsWithTarget.reduce((sum, rep) => sum + rep.monthlyTarget, 0), wonThisMonth._sum.value ?? 0),
          quarter: this.targetProgress(repsWithTarget.reduce((sum, rep) => sum + rep.monthlyTarget, 0) * 3, wonOpps._sum.value ?? 0),
        },
      },
      funnel,
      aging,
      teamPerformance,
      pendingApprovals,
      overduePayments: overdueOnly.map((m) => ({
        id: m.id,
        milestone: m.milestone,
        accountName: m.account.name,
        amount: m.outstanding,
        dueDate: m.dueDate,
      })),
    };
  }
}
