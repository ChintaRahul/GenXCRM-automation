import { Injectable, Logger } from '@nestjs/common';
import { MfgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { ROLE_LABEL_TO_ENUM } from '../manufacturing-defaults/manufacturing-defaults.data';
import {
  computeSlaState,
  targetMinutes,
  type BusinessCalendarShape,
  type SlaCalendarType,
  type SlaDurationUnit,
} from '../../modules-framework/utils/sla-duration.util';

interface SlaTarget { cond: string; val: number; unit: SlaDurationUnit; }
interface SlaEscalationLevel { at: number; who: string; channels: string[]; }

const DEFAULT_CALENDAR: BusinessCalendarShape = {
  timezone: 'Asia/Kolkata',
  days: [
    { day: 'Mon', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Tue', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Wed', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Thu', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Fri', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Sat', isOpen: true, from: '09:00', to: '13:00' },
    { day: 'Sun', isOpen: false, from: '09:00', to: '18:00' },
  ],
};

// Module key -> the Prisma delegate holding that module's records, for the "Owner"/"Sales
// owner"/"Renewal owner" escalation-recipient lookups (every one of these models uses the
// column name `ownerId`, confirmed against schema.prisma). Extend this map when a new module
// gets timer support.
const OWNER_LOOKUP_DELEGATE: Record<string, keyof PrismaService> = {
  leads: 'mfgLead',
  opps: 'opportunity',
  quotes: 'quotation',
  pos: 'purchaseOrder',
  sorders: 'salesOrder',
  amc: 'coverage',
  costing: 'costingSheet',
};

// The tone/label the frontend's `sla`-type list columns expect (see
// frontend/src/modules/registry.ts and mfg-schema.js's `sla(label, tone)` row helper).
export interface SlaStateView { l: string; t: 'green' | 'amber' | 'red' | 'gray'; }

// SLA-05, SLA-06, SLA-13, SLA-17, SLA-21, and SLA-22 all have a `startEvent` tied to a date
// field reaching some offset before/at another date, not a status transition — e.g. "Committed
// delivery − 7 days". There is no application code path to hook these into, so a periodic sweep
// (see SlaProcessor's 'date-sweep' job) finds every not-yet-excluded record whose `dateField`
// has crossed `offsetDays` before now, and starts the timer for it. `startTimer` is itself
// idempotent (skips if an open timer already exists for that policy+entity), so re-running the
// sweep on the same record every tick is safe.
interface DateSweepRule {
  readonly startEvent: string;
  readonly moduleKey: string;
  readonly entityType: string;
  readonly delegate: keyof PrismaService;
  readonly dateField: string;
  readonly statusField: string;
  readonly offsetDays: number;
  readonly excludeStatuses: readonly string[];
  // Record field whose value picks the SLA target (e.g. an activity's priority); without it the first target wins.
  readonly contextField?: string;
}

// SLA-03, SLA-07, SLA-19, and SLA-20 are the only seeded policies with a non-empty
// `pauseStatuses` (e.g. rfqs' 'Clarification required') — this maps the moduleKeys that
// actually need auto-pause to the Prisma delegate and status field to read live, so tick() can
// pause/resume without each domain service having to know about SLA internals.
const STATUS_LOOKUP: Record<string, { delegate: keyof PrismaService; statusField: string }> = {
  opps: { delegate: 'opportunity', statusField: 'stage' },
  rfqs: { delegate: 'rfq', statusField: 'status' },
  service: { delegate: 'serviceTicket', statusField: 'status' },
};

// moduleKey -> frontend URL path segment, mirroring frontend/src/modules/modulePaths.ts, so an
// 'In-app' notification's `link` actually opens the entity it's about. Kept in sync manually
// (same pattern as OWNER_LOOKUP_DELEGATE/STATUS_LOOKUP above) since this is a backend-only
// concern with no shared package to import it from.
const ROUTE_SEGMENT_FOR_MODULE: Record<string, string> = {
  leads: 'leads',
  opps: 'opportunities',
  quotes: 'quotations',
  pos: 'purchase-orders',
  sorders: 'sales-orders',
  amc: 'amc',
  costing: 'costing',
  rfqs: 'rfqs',
  activities: 'activities',
  visits: 'site-visits',
  service: 'service-tickets',
  payments: 'payments',
  approvals: 'approvals',
  dispatch: 'dispatch',
};

const DATE_SWEEP_RULES: readonly DateSweepRule[] = [
  // SLA-05 'Next action overdue'
  { startEvent: 'Next action date reached', moduleKey: 'opps', entityType: 'Opportunity', delegate: 'opportunity', dateField: 'nextActionDate', statusField: 'stage', offsetDays: 0, excludeStatuses: ['Won', 'Lost'] },
  // SLA-06 'Follow-up completion'
  { startEvent: 'Scheduled time', moduleKey: 'activities', entityType: 'MfgActivity', delegate: 'mfgActivity', dateField: 'dueDate', statusField: 'status', offsetDays: 0, excludeStatuses: ['Completed', 'Cancelled'], contextField: 'priority' },
  // SLA-13 'Quotation expiry reminder'
  { startEvent: 'Validity date − 7 days', moduleKey: 'quotes', entityType: 'Quotation', delegate: 'quotation', dateField: 'validUntil', statusField: 'status', offsetDays: 7, excludeStatuses: ['Accepted', 'Rejected', 'Revised', 'Expired'] },
  // SLA-17 'Delivery commitment risk'
  { startEvent: 'Committed delivery − 7 days', moduleKey: 'sorders', entityType: 'SalesOrder', delegate: 'salesOrder', dateField: 'committedDelivery', statusField: 'status', offsetDays: 7, excludeStatuses: ['Dispatched', 'Delivered', 'Installation', 'Commissioned', 'Closed'] },
  // SLA-21 'Renewal reminders'
  { startEvent: 'End date − 90 days', moduleKey: 'amc', entityType: 'Coverage', delegate: 'coverage', dateField: 'end', statusField: 'status', offsetDays: 90, excludeStatuses: ['Renewed', 'Lost'] },
  // SLA-22 'Payment collection'
  { startEvent: 'Due date', moduleKey: 'payments', entityType: 'PaymentMilestone', delegate: 'paymentMilestone', dateField: 'dueDate', statusField: 'status', offsetDays: 0, excludeStatuses: ['Received'] },
];

@Injectable()
export class SlaEngineService {
  private readonly logger = new Logger(SlaEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly nurturing: MfgNurturingService,
    private readonly automation: AutomationEngineService,
  ) {}

  private async resolveCalendar(orgId: string): Promise<BusinessCalendarShape> {
    const calendar = await this.prisma.businessCalendar.findFirst({ where: { orgId, isDeleted: false } });
    if (!calendar) return DEFAULT_CALENDAR;
    return { timezone: calendar.timezone, days: calendar.days as unknown as BusinessCalendarShape['days'] };
  }

  private async resolveHolidays(orgId: string): Promise<Set<string>> {
    const holidays = await this.prisma.holiday.findMany({ where: { orgId, isDeleted: false } });
    return new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  }

  // Parses a money threshold out of a target's `cond`, e.g. "Value ≥ ₹1 Cr" or "Estimated value
  // ≥ ₹50 L" -> 10000000 / 5000000. Supports the Indian Lakh/Crore units these policies are
  // seeded with; returns null for a `cond` that isn't a money-threshold condition at all.
  private parseMoneyThreshold(cond: string): number | null {
    const match = cond.match(/₹\s*([\d.]+)\s*(cr|l|k)?/i);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    const unit = match[2]?.toLowerCase();
    if (unit === 'cr') return value * 1_00_00_000;
    if (unit === 'l') return value * 1_00_000;
    if (unit === 'k') return value * 1_000;
    return value;
  }

  // Picks the tightest (shortest-duration) target whose `cond` actually applies to the live
  // entity — a target applies if either its money threshold (e.g. "Value ≥ ₹1 Cr") is crossed
  // by `entityValue`, or its text matches the optional `context` string (stage name, priority,
  // evaluation type, approver level, ...) as a case-insensitive substring. When several targets
  // apply at once (e.g. a high-value lead from a fast-track source), the tightest one governs,
  // since that's the more urgent commitment. Falls back to the first target when nothing applies
  // — some conditions (e.g. "Tender RFQs" — no tender flag exists on Rfq) can't be evaluated for
  // real yet, a known, deliberate simplification.
  private pickTarget(targets: SlaTarget[], context?: string, entityValue?: number): SlaTarget {
    const applicable = targets.filter((t) => {
      if (typeof entityValue === 'number') {
        const threshold = this.parseMoneyThreshold(t.cond);
        if (threshold !== null) return entityValue >= threshold;
      }
      return context ? t.cond.toLowerCase().includes(context.toLowerCase()) : false;
    });
    if (!applicable.length) return targets[0];
    return applicable.reduce((tightest, t) => (targetMinutes(t.val, t.unit) < targetMinutes(tightest.val, tightest.unit) ? t : tightest));
  }

  // Starts every active policy on `moduleKey` whose `startEvent` matches, unless a still-open
  // timer for that (policy, entity) pair already exists (idempotent against duplicate event fires).
  // `entityValue` (e.g. a lead/opportunity/costing sheet's money value) drives money-threshold
  // targets like "Value ≥ ₹1 Cr" — see pickTarget.
  async startTimer(
    orgId: string,
    moduleKey: string,
    entityType: string,
    entityId: string,
    startEvent: string,
    context?: string,
    entityValue?: number,
  ): Promise<void> {
    const policies = await this.prisma.slaPolicy.findMany({ where: { orgId, moduleKey, startEvent, isActive: true, isDeleted: false } });
    if (!policies.length) return;
    const calendar = await this.resolveCalendar(orgId);
    const holidays = await this.resolveHolidays(orgId);
    for (const policy of policies) {
      const existing = await this.prisma.slaTimer.findFirst({
        where: { orgId, slaPolicyId: policy.id, entityType, entityId, isDeleted: false, stoppedAt: null },
      });
      if (existing) continue;
      const target = this.pickTarget(policy.targets as unknown as SlaTarget[], context, entityValue);
      const startedAt = new Date();
      const { dueAt } = computeSlaState(startedAt, startedAt, target, policy.calendarType as SlaCalendarType, calendar, holidays);
      await this.prisma.slaTimer.create({
        data: { orgId, slaPolicyId: policy.id, entityType, entityId, status: 'On track', startedAt, dueAt },
      });
    }
  }

  // The 'date-sweep' cron entry point — see DATE_SWEEP_RULES above for which policies this covers.
  // Tells an opportunity's owner once when its expected close date has passed while the deal is still open.
  private async alertCloseDatesCrossed(): Promise<void> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const overdue = await this.prisma.opportunity.findMany({
      where: { isDeleted: false, stage: { notIn: ['Won', 'Lost'] }, closeDate: { lt: startOfToday }, ownerId: { not: null } },
      select: { id: true, orgId: true, ownerId: true, title: true, closeDate: true },
      take: 500,
    });
    for (const opp of overdue) {
      await this.notifications.createOnce(
        opp.orgId,
        opp.ownerId as string,
        'Expected close date passed',
        `${opp.title} was expected to close on ${opp.closeDate.toISOString().slice(0, 10)} and is still open. Update the date or close the deal.`,
        `/opportunities/${opp.id}`,
      );
    }
  }

  // Reminds a visit's sales owner (once per scheduled date) when an open site visit is due within a day.
  private async remindUpcomingVisits(): Promise<void> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const visits = await this.prisma.siteVisit.findMany({
      where: { isDeleted: false, status: { in: ['Planned', 'Confirmed', 'Rescheduled'] }, visitDate: { gte: startOfToday, lte: horizon }, ownerId: { not: null } },
      select: { id: true, orgId: true, ownerId: true, title: true, visitDate: true, time: true },
      take: 500,
    });
    for (const visit of visits) {
      const date = visit.visitDate.toISOString().slice(0, 10);
      await this.notifications.createOnce(
        visit.orgId,
        visit.ownerId as string,
        `Site visit reminder · ${date}`,
        `${visit.title} is scheduled for ${date}${visit.time ? ` at ${visit.time}` : ''}. Confirm it or reschedule.`,
        `/site-visits/${visit.id}`,
      );
    }
  }

  // A quotation still waiting on the customer after its validity date lapses is Expired (Accepted/Rejected/Revised ones keep their outcome).
  private async expireLapsedQuotations(): Promise<void> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    await this.prisma.quotation.updateMany({
      where: { isDeleted: false, status: { in: ['Sent', 'Approved'] }, validUntil: { lt: startOfToday } },
      data: { status: 'Expired' },
    });
  }

  // Payment milestones become Due on their due date and Overdue after it; going overdue books a collection follow-up for the owner.
  private async refreshPaymentStatuses(): Promise<void> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    await this.prisma.paymentMilestone.updateMany({
      where: { isDeleted: false, status: 'Not due', dueDate: { gte: startOfToday, lt: startOfTomorrow } },
      data: { status: 'Due' },
    });
    const overdue = await this.prisma.paymentMilestone.findMany({
      where: { isDeleted: false, status: { in: ['Not due', 'Due'] }, dueDate: { lt: startOfToday } },
      select: { id: true, orgId: true, ownerId: true, accountId: true, milestone: true },
      take: 500,
    });
    for (const milestone of overdue) {
      await this.prisma.paymentMilestone.update({ where: { id: milestone.id }, data: { status: 'Overdue' } });
      await this.automation.fire(milestone.orgId, 'Payment overdue', { link: `/payments/${milestone.id}`, title: `'${milestone.milestone}' payment is overdue`, ownerId: milestone.ownerId, accountId: milestone.accountId });
      await this.prisma.mfgActivity.create({
        data: {
          orgId: milestone.orgId,
          type: 'Payment follow-up',
          subject: `Collect overdue '${milestone.milestone}' payment`,
          accountId: milestone.accountId,
          ownerId: milestone.ownerId,
          priority: 'High',
          status: 'Open',
          dueDate: startOfToday,
        },
      });
    }
  }

  // A demo/trial still 'Scheduled' or 'In progress' two days past its planned date reminds its owner (once per planned date).
  private async remindOverdueEvaluations(): Promise<void> {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const overdue = await this.prisma.evaluation.findMany({
      where: { isDeleted: false, status: { in: ['Scheduled', 'In progress'] }, plannedDate: { lt: cutoff }, ownerId: { not: null } },
      select: { id: true, orgId: true, ownerId: true, title: true, plannedDate: true },
      take: 500,
    });
    for (const evaluation of overdue) {
      const date = evaluation.plannedDate.toISOString().slice(0, 10);
      await this.notifications.createOnce(
        evaluation.orgId,
        evaluation.ownerId as string,
        `Evaluation overdue · ${date}`,
        `${evaluation.title} was planned for ${date} and has no result yet. Record the outcome or reschedule.`,
        `/demos/${evaluation.id}`,
      );
    }
  }

  // Open tenders get a heads-up a week before the submission deadline and again on the last day (once each).
  private async remindTenderDeadlines(): Promise<void> {
    const now = Date.now();
    const tenders = await this.prisma.tender.findMany({
      where: { isDeleted: false, status: { in: ['Identified', 'Preparing'] }, ownerId: { not: null }, submissionDeadline: { gte: new Date(now), lte: new Date(now + 7 * 24 * 60 * 60 * 1000) } },
      select: { id: true, orgId: true, ownerId: true, title: true, submissionDeadline: true },
      take: 500,
    });
    for (const tender of tenders) {
      const date = tender.submissionDeadline.toISOString().slice(0, 10);
      const lastDay = tender.submissionDeadline.getTime() - now <= 24 * 60 * 60 * 1000;
      await this.notifications.createOnce(
        tender.orgId,
        tender.ownerId as string,
        `Tender deadline ${date} (${lastDay ? '1-day' : '7-day'} notice)`,
        `${tender.title} must be submitted by ${date}.`,
        `/tenders/${tender.id}`,
      );
    }
  }

  // Coverage inside its 90-day renewal window turns 'Due soon' with a renewal task for the owner.
  private async flagCoverageDueSoon(): Promise<void> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(startOfToday.getTime() + 90 * 24 * 60 * 60 * 1000);
    const due = await this.prisma.coverage.findMany({
      where: { isDeleted: false, status: 'Not due', end: { gte: startOfToday, lte: horizon } },
      select: { id: true, orgId: true, ownerId: true, accountId: true, type: true, end: true },
      take: 500,
    });
    for (const coverage of due) {
      await this.prisma.coverage.update({ where: { id: coverage.id }, data: { status: 'Due soon' } });
      await this.nurturing.enroll(coverage.orgId, 'amc_due_soon', 'Coverage', coverage.id);
      await this.prisma.mfgActivity.create({
        data: {
          orgId: coverage.orgId,
          type: 'Call',
          subject: `Renew ${coverage.type} coverage ending ${coverage.end.toISOString().slice(0, 10)}`,
          accountId: coverage.accountId,
          ownerId: coverage.ownerId,
          priority: 'Medium',
          status: 'Open',
          dueDate: startOfToday,
        },
      });
    }
  }

  // An asset's warranty running out moves it to 'Under AMC' if an AMC covers today, otherwise 'Out of coverage'.
  private async refreshAssetCoverageStatus(): Promise<void> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const lapsed = await this.prisma.installedAsset.findMany({
      where: { isDeleted: false, status: 'Under warranty', warrantyEnd: { lt: startOfToday } },
      select: { id: true },
      take: 500,
    });
    for (const asset of lapsed) {
      const amc = await this.prisma.coverage.findFirst({
        where: { assetId: asset.id, isDeleted: false, type: { in: ['AMC', 'CMC'] }, status: { not: 'Lost' }, start: { lte: startOfToday }, end: { gte: startOfToday } },
        select: { id: true },
      });
      await this.prisma.installedAsset.update({ where: { id: asset.id }, data: { status: amc ? 'Under AMC' : 'Out of coverage' } });
    }
  }

  async runDateTriggeredSweep(): Promise<void> {
    for (const [name, sweep] of [
      ['Payment status', () => this.refreshPaymentStatuses()],
      ['Evaluation overdue', () => this.remindOverdueEvaluations()],
      ['Tender deadline', () => this.remindTenderDeadlines()],
      ['Coverage renewal', () => this.flagCoverageDueSoon()],
      ['Asset coverage status', () => this.refreshAssetCoverageStatus()],
    ] as const) {
      try {
        await sweep();
      } catch (err) {
        this.logger.error(`${name} sweep failed`, err instanceof Error ? err.stack : err);
      }
    }
    try {
      await this.expireLapsedQuotations();
    } catch (err) {
      this.logger.error('Quotation expiry sweep failed', err instanceof Error ? err.stack : err);
    }
    try {
      await this.remindUpcomingVisits();
    } catch (err) {
      this.logger.error('Site-visit reminder sweep failed', err instanceof Error ? err.stack : err);
    }
    try {
      await this.alertCloseDatesCrossed();
    } catch (err) {
      this.logger.error('Close-date alert sweep failed', err instanceof Error ? err.stack : err);
    }
    for (const rule of DATE_SWEEP_RULES) {
      try {
        await this.sweepRule(rule);
      } catch (err) {
        this.logger.error(`Date-triggered SLA sweep failed for startEvent '${rule.startEvent}'`, err instanceof Error ? err.stack : err);
      }
    }
  }

  private async sweepRule(rule: DateSweepRule): Promise<void> {
    const policies = await this.prisma.slaPolicy.findMany({
      where: { moduleKey: rule.moduleKey, startEvent: rule.startEvent, isActive: true, isDeleted: false },
    });
    if (!policies.length) return;
    const orgIds = [...new Set(policies.map((p) => p.orgId))];
    const threshold = new Date(Date.now() + rule.offsetDays * 24 * 60 * 60 * 1000);
    const delegate = this.prisma[rule.delegate] as {
      findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
    };
    const candidates = await delegate.findMany({
      where: {
        orgId: { in: orgIds },
        isDeleted: false,
        // No `not: null` here: half of DATE_SWEEP_RULES' dateFields are non-nullable
        // DateTime columns (nextActionDate, validUntil, end, dueDate on
        // Opportunity/Quotation/Coverage/PaymentMilestone), and Prisma rejects `not: null`
        // on those as a validation error ("Argument `not` must not be null") — which was
        // throwing on every hourly sweep for those 4 of 6 rules, silently, forever (caught
        // per-rule in runDateTriggeredSweep). It was also redundant for the nullable fields:
        // `lte: threshold` already excludes NULL rows under normal SQL NULL semantics.
        [rule.dateField]: { lte: threshold },
        [rule.statusField]: { notIn: rule.excludeStatuses },
      },
    });
    for (const candidate of candidates) {
      const context = rule.contextField ? (candidate[rule.contextField] as string | undefined) : undefined;
      await this.startTimer(candidate.orgId as string, rule.moduleKey, rule.entityType, candidate.id as string, rule.startEvent, context);
    }
  }

  // Stops every open timer for policies on `moduleKey` whose `stopEvent` matches this entity.
  async stopTimer(orgId: string, moduleKey: string, entityType: string, entityId: string, stopEvent: string): Promise<void> {
    const policies = await this.prisma.slaPolicy.findMany({ where: { orgId, moduleKey, stopEvent, isActive: true, isDeleted: false } });
    if (!policies.length) return;
    for (const policy of policies) {
      await this.prisma.slaTimer.updateMany({
        where: { orgId, slaPolicyId: policy.id, entityType, entityId, isDeleted: false, stoppedAt: null },
        data: { stoppedAt: new Date(), status: 'Met' },
      });
    }
  }

  // The `{l, t}` shape every existing `sla`-type list/detail column expects (registry.ts /
  // mfg-schema.js), for the most recently started timer on this entity (a policy may re-fire
  // across the entity's lifetime — e.g. per stage — so "most recent" is the relevant one).
  async getSlaState(orgId: string, entityType: string, entityId: string): Promise<SlaStateView | null> {
    const timer = await this.prisma.slaTimer.findFirst({
      where: { orgId, entityType, entityId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!timer) return null;
    if (timer.status === 'Met') return { l: 'Met', t: 'gray' };
    if (!timer.dueAt) return { l: 'Not started', t: 'gray' };
    const now = new Date();
    const overdueMs = now.getTime() - timer.dueAt.getTime();
    if (overdueMs > 0) return { l: `Breached ${this.humanizeDuration(overdueMs)}`, t: 'red' };
    if (timer.status === 'At risk') return { l: `Due in ${this.humanizeDuration(-overdueMs)}`, t: 'amber' };
    return { l: `Due in ${this.humanizeDuration(-overdueMs)}`, t: 'green' };
  }

  private humanizeDuration(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }

  // The cron ticker's entry point — syncs pause state against each entity's live status, then
  // recomputes every still-running open timer's state and fires any newly crossed escalation.
  async tick(): Promise<void> {
    await this.syncPauseState();
    const timers = await this.prisma.slaTimer.findMany({
      where: { isDeleted: false, stoppedAt: null, startedAt: { not: null }, pausedAt: null },
      include: { slaPolicy: true },
    });
    for (const timer of timers) {
      try {
        await this.evaluateTimer(timer);
      } catch (err) {
        this.logger.error(`Failed to evaluate SlaTimer '${timer.id}'`, err instanceof Error ? err.stack : err);
      }
    }
  }

  // Pauses an open timer the moment its entity's live status enters the policy's
  // `pauseStatuses` list, and resumes it (shifting `startedAt` forward by exactly how long it
  // was paused, so the paused interval doesn't count as elapsed time) once the status leaves
  // that list again — e.g. an RFQ sitting in "Clarification required" stops burning down SLA-07.
  private async syncPauseState(): Promise<void> {
    const candidates = await this.prisma.slaTimer.findMany({
      where: { isDeleted: false, stoppedAt: null, startedAt: { not: null } },
      include: { slaPolicy: true },
    });
    const relevant = candidates.filter((t) => t.slaPolicy.pauseStatuses.length > 0);
    if (!relevant.length) return;

    const entityCache = new Map<string, Record<string, unknown> | null>();
    for (const timer of relevant) {
      const lookup = STATUS_LOOKUP[timer.slaPolicy.moduleKey];
      if (!lookup) continue;
      const cacheKey = `${String(lookup.delegate)}:${timer.entityId}`;
      if (!entityCache.has(cacheKey)) {
        const delegate = this.prisma[lookup.delegate] as { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
        entityCache.set(cacheKey, await delegate.findFirst({ where: { id: timer.entityId, orgId: timer.orgId } }));
      }
      const entity = entityCache.get(cacheKey);
      if (!entity) continue;
      const currentStatus = String(entity[lookup.statusField] ?? '');
      const shouldBePaused = timer.slaPolicy.pauseStatuses.includes(currentStatus);

      if (shouldBePaused && !timer.pausedAt) {
        await this.prisma.slaTimer.update({ where: { id: timer.id }, data: { pausedAt: new Date() } });
      } else if (!shouldBePaused && timer.pausedAt) {
        const pausedMs = Date.now() - timer.pausedAt.getTime();
        const shiftedStartedAt = new Date(timer.startedAt!.getTime() + pausedMs);
        await this.prisma.slaTimer.update({ where: { id: timer.id }, data: { pausedAt: null, startedAt: shiftedStartedAt } });
      }
    }
  }

  private async evaluateTimer(
    timer: Prisma.SlaTimerGetPayload<{ include: { slaPolicy: true } }>,
  ): Promise<void> {
    const policy = timer.slaPolicy;
    const targets = policy.targets as unknown as SlaTarget[];
    if (!targets.length || !timer.startedAt) return;
    const target = this.pickTarget(targets);
    const calendar = await this.resolveCalendar(timer.orgId);
    const holidays = await this.resolveHolidays(timer.orgId);
    const now = new Date();
    const { dueAt, elapsedPct } = computeSlaState(timer.startedAt, now, target, policy.calendarType as SlaCalendarType, calendar, holidays);
    const status = elapsedPct >= 100 ? 'Breached' : elapsedPct >= 75 ? 'At risk' : 'On track';

    const levels = (policy.escalationLevels as unknown as SlaEscalationLevel[]).slice().sort((a, b) => a.at - b.at);
    const crossed = levels.filter((level) => elapsedPct >= level.at && level.at > timer.lastEscalationLevel);
    for (const level of crossed) {
      await this.fireEscalation(timer, level, elapsedPct);
    }
    const newLastLevel = crossed.length ? Math.max(...crossed.map((l) => l.at)) : timer.lastEscalationLevel;

    await this.prisma.slaTimer.update({
      where: { id: timer.id },
      data: { status, dueAt, lastEscalationLevel: newLastLevel },
    });
  }

  private async resolveRecipientUsers(
    timer: Prisma.SlaTimerGetPayload<{ include: { slaPolicy: true } }>,
    who: string,
  ): Promise<{ id: string; email: string }[]> {
    const roleEnum = ROLE_LABEL_TO_ENUM[who];
    if (roleEnum) return this.usersForRole(timer.orgId, roleEnum);

    if (who === 'Approver' || who === 'Next level up') {
      const approval = await this.prisma.approval.findFirst({ where: { id: timer.entityId, orgId: timer.orgId } });
      const approverRoleEnum = approval?.currentApprover ? ROLE_LABEL_TO_ENUM[approval.currentApprover] : undefined;
      return approverRoleEnum ? this.usersForRole(timer.orgId, approverRoleEnum) : [];
    }

    const ownerFieldMoves = ['Owner', 'Sales owner', 'Renewal owner'];
    if (ownerFieldMoves.includes(who) || who === 'Technical owner') {
      const delegateKey = OWNER_LOOKUP_DELEGATE[timer.slaPolicy.moduleKey];
      if (!delegateKey) return [];
      const delegate = this.prisma[delegateKey] as { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
      const record = await delegate.findFirst({ where: { id: timer.entityId, orgId: timer.orgId } });
      if (!record) return [];
      const ownerId = (who === 'Technical owner' ? record.technicalOwnerId : record.ownerId) as string | null | undefined;
      if (!ownerId) return [];
      const user = await this.prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, email: true } });
      return user ? [user] : [];
    }

    // Every other `who` value (e.g. free-text conditions this phase doesn't model) is logged,
    // not silently dropped, so a gap is visible rather than a quiet no-op.
    this.logger.warn(`SLA escalation recipient '${who}' is not resolvable to a user (policy '${timer.slaPolicyId}')`);
    return [];
  }

  private async usersForRole(orgId: string, role: MfgRole): Promise<{ id: string; email: string }[]> {
    return this.prisma.user.findMany({ where: { orgId, mfgRole: role, isActive: true }, select: { id: true, email: true } });
  }

  private async fireEscalation(
    timer: Prisma.SlaTimerGetPayload<{ include: { slaPolicy: true } }>,
    level: SlaEscalationLevel,
    elapsedPct: number,
  ): Promise<void> {
    // WhatsApp: no generic (non-lead-scoped) WhatsApp sender exists yet, so it's logged, not
    // silently dropped, and nothing else in this level is skipped because of it.
    if (level.channels.includes('WhatsApp') && !level.channels.includes('Email') && !level.channels.includes('In-app')) {
      this.logger.log(`SLA escalation level ${level.at}% for timer '${timer.id}' is WhatsApp-only — not dispatched.`);
      return;
    }
    const recipients = await this.resolveRecipientUsers(timer, level.who);
    if (!recipients.length) return;
    const subject = `SLA alert: ${timer.slaPolicy.name} at ${Math.round(elapsedPct)}% of target`;
    const html = `<p>${timer.slaPolicy.name}</p><p>Entity: ${timer.entityType} ${timer.entityId}</p><p>Elapsed: ${Math.round(elapsedPct)}% of target</p>`;
    const routeSegment = ROUTE_SEGMENT_FOR_MODULE[timer.slaPolicy.moduleKey];
    const link = routeSegment ? `/${routeSegment}/${timer.entityId}` : undefined;

    for (const recipient of recipients) {
      if (level.channels.includes('Email')) {
        await this.mail.send(recipient.email, subject, html);
      }
      if (level.channels.includes('In-app')) {
        await this.notifications.create(timer.orgId, recipient.id, subject, `${timer.slaPolicy.name} — ${Math.round(elapsedPct)}% of target elapsed.`, link);
      }
    }
  }
}
