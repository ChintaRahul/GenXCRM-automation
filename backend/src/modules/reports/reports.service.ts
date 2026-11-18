import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Role, LeadStage, PaymentStatus } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ReportFilterDto } from './dto/report-filter.dto';
import type { TeamPerformanceFilterDto } from './dto/team-performance-filter.dto';
import { CLOSED_LEAD_STAGES, SYSTEM_ACTIVITY_TYPES } from '../../common/constants/lead.constants';
import { leadInRange } from '../../common/utils/lead-range.util';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

// Resolved relative to this compiled/transpiled file's own location (dist/modules/reports
// or src/modules/reports) so it works the same under `ts-node`/`nest start --watch` and the
// built `dist/main`, regardless of the process's current working directory.
const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'logo-mark.png');
let cachedLogoBuffer: Buffer | null | undefined;
// Missing/unreadable logo file falls back to a drawn letter-mark rather than throwing —
// a PDF export should never fail just because a static brand asset didn't ship.
function loadLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer === undefined) {
    try {
      cachedLogoBuffer = fs.readFileSync(LOGO_PATH);
    } catch {
      cachedLogoBuffer = null;
    }
  }
  return cachedLogoBuffer;
}

// ─── Timezone-aware date boundaries ────────────────────────────────────────
// Report date filters ("Today", "Last 7 Days", ...) are calendar-day concepts from the
// caller's perspective, but Lead.createdAt/updatedAt are stored as UTC instants. Resolving
// "the start of Sep 3" as UTC midnight (instead of midnight in the org's own timezone) shifts
// the whole window by the org's UTC offset — for an Asia/Kolkata org that's -5:30, so any
// activity in the first ~5.5 hours of a local day gets counted as "yesterday", producing
// exactly the kind of off-by-one undercount reported against the enrollment/lead counts.
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - date.getTime();
}

// Converts a "YYYY-MM-DD" date-only string, interpreted as local midnight in `timeZone`,
// into the equivalent UTC Date instant.
function zonedDateToUtc(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d));
  return new Date(utcGuess.getTime() - getTimeZoneOffsetMs(utcGuess, timeZone));
}

// Today's calendar date in `timeZone`, as "YYYY-MM-DD". Built from formatToParts rather than
// `Intl.DateTimeFormat(...).format()` — the 'en-CA' locale is commonly relied on for ISO
// ordering, but that's a locale convention, not a format-token guarantee, and depends on the
// ICU data bundled with the Node build; explicit numeric parts avoid that dependency.
function zonedTodayStr(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// "YYYY-MM-DD" shifted by `days` calendar days (pure calendar arithmetic, no timezone involved).
function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ─── PDF design tokens ──────────────────────────────────────────────────────
// Mirrors the app's teal brand and --chart-1..5 in frontend/src/index.css (light + dark
// themes) — pdfkit draws with literal hex/RGB, it cannot consume CSS variables. Keep in
// sync if the app palette changes. `pageBg` is filled explicitly behind every page's
// content so the export can follow whichever theme was active when the caller requested it.
const PDF_LIGHT_COLORS = {
  primary: '#0F9488',
  primaryDark: '#0B6F66',
  primaryTint: '#E6F5F3',
  ink: '#111827',
  muted: '#6B7280',
  mutedTint: '#F8FAFC',
  border: '#E2E8F0',
  white: '#FFFFFF',
  pageBg: '#FFFFFF',
};
const PDF_DARK_COLORS = {
  primary: '#1FC1B6',
  primaryDark: '#5EEAE0',
  primaryTint: '#12332F',
  ink: '#E8EAEE',
  muted: '#8D95A5',
  mutedTint: '#161A24',
  border: '#252A37',
  white: '#FFFFFF',
  pageBg: '#0C0F17',
};
const PDF_COLORS_BY_THEME = { light: PDF_LIGHT_COLORS, dark: PDF_DARK_COLORS };
const CHART_COLORS = ['#0F9488', '#2563EB', '#F59E0B', '#8B5CF6', '#EF4444'];

// Generous ceiling for Excel/CSV's "full lead-source row set" requirement — not a real
// pagination cap, just a sanity bound so a single export can't run away indefinitely.
const EXPORT_LEAD_SOURCE_LIMIT = 100_000;

const PDF_MARGIN_X = 50;
const PDF_CONTENT_TOP = 92;
const PDF_CONTENT_BOTTOM = 60;

// pdfkit's standard 14 fonts (WinAnsi encoding) don't reliably include the ₹ glyph — "Rs."
// avoids missing-glyph boxes without embedding a custom font just for the currency sign.
function formatINR(amount: number): string {
  return `Rs. ${Math.round(amount).toLocaleString('en-IN')}`;
}

// "FOLLOW_UP_REQUIRED" -> "Follow Up Required" — raw enum values wrap awkwardly (or
// hyphen-break mid-word) in narrow chart/table columns.
function humanizeStage(stage: string): string {
  return stage
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface TableColumn<T> {
  header: string;
  flex: number;
  align?: 'left' | 'right' | 'center';
  value: (row: T) => string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // The one date-range rule shared by every report count and the Leads list (see
  // common/utils/lead-range.util.ts). Returned as a fragment; callers spread it
  // (`...inRange(r)`) or put it inside an `AND` array when the surrounding where already
  // uses `OR`.
  private static inRange(range: Prisma.DateTimeFilter): Prisma.LeadWhereInput {
    return leadInRange(range);
  }

  private buildScopeFilter(caller: AuthUser): Prisma.LeadWhereInput {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    if (caller.role === Role.SALES_REP) return { ...orgFilter, assignedToId: caller.id };
    if (caller.role === Role.MANAGER) return { ...orgFilter, teamId: caller.teamId ?? undefined };
    return orgFilter;
  }

  // Org + role scope, plus the daily-report filter bar (team member / campaign).
  // teamMemberId is ignored for SALES_REP callers — they're already locked to their own leads.
  private buildFilterWhere(filter: ReportFilterDto, caller: AuthUser): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = { ...this.buildScopeFilter(caller) };
    if (filter.teamMemberId && caller.role !== Role.SALES_REP) {
      where.assignedToId = filter.teamMemberId;
    }
    if (filter.campaignId) {
      where.campaignId = filter.campaignId;
    }
    return where;
  }

  // Defaults to "today" in the org's own timezone when no range is given, matching the
  // report's daily framing. `to` is a date-only string (e.g. "2026-08-08") meaning "through
  // the end of that day" — so the upper bound must be the start of the *next* local day, used
  // as an exclusive bound.
  //
  // Pure/synchronous on purpose: several call sites (dailyDashboard) run multiple report
  // sub-methods concurrently via Promise.all and rely on each running synchronously up to its
  // first real await, so their prisma calls fire (and consume test mock queues) in a
  // deterministic order. Resolving the org's timezone requires a DB lookup, so that lookup is
  // done once by the caller and threaded through here as a plain string, keeping this step
  // itself await-free.
  private resolveDateRangeForZone(filter: ReportFilterDto, timeZone: string): Prisma.DateTimeFilter {
    const startOfToday = zonedDateToUtc(zonedTodayStr(timeZone), timeZone);
    const endOfToday = new Date(startOfToday);
    endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);

    let exclusiveEnd = endOfToday;
    if (filter.to) {
      exclusiveEnd = zonedDateToUtc(filter.to, timeZone);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    }

    return {
      gte: filter.from ? zonedDateToUtc(filter.from, timeZone) : startOfToday,
      lt: exclusiveEnd,
    };
  }

  private async resolveDateRange(
    filter: ReportFilterDto,
    caller: AuthUser,
    timeZone?: string,
  ): Promise<Prisma.DateTimeFilter> {
    const tz = timeZone ?? (await this.getOrgTimezone(caller));
    return this.resolveDateRangeForZone(filter, tz);
  }

  private async getOrgTimezone(caller: AuthUser): Promise<string> {
    if (!caller.orgId) return 'UTC';
    const org = await this.prisma.organization.findUnique({
      where: { id: caller.orgId },
      select: { timezone: true },
    });
    return org?.timezone ?? 'UTC';
  }

  async overview(caller: AuthUser) {
    const scopeFilter = this.buildScopeFilter(caller);
    const where: Prisma.LeadWhereInput = { isDeleted: false, ...scopeFilter };
    const paymentScopeFilter: Prisma.PaymentWhereInput = { lead: scopeFilter };

    // "Today" / "this month" are calendar concepts in the org's own timezone — UTC boundaries
    // shift them by the org's offset (e.g. leads created 12:00-05:30 am IST would fall on
    // "yesterday"), so a tile's count would disagree with the list its link opens.
    const timeZone = await this.getOrgTimezone(caller);
    const todayStr = zonedTodayStr(timeZone);
    const today = zonedDateToUtc(todayStr, timeZone);
    const yesterday = zonedDateToUtc(addDaysStr(todayStr, -1), timeZone);
    const thirtyDaysAgo = zonedDateToUtc(addDaysStr(todayStr, -30), timeZone);
    const inflowStartStr = addDaysStr(todayStr, -29);
    const inflowStart = zonedDateToUtc(inflowStartStr, timeZone);

    const monthStr = `${todayStr.slice(0, 7)}-01`;
    const startOfCurrentMonth = zonedDateToUtc(monthStr, timeZone);
    const startOfLastMonth = zonedDateToUtc(`${addDaysStr(monthStr, -1).slice(0, 7)}-01`, timeZone);

    const [
      totalLeads,
      newToday,
      enrolled,
      notInterested,
      totalPayments,
      prev30Total,
      newYesterday,
      enrolledThisMtd,
      enrolledLastMtd,
      revenueThisMtd,
      revenueLastMtd,
      totalLeadsMtd,
      unassignedQueue,
      activeSequences,
      inflowLeads,
    ] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: { ...where, createdAt: { gte: today } } }),
      this.prisma.lead.count({ where: { ...where, stage: LeadStage.ENROLLED } }),
      this.prisma.lead.count({ where: { ...where, stage: LeadStage.NOT_INTERESTED } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID', ...paymentScopeFilter },
      }),
      // Delta fields
      this.prisma.lead.count({ where: { ...where, createdAt: { lt: thirtyDaysAgo } } }),
      this.prisma.lead.count({ where: { ...where, createdAt: { gte: yesterday, lt: today } } }),
      this.prisma.lead.count({
        where: { ...where, stage: LeadStage.ENROLLED, ...ReportsService.inRange({ gte: startOfCurrentMonth }) },
      }),
      this.prisma.lead.count({
        where: {
          ...where,
          stage: LeadStage.ENROLLED,
          ...ReportsService.inRange({ gte: startOfLastMonth, lt: startOfCurrentMonth }),
        },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID', ...paymentScopeFilter, paidAt: { gte: startOfCurrentMonth } },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'PAID',
          ...paymentScopeFilter,
          paidAt: { gte: startOfLastMonth, lt: startOfCurrentMonth },
        },
      }),
      this.prisma.lead.count({ where: { ...where, ...ReportsService.inRange({ gte: startOfCurrentMonth }) } }),
      caller.role !== Role.SALES_REP
        ? this.prisma.lead.count({ where: { ...where, assignedToId: null } })
        : Promise.resolve<number | undefined>(undefined),
      this.prisma.nurturingSequence.count({
        where: { isActive: true, ...(caller.orgId ? { orgId: caller.orgId } : {}) },
      }),
      this.prisma.lead.findMany({
        where: { ...where, createdAt: { gte: inflowStart } },
        select: { createdAt: true },
      }),
    ]);

    // Build 30-element daily inflow array (oldest → newest)
    const inflowMap = new Map<string, number>();
    for (let d = 0; d < 30; d++) {
      inflowMap.set(addDaysStr(inflowStartStr, d), 0);
    }
    for (const lead of inflowLeads) {
      const key = zonedTodayStr(timeZone, lead.createdAt);
      if (inflowMap.has(key)) {
        inflowMap.set(key, (inflowMap.get(key) ?? 0) + 1);
      }
    }

    const revenueCollected = totalPayments._sum?.amount ?? 0;
    const revThisMtd = revenueThisMtd._sum?.amount ?? 0;
    const revLastMtd = revenueLastMtd._sum?.amount ?? 0;

    return {
      totalLeads,
      newToday,
      enrolled,
      enrolledMtd: enrolledThisMtd,
      notInterested,
      revenueCollected,
      totalLeadsDelta30d: prev30Total > 0 ? ((totalLeads - prev30Total) / prev30Total) * 100 : 0,
      newTodayDelta: newToday - newYesterday,
      enrolledDeltaMtd: enrolledLastMtd > 0 ? ((enrolledThisMtd - enrolledLastMtd) / enrolledLastMtd) * 100 : 0,
      revenueDeltaMtd: revThisMtd - revLastMtd,
      conversionRate: totalLeadsMtd > 0 ? (enrolledThisMtd / totalLeadsMtd) * 100 : 0,
      avgDeal: enrolledThisMtd > 0 ? revThisMtd / enrolledThisMtd : 0,
      activeSequences,
      unassignedQueue,
      dailyInflow: [...inflowMap.values()],
      // The exact instants the counts above were computed from - the Dashboard links use
      // these so a tile's number and the Leads list it opens always agree.
      todayStart: today.toISOString(),
      monthStart: startOfCurrentMonth.toISOString(),
    };
  }

  async pipeline(caller: AuthUser) {
    const where: Prisma.LeadWhereInput = { isDeleted: false, ...this.buildScopeFilter(caller) };
    return this.prisma.lead.groupBy({
      by: ['stage'],
      where,
      _count: { stage: true },
      orderBy: { _count: { stage: 'desc' } },
    });
  }

  // Optional (from/to may be undefined) counterpart to resolveDateRange — the Team
  // Performance endpoints default to all-time data when no range is given, unlike the
  // Daily Report endpoints which always default to "today".
  private resolveOptionalDateRange(query: TeamPerformanceFilterDto): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    let exclusiveEnd: Date | undefined;
    if (query.to) {
      exclusiveEnd = new Date(query.to);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    }
    return {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(exclusiveEnd ? { lt: exclusiveEnd } : {}),
    };
  }

  async sourcePerformance(caller: AuthUser, query: TeamPerformanceFilterDto = {}) {
    const range = this.resolveOptionalDateRange(query);
    const where: Prisma.LeadWhereInput = {
      isDeleted: false,
      ...this.buildScopeFilter(caller),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(range ? ReportsService.inRange(range) : {}),
    };

    const [bySource, wonBySource] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['source'], where, _count: { source: true } }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { ...where, stage: LeadStage.ENROLLED },
        _count: { source: true },
      }),
    ]);

    const wonMap = Object.fromEntries(wonBySource.map((s) => [s.source, s._count.source]));

    return bySource.map((s) => {
      const enrolledCount = wonMap[s.source] ?? 0;
      return {
        source: s.source,
        total: s._count.source,
        enrolled: enrolledCount,
        conversionRate: s._count.source > 0 ? (enrolledCount / s._count.source) * 100 : 0,
      };
    });
  }

  async teamLeaderboard(caller: AuthUser, query: TeamPerformanceFilterDto = {}) {
    if (caller.role === Role.SALES_REP) return [];

    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const teamWhere: Prisma.TeamWhereInput =
      caller.role === Role.MANAGER
        ? { id: caller.teamId ?? undefined, ...orgFilter }
        : { ...orgFilter, ...(query.teamId ? { id: query.teamId } : {}) };

    const teams = await this.prisma.team.findMany({
      where: teamWhere,
      include: { members: { select: { id: true } } },
    });

    const range = this.resolveOptionalDateRange(query);
    const now = new Date();
    const startOfCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // Revenue MTD stays "current calendar month" unless the caller picks an explicit range.
    const revenueRange: Prisma.DateTimeFilter = range ?? { gte: startOfCurrentMonth };

    return Promise.all(
      teams.map(async (team) => {
        const memberIds = team.members.map((m) => m.id);
        const leadWhere: Prisma.LeadWhereInput = {
          assignedToId: { in: memberIds },
          isDeleted: false,
          ...orgFilter,
          ...(range ? ReportsService.inRange(range) : {}),
        };

        const [total, enrolled, revenueResult] = await Promise.all([
          this.prisma.lead.count({ where: leadWhere }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.ENROLLED } }),
          this.prisma.payment.aggregate({
            _sum: { amount: true },
            where: {
              status: 'PAID',
              paidAt: revenueRange,
              lead: {
                isDeleted: false,
                assignedToId: { in: memberIds },
                ...(caller.orgId ? { orgId: caller.orgId } : {}),
              },
            },
          }),
        ]);

        return {
          teamId: team.id,
          teamName: team.name,
          total,
          enrolled,
          conversionRate: total > 0 ? (enrolled / total) * 100 : 0,
          target: team.monthlyTarget,
          revenueCollected: revenueResult._sum?.amount ?? 0,
        };
      }),
    );
  }

  // Always the last 7 calendar days regardless of the caller's selected date range — a
  // "recent pulse" indicator, not a range-filtered figure.
  private async getRepActivityTrend(repId: string): Promise<number[]> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Excludes system-written activity types (ASSIGNED, REASSIGN, ASSIGNMENT_FAILED) so a
    // rep's daily bar reflects actual work (calls/notes/stage changes), not how many leads
    // were auto-assigned to them that day — see SYSTEM_ACTIVITY_TYPES for why this matters.
    const activities = await this.prisma.activity.findMany({
      where: {
        userId: repId,
        createdAt: { gte: sevenDaysAgo, lt: tomorrow },
        type: { notIn: SYSTEM_ACTIVITY_TYPES },
      },
      select: { createdAt: true },
    });

    const dayCounts = new Map<string, number>();
    for (let d = 0; d < 7; d++) {
      const date = new Date(sevenDaysAgo);
      date.setUTCDate(date.getUTCDate() + d);
      dayCounts.set(date.toISOString().slice(0, 10), 0);
    }
    for (const activity of activities) {
      const key = activity.createdAt.toISOString().slice(0, 10);
      if (dayCounts.has(key)) {
        dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
      }
    }
    return [...dayCounts.values()];
  }

  async productivity(caller: AuthUser, query: TeamPerformanceFilterDto = {}) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const teamFilter = query.teamId && caller.role !== Role.SALES_REP ? { teamId: query.teamId } : {};
    const repFilter =
      caller.role === Role.SALES_REP
        ? { id: caller.id }
        : caller.role === Role.MANAGER
          ? { role: Role.SALES_REP, isActive: true, teamId: caller.teamId ?? undefined, ...orgFilter }
          : { role: Role.SALES_REP, isActive: true, ...orgFilter, ...teamFilter };

    const reps = await this.prisma.user.findMany({
      where: repFilter,
      select: { id: true, name: true, monthlyTarget: true },
    });

    const range = this.resolveOptionalDateRange(query);
    const now = new Date();
    const startOfCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const revenueRange: Prisma.DateTimeFilter = range ?? { gte: startOfCurrentMonth };

    return Promise.all(
      reps.map(async (rep) => {
        // AND (not a flat spread) — rep.id and the scope's own assignedToId (for a
        // MANAGER/DIRECTOR caller, scopeFilter has no assignedToId, so this is just
        // an org/team filter) must both apply; a flat spread would let whichever key
        // comes last silently win.
        const repWhere: Prisma.LeadWhereInput = {
          isDeleted: false,
          // The date range goes inside this AND (not spread as a top-level `OR`): the
          // "leaking" count below adds its own top-level `OR`, which would overwrite it.
          AND: [
            { assignedToId: rep.id },
            this.buildScopeFilter(caller),
            ...(range ? [ReportsService.inRange(range)] : []),
          ],
        };
        const [total, notEngaged, untouched, followupOverdue, leaking, revenueResult, trend] = await Promise.all([
          this.prisma.lead.count({ where: repWhere }),
          this.prisma.lead.count({ where: { ...repWhere, score: { lt: 10 } } }),
          // "No genuine engagement" — excludes system-written activity types (ASSIGNED,
          // REASSIGN, ASSIGNMENT_FAILED) so the auto-assignment activity every lead gets
          // the instant it's routed to a rep doesn't make it count as "touched".
          this.prisma.lead.count({
            where: { ...repWhere, activities: { none: { type: { notIn: SYSTEM_ACTIVITY_TYPES } } } },
          }),
          this.prisma.lead.count({ where: { ...repWhere, stage: { notIn: CLOSED_LEAD_STAGES } } }),
          // Distinct-lead count for "leaking" — untouched and followupOverdue overlap
          // heavily (an untouched lead is almost always also non-closed), so summing
          // those two counts double-counts leads. This OR gives the true union.
          this.prisma.lead.count({
            where: {
              ...repWhere,
              OR: [
                { activities: { none: { type: { notIn: SYSTEM_ACTIVITY_TYPES } } } },
                { stage: { notIn: CLOSED_LEAD_STAGES } },
              ],
            },
          }),
          this.prisma.payment.aggregate({
            _sum: { amount: true },
            where: {
              status: 'PAID',
              paidAt: revenueRange,
              lead: { isDeleted: false, assignedToId: rep.id, ...orgFilter },
            },
          }),
          this.getRepActivityTrend(rep.id),
        ]);
        return {
          repId: rep.id,
          repName: rep.name,
          total,
          notEngaged,
          untouched,
          followupOverdue,
          leaking,
          target: rep.monthlyTarget,
          revenueCollected: revenueResult._sum?.amount ?? 0,
          trend,
        };
      }),
    );
  }

  // ─── Daily Sales & Lead Management Report ──────────────────────────────────

  async dailySummary(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = timeZone
      ? this.resolveDateRangeForZone(filter, timeZone)
      : await this.resolveDateRange(filter, caller);

    const [generated, newLeads, contacted, pending] = await Promise.all([
      this.prisma.lead.count({ where: { ...where, isDeleted: false, ...ReportsService.inRange(range) } }),
      this.prisma.lead.count({
        where: { ...where, isDeleted: false, stage: LeadStage.NEW, ...ReportsService.inRange(range) },
      }),
      // Same definition as the status report's "Contacted" row (current stage CONTACTED) so
      // the tile and that row never disagree.
      this.prisma.lead.count({
        where: { ...where, isDeleted: false, stage: LeadStage.CONTACTED, ...ReportsService.inRange(range) },
      }),
      this.prisma.lead.count({
        where: {
          // AND, not a flat spread — `where` may already set `assignedToId` (a SALES_REP's
          // own id, via buildScopeFilter), which a sibling `assignedToId: { not: null }` key
          // on the same object would silently overwrite, widening the count to org-wide.
          AND: [
            where,
            {
              isDeleted: false,
              stage: LeadStage.NEW,
              assignedToId: { not: null },
              communications: { none: {} },
            },
            ReportsService.inRange(range),
          ],
        },
      }),
    ]);

    // Exposed so the frontend's KPI-tile drill-through links (e.g. "Pending leads" ->
    // /leads?pendingFollowup=1&createdAfter=...) can reuse the exact UTC instants this
    // count was computed against, instead of re-deriving date-only `from`/`to` strings
    // client-side. leads.service.ts's own createdAfter/createdBefore parsing is a naive
    // UTC parse (no org-timezone awareness), so for any org whose timezone isn't UTC the
    // two independently-computed boundaries would disagree by the org's UTC offset,
    // making the drill-down list's row count not match this tile's number — passing the
    // already-resolved instants closes that gap without touching leads.service.ts.
    return {
      generated,
      newLeads,
      contacted,
      pending,
      rangeFrom: range.gte as Date,
      rangeTo: range.lt as Date,
    };
  }

  async statusReport(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = timeZone
      ? this.resolveDateRangeForZone(filter, timeZone)
      : await this.resolveDateRange(filter, caller);

    const rows = await this.prisma.lead.groupBy({
      by: ['stage'],
      where: { ...where, isDeleted: false, ...ReportsService.inRange(range) },
      _count: { stage: true },
    });

    return rows.map((r) => ({ stage: r.stage, count: r._count.stage }));
  }

  private async enrollmentByRep(where: Prisma.LeadWhereInput, range: Prisma.DateTimeFilter, caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const repFilter =
      caller.role === Role.SALES_REP
        ? { id: caller.id }
        : caller.role === Role.MANAGER
          ? { role: Role.SALES_REP, isActive: true, teamId: caller.teamId ?? undefined, ...orgFilter }
          : { role: Role.SALES_REP, isActive: true, ...orgFilter };

    const reps = await this.prisma.user.findMany({ where: repFilter, select: { id: true, name: true } });
    const repIds = reps.map((rep) => rep.id);

    const perRep = await Promise.all(
      reps.map(async (rep) => {
        // AND, not a flat spread — `where` (buildFilterWhere-scoped to the caller)
        // must not be silently overwritten by `assignedToId: rep.id`.
        const repWhere: Prisma.LeadWhereInput = {
          isDeleted: false,
          AND: [{ assignedToId: rep.id }, where, ReportsService.inRange(range)],
        };
        const [repLeads, enrolled, revenueResult] = await Promise.all([
          this.prisma.lead.count({ where: repWhere }),
          this.prisma.lead.count({ where: { ...repWhere, stage: LeadStage.ENROLLED } }),
          this.prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: PaymentStatus.PAID, paidAt: range, lead: { assignedToId: rep.id, ...orgFilter } },
          }),
        ]);
        return {
          repId: rep.id,
          repName: rep.name,
          enrolled,
          revenue: revenueResult._sum?.amount ?? 0,
          conversionRate: repLeads > 0 ? (enrolled / repLeads) * 100 : 0,
        };
      }),
    );

    // enrollmentReport()'s `totalEnrollments` counts every ENROLLED lead in scope, regardless
    // of who it's assigned to — but the loop above only iterates active SALES_REP users, so an
    // ENROLLED lead that's unassigned, or assigned to an inactive/non-rep user, has nowhere to
    // land in perRep and the two numbers silently drift apart. Fold those into an explicit
    // "Unassigned" row so sum(perRep.enrolled) always equals totalEnrollments.
    // `assignedToId: { notIn: repIds }` alone would silently exclude assignedToId: null rows
    // too (SQL NOT IN never matches against NULL) — the OR below makes both cases explicit.
    const unassignedWhere: Prisma.LeadWhereInput = {
      isDeleted: false,
      AND: [
        { OR: [{ assignedToId: null }, { assignedToId: { notIn: repIds } }] },
        where,
        ReportsService.inRange(range),
      ],
    };
    const [unassignedLeads, unassignedEnrolled] = await Promise.all([
      this.prisma.lead.count({ where: unassignedWhere }),
      this.prisma.lead.count({ where: { ...unassignedWhere, stage: LeadStage.ENROLLED } }),
    ]);
    if (unassignedEnrolled > 0 || unassignedLeads > 0) {
      perRep.push({
        repId: 'unassigned',
        repName: 'Unassigned',
        enrolled: unassignedEnrolled,
        revenue: 0,
        conversionRate: unassignedLeads > 0 ? (unassignedEnrolled / unassignedLeads) * 100 : 0,
      });
    }

    return perRep;
  }

  async enrollmentReport(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = timeZone
      ? this.resolveDateRangeForZone(filter, timeZone)
      : await this.resolveDateRange(filter, caller);
    // Same lead filter as the counts (org/role scope + team member + campaign), so revenue follows the filter bar.
    const paymentScopeFilter: Prisma.PaymentWhereInput = { lead: where };

    const [totalEnrollments, generated, revenueResult, perRep] = await Promise.all([
      this.prisma.lead.count({
        where: { ...where, isDeleted: false, stage: LeadStage.ENROLLED, ...ReportsService.inRange(range) },
      }),
      this.prisma.lead.count({ where: { ...where, isDeleted: false, ...ReportsService.inRange(range) } }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: PaymentStatus.PAID, paidAt: range, ...paymentScopeFilter },
      }),
      this.enrollmentByRep(where, range, caller),
    ]);

    const revenue = revenueResult._sum?.amount ?? 0;
    return {
      totalEnrollments,
      revenue,
      conversionRate: generated > 0 ? (totalEnrollments / generated) * 100 : 0,
      perRep,
    };
  }

  async campaignPerformance(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = timeZone
      ? this.resolveDateRangeForZone(filter, timeZone)
      : await this.resolveDateRange(filter, caller);
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};

    const campaigns = await this.prisma.campaign.findMany({ where: orgFilter });

    return Promise.all(
      campaigns.map(async (c) => {
        const leadWhere: Prisma.LeadWhereInput = {
          ...where,
          isDeleted: false,
          campaignId: c.id,
          ...ReportsService.inRange(range),
        };
        const [leads, interested, followUp, demoScheduled, enrollments] = await Promise.all([
          this.prisma.lead.count({ where: leadWhere }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.INTERESTED } }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.FOLLOW_UP_REQUIRED } }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.DEMO_SCHEDULED } }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.ENROLLED } }),
        ]);

        return {
          campaignId: c.id,
          campaignName: c.name,
          leads,
          interested,
          followUp,
          demoScheduled,
          enrollments,
          conversionRate: leads > 0 ? (enrollments / leads) * 100 : 0,
        };
      }),
    );
  }

  async adSetPerformance(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = await this.resolveDateRange(filter, caller, timeZone);
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};

    const adSets = await this.prisma.adSet.findMany({
      where: { ...orgFilter, ...(filter.campaignId ? { campaignId: filter.campaignId } : {}) },
    });

    return Promise.all(
      adSets.map(async (a) => {
        const leadWhere: Prisma.LeadWhereInput = {
          ...where,
          isDeleted: false,
          adSetId: a.id,
          ...ReportsService.inRange(range),
        };
        const [leads, interested, enrollments] = await Promise.all([
          this.prisma.lead.count({ where: leadWhere }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.INTERESTED } }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.ENROLLED } }),
        ]);

        return {
          adSetId: a.id,
          adSetName: a.name,
          leads,
          interested,
          enrollments,
          conversionRate: leads > 0 ? (enrollments / leads) * 100 : 0,
        };
      }),
    );
  }

  async adPerformance(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = await this.resolveDateRange(filter, caller, timeZone);
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};

    const ads = await this.prisma.ad.findMany({ where: orgFilter });

    return Promise.all(
      ads.map(async (ad) => {
        const leadWhere: Prisma.LeadWhereInput = {
          ...where,
          isDeleted: false,
          adId: ad.id,
          ...ReportsService.inRange(range),
        };
        const [leads, interested, enrollments] = await Promise.all([
          this.prisma.lead.count({ where: leadWhere }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.INTERESTED } }),
          this.prisma.lead.count({ where: { ...leadWhere, stage: LeadStage.ENROLLED } }),
        ]);

        // `name === externalId` means the Facebook Insights sync has never matched this ad
        // against the connected ad account (e.g. the ad belongs to a different, inaccessible
        // ad account) — its impressions/clicks are unknown, not genuinely zero, so CTR must
        // be reported as unavailable rather than a misleading 0%.
        const hasInsightsData = ad.name !== ad.externalId;

        return {
          adId: ad.id,
          adName: ad.name,
          leads,
          interested,
          enrollments,
          ctr: hasInsightsData ? (ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0) : null,
          conversionRate: leads > 0 ? (enrollments / leads) * 100 : 0,
        };
      }),
    );
  }

  async leadSourceTracking(filter: ReportFilterDto, caller: AuthUser, timeZone?: string) {
    const where = this.buildFilterWhere(filter, caller);
    const range = await this.resolveDateRange(filter, caller, timeZone);
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const listWhere: Prisma.LeadWhereInput = { ...where, isDeleted: false, ...ReportsService.inRange(range) };

    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where: listWhere }),
      this.prisma.lead.findMany({
        where: listWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          source: true,
          stage: true,
          campaign: { select: { name: true } },
          adSet: { select: { name: true } },
          ad: { select: { name: true } },
          assignedTo: { select: { name: true } },
        },
      }),
    ]);

    return {
      data: leads.map((l) => ({
        leadId: l.id,
        name: l.name,
        source: l.source,
        campaign: l.campaign?.name ?? null,
        adSet: l.adSet?.name ?? null,
        ad: l.ad?.name ?? null,
        owner: l.assignedTo?.name ?? null,
        stage: l.stage,
        enrollmentStatus: l.stage === LeadStage.ENROLLED ? 'enrolled' : 'not_enrolled',
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async campaignOptions(caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return this.prisma.campaign.findMany({
      where: orgFilter,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  // Percent change vs. the immediately-preceding period of equal length. `prev = 0` returns
  // null (not Infinity/0) — a day-over-day percent is meaningless with nothing to compare
  // against, and the frontend renders that as "—" rather than a misleading "+100%"/"0%".
  private static pctDelta(current: number, prev: number): number | null {
    return prev > 0 ? ((current - prev) / prev) * 100 : null;
  }

  // We have no dialer integration, so there's no reliable call log — "total calls" is
  // approximated as the count of stage-change activities that land a lead on one of these
  // stages, since each only happens as the outcome of a call attempt. This undercounts (a
  // rep can call without changing the stage) and overcounts (a bulk/API stage edit looks
  // identical to a real call), so it's a proxy, not a verified call count.
  //
  // A lead is not required to pass through CONTACTED on its way through the funnel — reps
  // routinely jump a lead straight from NEW to DEMO_SCHEDULED or NOT_INTERESTED in a single
  // stage change after one call, with no intermediate CONTACTED activity ever logged. Both
  // outcomes still only happen as the result of a real call, so they belong in this list too.
  private static readonly CALLING_STAGES: LeadStage[] = [
    LeadStage.RINGING_NOT_REACHABLE,
    LeadStage.CALL_BACK,
    LeadStage.CALL_NOT_RECEIVED,
    LeadStage.SWITCHED_OFF,
    LeadStage.CONTACTED,
    LeadStage.DEMO_SCHEDULED,
    LeadStage.NOT_INTERESTED,
  ];

  // The lead itself must also have been CREATED within the report's date range — not just
  // the stage-change activity — so "Total calls" follows the same date filter as "Total
  // leads" instead of pulling in calls made today on leads created on earlier days (which
  // made the estimate exceed totalLeads and read as if it were double-counting).
  private callActivityWhere(
    createdAt: Prisma.DateTimeFilter,
    leadWhere: Prisma.LeadWhereInput,
  ): Prisma.ActivityWhereInput {
    return {
      type: 'STAGE_CHANGE',
      createdAt,
      lead: { ...leadWhere, ...ReportsService.inRange(createdAt) },
      OR: ReportsService.CALLING_STAGES.map((stage) => ({
        metadata: { path: ['stage'], equals: stage },
      })),
    };
  }

  // Distinct leads called, not raw activities — a lead worked through several call stages
  // would otherwise be counted repeatedly and push the total above "Total leads".
  private async countCalledLeads(createdAt: Prisma.DateTimeFilter, leadWhere: Prisma.LeadWhereInput) {
    const rows = await this.prisma.activity.findMany({
      where: this.callActivityWhere(createdAt, leadWhere),
      select: { leadId: true },
      distinct: ['leadId'],
    });
    return rows.length;
  }

  async dailyDashboard(filter: ReportFilterDto, caller: AuthUser) {
    const where = this.buildFilterWhere(filter, caller);
    const timeZone = await this.getOrgTimezone(caller);
    const range = this.resolveDateRangeForZone(filter, timeZone);
    const gte = range.gte as Date;
    const lt = range.lt as Date;
    const periodMs = lt.getTime() - gte.getTime();
    const prevRange: Prisma.DateTimeFilter = { gte: new Date(gte.getTime() - periodMs), lt: gte };
    // Same lead filter as the counts (org/role scope + team member + campaign), so revenue follows the filter bar.
    const paymentScopeFilter: Prisma.PaymentWhereInput = { lead: where };

    const [
      summary,
      enrollment,
      campaigns,
      statusRows,
      prevTotalLeads,
      prevStatusRows,
      prevEnrollments,
      prevRevenueResult,
      totalCalls,
      prevTotalCalls,
    ] = await Promise.all([
      this.dailySummary(filter, caller, timeZone),
      this.enrollmentReport(filter, caller, timeZone),
      this.campaignPerformance(filter, caller, timeZone),
      this.statusReport(filter, caller, timeZone),
      this.prisma.lead.count({ where: { ...where, isDeleted: false, ...ReportsService.inRange(prevRange) } }),
      this.prisma.lead.groupBy({
        by: ['stage'],
        where: { ...where, isDeleted: false, ...ReportsService.inRange(prevRange) },
        _count: { stage: true },
      }),
      this.prisma.lead.count({
        where: { ...where, isDeleted: false, stage: LeadStage.ENROLLED, ...ReportsService.inRange(prevRange) },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: PaymentStatus.PAID, paidAt: prevRange, ...paymentScopeFilter },
      }),
      this.countCalledLeads(range, { ...where, isDeleted: false }),
      this.countCalledLeads(prevRange, { ...where, isDeleted: false }),
    ]);

    const countFor = (stage: LeadStage) => statusRows.find((r) => r.stage === stage)?.count ?? 0;
    const prevCountFor = (stage: LeadStage) =>
      (prevStatusRows as { stage: LeadStage; _count: { stage: number } }[]).find((r) => r.stage === stage)?._count
        .stage ?? 0;

    const interestedLeads = countFor(LeadStage.INTERESTED);
    const followUpLeads = countFor(LeadStage.FOLLOW_UP_REQUIRED);
    const demoScheduled = countFor(LeadStage.DEMO_SCHEDULED);
    const enrollments = enrollment.totalEnrollments;
    const revenue = enrollment.revenue;
    const prevRevenue = prevRevenueResult._sum?.amount ?? 0;

    return {
      totalLeads: summary.generated,
      interestedLeads,
      followUpLeads,
      demoScheduled,
      enrollments,
      revenue,
      avgTicketSize: enrollments > 0 ? revenue / enrollments : 0,
      totalCalls,
      totalCallsDelta: ReportsService.pctDelta(totalCalls, prevTotalCalls),
      totalLeadsDelta: ReportsService.pctDelta(summary.generated, prevTotalLeads),
      interestedLeadsDelta: ReportsService.pctDelta(interestedLeads, prevCountFor(LeadStage.INTERESTED)),
      followUpLeadsDelta: ReportsService.pctDelta(followUpLeads, prevCountFor(LeadStage.FOLLOW_UP_REQUIRED)),
      demoScheduledDelta: ReportsService.pctDelta(demoScheduled, prevCountFor(LeadStage.DEMO_SCHEDULED)),
      enrollmentsDelta: ReportsService.pctDelta(enrollments, prevEnrollments),
      revenueDelta: ReportsService.pctDelta(revenue, prevRevenue),
      campaignPerformance: campaigns,
      salesPersonPerformance: enrollment.perRep,
    };
  }

  private static readonly ALL_DAILY_SECTIONS = [
    'summary',
    'status',
    'enrollment',
    'campaign',
    'sources',
    'dashboard',
    'adsets',
    'ads',
  ] as const;

  async exportDailyReport(
    format: 'csv' | 'excel' | 'pdf',
    filter: ReportFilterDto,
    caller: AuthUser,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const sections = new Set(filter.sections ?? ReportsService.ALL_DAILY_SECTIONS);
    // CSV only ever exports the Summary sheet — force it in regardless of what was requested,
    // so a malformed/future client can't produce an empty CSV.
    if (format === 'csv') sections.add('summary');

    const [summary, status, enrollment, campaigns, leadSources, dashboard, adSets, ads] = await Promise.all([
      sections.has('summary') ? this.dailySummary(filter, caller) : Promise.resolve(undefined),
      sections.has('status') ? this.statusReport(filter, caller) : Promise.resolve(undefined),
      sections.has('enrollment') ? this.enrollmentReport(filter, caller) : Promise.resolve(undefined),
      sections.has('campaign') ? this.campaignPerformance(filter, caller) : Promise.resolve(undefined),
      // Excel/CSV exports must carry the full lead-source row set, not the screen's paginated
      // slice — EXPORT_LEAD_SOURCE_LIMIT is a generous ceiling, not a real pagination cap.
      sections.has('sources')
        ? this.leadSourceTracking({ ...filter, limit: EXPORT_LEAD_SOURCE_LIMIT }, caller)
        : Promise.resolve(undefined),
      sections.has('dashboard') ? this.dailyDashboard(filter, caller) : Promise.resolve(undefined),
      sections.has('adsets') ? this.adSetPerformance(filter, caller) : Promise.resolve(undefined),
      sections.has('ads') ? this.adPerformance(filter, caller) : Promise.resolve(undefined),
    ]);

    const dateStamp = new Date().toISOString().slice(0, 10);
    const data = { summary, status, enrollment, campaigns, leadSources, dashboard, adSets, ads };

    if (format === 'pdf') {
      const org = caller.orgId
        ? await this.prisma.organization.findUnique({ where: { id: caller.orgId }, select: { name: true } })
        : null;
      const buffer = await this.buildDailyReportPdf(data, {
        sections,
        includeCharts: filter.includeCharts ?? true,
        includeCover: filter.includeCover ?? true,
        orientation: filter.orientation ?? 'portrait',
        from: filter.from,
        to: filter.to,
        teamMemberId: filter.teamMemberId,
        campaignId: filter.campaignId,
        orgName: org?.name,
        theme: filter.theme,
      });
      return { buffer, contentType: 'application/pdf', filename: `daily-report-${dateStamp}.pdf` };
    }

    const workbook = this.buildDailyReportWorkbook(data, sections);

    if (format === 'excel') {
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      return {
        buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `daily-report-${dateStamp}.xlsx`,
      };
    }

    // csv — export just the Summary sheet, matching the single-table nature of CSV.
    const buffer = Buffer.from(await workbook.csv.writeBuffer({ sheetName: 'Summary' }));
    return { buffer, contentType: 'text/csv', filename: `daily-report-${dateStamp}.csv` };
  }

  private buildDailyReportWorkbook(
    data: {
      summary?: Awaited<ReturnType<ReportsService['dailySummary']>>;
      status?: Awaited<ReturnType<ReportsService['statusReport']>>;
      enrollment?: Awaited<ReturnType<ReportsService['enrollmentReport']>>;
      campaigns?: Awaited<ReturnType<ReportsService['campaignPerformance']>>;
      leadSources?: Awaited<ReturnType<ReportsService['leadSourceTracking']>>;
      dashboard?: Awaited<ReturnType<ReportsService['dailyDashboard']>>;
      adSets?: Awaited<ReturnType<ReportsService['adSetPerformance']>>;
      ads?: Awaited<ReturnType<ReportsService['adPerformance']>>;
    },
    sections: Set<string>,
  ): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();

    if (sections.has('summary')) {
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      const rows: { metric: string; value: number | string }[] = [];
      if (data.summary) {
        rows.push(
          { metric: 'Total Leads Generated', value: data.summary.generated },
          { metric: 'Total New Leads', value: data.summary.newLeads },
          { metric: 'Total Contacted Leads', value: data.summary.contacted },
          { metric: 'Total Pending Leads', value: data.summary.pending },
        );
      }
      if (data.enrollment) {
        rows.push(
          { metric: 'Total Enrollments', value: data.enrollment.totalEnrollments },
          { metric: 'Revenue', value: data.enrollment.revenue },
          { metric: 'Conversion Rate (%)', value: data.enrollment.conversionRate.toFixed(2) },
        );
      }
      summarySheet.addRows(rows);
    }

    if (sections.has('status') && data.status) {
      const statusSheet = workbook.addWorksheet('Lead Status');
      statusSheet.columns = [
        { header: 'Stage', key: 'stage', width: 25 },
        { header: 'Count', key: 'count', width: 15 },
      ];
      statusSheet.addRows(data.status);
    }

    if (sections.has('enrollment') && data.enrollment) {
      const enrollmentSheet = workbook.addWorksheet('Enrollment');
      enrollmentSheet.columns = [
        { header: 'Sales Rep', key: 'repName', width: 25 },
        { header: 'Enrollments', key: 'enrolled', width: 15 },
        { header: 'Revenue', key: 'revenue', width: 20 },
        { header: 'Conversion Rate (%)', key: 'conversionRate', width: 18 },
      ];
      enrollmentSheet.addRows(data.enrollment.perRep);
    }

    if (sections.has('campaign') && data.campaigns) {
      const campaignSheet = workbook.addWorksheet('Campaign Performance');
      campaignSheet.columns = [
        { header: 'Campaign', key: 'campaignName', width: 25 },
        { header: 'Leads', key: 'leads', width: 12 },
        { header: 'Interested', key: 'interested', width: 12 },
        { header: 'Follow-up', key: 'followUp', width: 12 },
        { header: 'Demo Scheduled', key: 'demoScheduled', width: 14 },
        { header: 'Enrollments', key: 'enrollments', width: 14 },
        { header: 'Conversion Rate (%)', key: 'conversionRate', width: 18 },
      ];
      campaignSheet.addRows(data.campaigns);
    }

    if (sections.has('adsets') && data.adSets) {
      const adSetSheet = workbook.addWorksheet('Ad Set Performance');
      adSetSheet.columns = [
        { header: 'Ad Set', key: 'adSetName', width: 25 },
        { header: 'Leads', key: 'leads', width: 12 },
        { header: 'Interested', key: 'interested', width: 12 },
        { header: 'Converted Students', key: 'enrollments', width: 18 },
        { header: 'Conversion Rate (%)', key: 'conversionRate', width: 18 },
      ];
      adSetSheet.addRows(data.adSets);
    }

    if (sections.has('ads') && data.ads) {
      const adSheet = workbook.addWorksheet('Ad Performance');
      adSheet.columns = [
        { header: 'Ad', key: 'adName', width: 25 },
        { header: 'Leads', key: 'leads', width: 12 },
        { header: 'Interested', key: 'interested', width: 12 },
        { header: 'Enrollments', key: 'enrollments', width: 14 },
        { header: 'CTR (%)', key: 'ctr', width: 12 },
        { header: 'Conversion Rate (%)', key: 'conversionRate', width: 18 },
      ];
      adSheet.addRows(data.ads);
    }

    if (sections.has('dashboard') && data.dashboard) {
      const dashboardSheet = workbook.addWorksheet('Dashboard');
      dashboardSheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
        { header: 'Delta vs Prior Period (%)', key: 'delta', width: 24 },
      ];
      const d = data.dashboard;
      dashboardSheet.addRows([
        { metric: 'Total Leads', value: d.totalLeads, delta: d.totalLeadsDelta?.toFixed(1) ?? '—' },
        { metric: 'Interested Leads', value: d.interestedLeads, delta: d.interestedLeadsDelta?.toFixed(1) ?? '—' },
        { metric: 'Follow-up Leads', value: d.followUpLeads, delta: d.followUpLeadsDelta?.toFixed(1) ?? '—' },
        {
          metric: 'Demo Scheduled',
          value: d.demoScheduled,
          delta: d.demoScheduledDelta?.toFixed(1) ?? '—',
        },
        { metric: 'Enrollments', value: d.enrollments, delta: d.enrollmentsDelta?.toFixed(1) ?? '—' },
        { metric: 'Revenue', value: d.revenue, delta: d.revenueDelta?.toFixed(1) ?? '—' },
        { metric: 'Average Ticket Size', value: d.avgTicketSize, delta: '—' },
        { metric: 'Total Calls (est.)', value: d.totalCalls, delta: d.totalCallsDelta?.toFixed(1) ?? '—' },
      ]);
    }

    if (sections.has('sources') && data.leadSources) {
      const sourceSheet = workbook.addWorksheet('Lead Sources');
      sourceSheet.columns = [
        { header: 'Lead', key: 'name', width: 22 },
        { header: 'Campaign', key: 'campaign', width: 20 },
        { header: 'Ad Set', key: 'adSet', width: 20 },
        { header: 'Ad', key: 'ad', width: 20 },
        { header: 'Owner', key: 'owner', width: 20 },
        { header: 'Stage', key: 'stage', width: 20 },
        { header: 'Enrollment Status', key: 'enrollmentStatus', width: 18 },
      ];
      sourceSheet.addRows(data.leadSources.data);
    }

    return workbook;
  }

  private buildDailyReportPdf(
    data: {
      summary?: Awaited<ReturnType<ReportsService['dailySummary']>>;
      status?: Awaited<ReturnType<ReportsService['statusReport']>>;
      enrollment?: Awaited<ReturnType<ReportsService['enrollmentReport']>>;
      campaigns?: Awaited<ReturnType<ReportsService['campaignPerformance']>>;
      leadSources?: Awaited<ReturnType<ReportsService['leadSourceTracking']>>;
      dashboard?: Awaited<ReturnType<ReportsService['dailyDashboard']>>;
      adSets?: Awaited<ReturnType<ReportsService['adSetPerformance']>>;
      ads?: Awaited<ReturnType<ReportsService['adPerformance']>>;
    },
    options: {
      sections: Set<string>;
      includeCharts: boolean;
      includeCover: boolean;
      orientation: 'portrait' | 'landscape';
      from?: string;
      to?: string;
      teamMemberId?: string;
      campaignId?: string;
      orgName?: string;
      theme?: 'light' | 'dark';
    },
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: options.orientation === 'landscape' ? 'landscape' : 'portrait',
        margins: { top: PDF_CONTENT_TOP, bottom: PDF_CONTENT_BOTTOM, left: PDF_MARGIN_X, right: PDF_MARGIN_X },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { sections, includeCharts } = options;
      // Shadows the module-level light palette for the rest of this closure — every
      // PDF_COLORS.xxx reference below picks up whichever theme was requested.
      const PDF_COLORS = PDF_COLORS_BY_THEME[options.theme ?? 'light'];
      const orgName = options.orgName?.trim() || 'GenX CRM';
      const orgMarkLetter = orgName.charAt(0).toUpperCase();
      const title = 'Daily Sales & Lead Management Report';
      const rangeLabel = options.from && options.to ? `${options.from} – ${options.to}` : 'Today';
      const filterParts: string[] = [];
      if (options.teamMemberId) filterParts.push('Filtered by team member');
      if (options.campaignId) filterParts.push('filtered by campaign');
      const filtersLabel = filterParts.length > 0 ? filterParts.join(', ') : 'All team members, all campaigns';
      const footerLeftLabel = `Generated ${new Date().toISOString().slice(0, 10)} · ${filtersLabel}`;
      const contentWidth = doc.page.width - PDF_MARGIN_X * 2;
      const reset = () => doc.fillColor(PDF_COLORS.ink).font('Helvetica').fontSize(9);

      const drawRunningHeader = () => {
        const pageWidth = doc.page.width;
        // Explicit full-page fill — pdfkit's canvas defaults to white, so a dark theme
        // needs this on every page (this runs right after every doc.addPage()).
        doc.rect(0, 0, pageWidth, doc.page.height).fill(PDF_COLORS.pageBg);
        doc.rect(0, 0, pageWidth, 5).fill(PDF_COLORS.primary);
        doc.fillColor(PDF_COLORS.ink).font('Helvetica-Bold').fontSize(11).text(orgName, PDF_MARGIN_X, 22);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(PDF_COLORS.muted)
          .text('Daily Sales & Lead Management Report', PDF_MARGIN_X, 37);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(PDF_COLORS.muted)
          .text(rangeLabel, 0, 26, { align: 'right', width: pageWidth - PDF_MARGIN_X });
        doc
          .moveTo(PDF_MARGIN_X, 60)
          .lineTo(pageWidth - PDF_MARGIN_X, 60)
          .lineWidth(1)
          .strokeColor(PDF_COLORS.border)
          .stroke();
        doc.x = PDF_MARGIN_X;
        doc.y = PDF_CONTENT_TOP;
        reset();
      };

      const ensureSpace = (neededHeight: number) => {
        const bottom = doc.page.height - PDF_CONTENT_BOTTOM;
        if (doc.y + neededHeight > bottom) {
          doc.addPage();
          drawRunningHeader();
        }
      };

      const drawSectionTitle = (label: string) => {
        ensureSpace(34);
        doc.roundedRect(PDF_MARGIN_X, doc.y + 1, 4, 13, 2).fill(PDF_COLORS.primary);
        doc
          .fillColor(PDF_COLORS.ink)
          .font('Helvetica-Bold')
          .fontSize(12.5)
          .text(label, PDF_MARGIN_X + 12, doc.y);
        doc.y += 12;
        reset();
      };

      const drawEmptyState = (message: string) => {
        ensureSpace(20);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(PDF_COLORS.muted).text(message);
        doc.moveDown(0.6);
        reset();
      };

      const drawKpiRow = (tiles: { label: string; value: string }[]) => {
        const gap = 10;
        const tileWidth = (contentWidth - gap * (tiles.length - 1)) / tiles.length;
        const tileHeight = 52;
        ensureSpace(tileHeight + 14);
        // Capture the row's y once — doc.y advances as a side effect of each .text() call, so
        // re-reading doc.y per tile would stagger the tiles into a downward staircase.
        const rowY = doc.y;
        tiles.forEach((tile, i) => {
          const x = PDF_MARGIN_X + i * (tileWidth + gap);
          const y = rowY;
          doc.roundedRect(x, y, tileWidth, tileHeight, 6).fill(PDF_COLORS.primaryTint);
          doc
            .fillColor(PDF_COLORS.muted)
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .text(tile.label.toUpperCase(), x + 10, y + 10, { width: tileWidth - 20, characterSpacing: 0.3 });
          doc
            .fillColor(PDF_COLORS.primaryDark)
            .font('Helvetica-Bold')
            .fontSize(16)
            .text(tile.value, x + 10, y + 26, { width: tileWidth - 20 });
        });
        doc.y = rowY + tileHeight + 18;
        doc.x = PDF_MARGIN_X;
        reset();
      };

      // Fixed max width per bar — without this, dividing the full content width by a small
      // row count (e.g. 1-3 campaigns) produces comically wide bars. A group narrower than
      // the available content width is centered rather than stretched to fill it.
      const MAX_BAR_WIDTH = 56;

      const drawBarChart = (rows: { label: string; value: number }[], valueFormatter?: (v: number) => string) => {
        if (rows.length === 0) return;
        const chartHeight = 120;
        const gap = 10;
        ensureSpace(chartHeight + 46);
        const barWidth = Math.min(MAX_BAR_WIDTH, (contentWidth - gap * (rows.length - 1)) / rows.length);
        const groupWidth = barWidth * rows.length + gap * (rows.length - 1);
        const groupStartX = PDF_MARGIN_X + Math.max(0, (contentWidth - groupWidth) / 2);
        const maxValue = Math.max(...rows.map((r) => r.value), 1);
        const chartTop = doc.y + 14;
        const baselineY = chartTop + chartHeight;

        doc
          .moveTo(PDF_MARGIN_X, baselineY)
          .lineTo(PDF_MARGIN_X + contentWidth, baselineY)
          .lineWidth(1)
          .strokeColor(PDF_COLORS.border)
          .stroke();

        rows.forEach((row, i) => {
          const barHeight = row.value > 0 ? Math.max((row.value / maxValue) * chartHeight, 3) : 0;
          const x = groupStartX + i * (barWidth + gap);
          const y = baselineY - barHeight;
          if (barHeight > 0) {
            doc
              .roundedRect(x, y, barWidth, barHeight, Math.min(3, barWidth / 2))
              .fill(CHART_COLORS[i % CHART_COLORS.length]);
          }
          doc
            .fillColor(PDF_COLORS.ink)
            .font('Helvetica-Bold')
            .fontSize(8)
            .text(valueFormatter ? valueFormatter(row.value) : String(row.value), x, y - 13, {
              width: barWidth,
              align: 'center',
            });
          doc
            .fillColor(PDF_COLORS.muted)
            .font('Helvetica')
            .fontSize(7)
            .text(row.label, x, baselineY + 6, { width: barWidth, align: 'center', ellipsis: true });
        });

        doc.y = baselineY + 26;
        doc.x = PDF_MARGIN_X;
        reset();
      };

      const drawTable = <T>(columns: TableColumn<T>[], rows: T[]) => {
        const totalFlex = columns.reduce((sum, c) => sum + c.flex, 0);
        const widths = columns.map((c) => (c.flex / totalFlex) * contentWidth);
        const headerHeight = 22;
        const rowHeight = 19;

        // Every column in a row is drawn at the SAME fixed y — doc.y advances as a side effect
        // of each .text() call, so re-reading doc.y per column would stagger later columns
        // downward and, near a page boundary, can even push the last column onto a new page.
        const drawHeaderRow = () => {
          ensureSpace(headerHeight + rowHeight);
          const rowY = doc.y;
          doc.rect(PDF_MARGIN_X, rowY, contentWidth, headerHeight).fill(PDF_COLORS.primaryTint);
          let x = PDF_MARGIN_X;
          columns.forEach((col, i) => {
            doc
              .fillColor(PDF_COLORS.primaryDark)
              .font('Helvetica-Bold')
              .fontSize(7.5)
              .text(col.header.toUpperCase(), x + 8, rowY + 7, {
                width: widths[i] - 12,
                align: col.align ?? 'left',
                characterSpacing: 0.2,
              });
            x += widths[i];
          });
          doc.y = rowY + headerHeight;
          reset();
        };

        drawHeaderRow();
        rows.forEach((row, rowIndex) => {
          if (doc.y + rowHeight > doc.page.height - PDF_CONTENT_BOTTOM) {
            doc.addPage();
            drawRunningHeader();
            drawHeaderRow();
          }
          const rowY = doc.y;
          if (rowIndex % 2 === 1) {
            doc.rect(PDF_MARGIN_X, rowY, contentWidth, rowHeight).fill(PDF_COLORS.mutedTint);
          }
          let x = PDF_MARGIN_X;
          columns.forEach((col, i) => {
            doc
              .fillColor(PDF_COLORS.ink)
              .font('Helvetica')
              .fontSize(8.5)
              .text(col.value(row), x + 8, rowY + 5, {
                width: widths[i] - 12,
                height: rowHeight - 7,
                align: col.align ?? 'left',
                ellipsis: true,
              });
            x += widths[i];
          });
          doc.y = rowY + rowHeight;
        });

        doc
          .moveTo(PDF_MARGIN_X, doc.y)
          .lineTo(PDF_MARGIN_X + contentWidth, doc.y)
          .lineWidth(1)
          .strokeColor(PDF_COLORS.border)
          .stroke();
        doc.y += 16;
        doc.x = PDF_MARGIN_X;
        reset();
      };

      const drawCoverPage = () => {
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        doc.rect(0, 0, pageWidth, pageHeight).fill(PDF_COLORS.pageBg);
        doc.rect(0, 0, pageWidth, 8).fill(PDF_COLORS.primary);

        const markSize = 46;
        const markX = pageWidth / 2 - markSize / 2;
        const markY = pageHeight * 0.32;
        const logoBuffer = loadLogoBuffer();
        if (logoBuffer) {
          doc.image(logoBuffer, markX, markY, { width: markSize, height: markSize });
        } else {
          doc.roundedRect(markX, markY, markSize, markSize, 10).fill(PDF_COLORS.primary);
          doc
            .fillColor(PDF_COLORS.white)
            .font('Helvetica-Bold')
            .fontSize(22)
            .text(orgMarkLetter, markX, markY + 12, { width: markSize, align: 'center' });
        }

        doc
          .fillColor(PDF_COLORS.muted)
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text(orgName.toUpperCase(), 0, markY + markSize + 18, {
            width: pageWidth,
            align: 'center',
            characterSpacing: 2,
          });

        doc
          .fillColor(PDF_COLORS.ink)
          .font('Helvetica-Bold')
          .fontSize(25)
          .text(title, pageWidth * 0.15, markY + markSize + 42, { width: pageWidth * 0.7, align: 'center' });

        const pillY = doc.y + 18;
        doc.font('Helvetica-Bold').fontSize(10.5);
        const pillWidth = doc.widthOfString(rangeLabel) + 34;
        const pillHeight = 24;
        const pillX = pageWidth / 2 - pillWidth / 2;
        doc.roundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2).fill(PDF_COLORS.primaryTint);
        doc.fillColor(PDF_COLORS.primaryDark).text(rangeLabel, pillX, pillY + 7, { width: pillWidth, align: 'center' });

        doc
          .fillColor(PDF_COLORS.muted)
          .font('Helvetica')
          .fontSize(9)
          .text(`Generated ${new Date().toISOString().slice(0, 10)}`, 0, pillY + pillHeight + 14, {
            width: pageWidth,
            align: 'center',
          });

        doc
          .moveTo(PDF_MARGIN_X, pageHeight - 70)
          .lineTo(pageWidth - PDF_MARGIN_X, pageHeight - 70)
          .lineWidth(1)
          .strokeColor(PDF_COLORS.border)
          .stroke();
        // pdfkit auto-inserts a page break for any .text() call whose y falls inside the
        // margins.bottom-excluded zone, even with an explicit y — that's exactly where a
        // footer belongs, so zero the bottom margin for this one call and restore it after.
        const savedBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc
          .fillColor(PDF_COLORS.muted)
          .font('Helvetica')
          .fontSize(8)
          .text('Confidential — internal distribution only', 0, pageHeight - 56, { width: pageWidth, align: 'center' });
        doc.page.margins.bottom = savedBottomMargin;
        reset();
      };

      if (options.includeCover) {
        drawCoverPage();
        doc.addPage();
        drawRunningHeader();
      } else {
        drawRunningHeader();
      }

      if (sections.has('dashboard') && data.dashboard) {
        const d = data.dashboard;
        drawSectionTitle('Daily Dashboard');
        drawKpiRow([
          { label: 'Total Leads', value: String(d.totalLeads) },
          { label: 'Interested', value: String(d.interestedLeads) },
          { label: 'Follow-up', value: String(d.followUpLeads) },
          { label: 'Demo Scheduled', value: String(d.demoScheduled) },
        ]);
        drawKpiRow([
          { label: 'Enrollments', value: String(d.enrollments) },
          { label: 'Revenue', value: formatINR(d.revenue) },
          { label: 'Avg Ticket Size', value: formatINR(d.avgTicketSize) },
          { label: 'Total Calls (est.)', value: String(d.totalCalls) },
        ]);

        // Short templated narrative summary — not AI-generated, just the headline KPIs
        // stitched into a sentence for the morning-standup read.
        ensureSpace(30);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor(PDF_COLORS.ink)
          .text(
            `Between ${rangeLabel}, the team generated ${d.totalLeads} leads and made an estimated ${d.totalCalls} calls, ` +
              `converting ${d.enrollments} enrollments worth ${formatINR(d.revenue)} at an average ticket size of ` +
              `${formatINR(d.avgTicketSize)}.`,
            PDF_MARGIN_X,
            doc.y,
            { width: contentWidth },
          );
        doc.moveDown(0.8);
        reset();
      }

      if (sections.has('summary') && data.summary) {
        drawSectionTitle('Lead Summary');
        drawKpiRow([
          { label: 'Total Leads', value: String(data.summary.generated) },
          { label: 'New Leads', value: String(data.summary.newLeads) },
          { label: 'Contacted', value: String(data.summary.contacted) },
          { label: 'Pending', value: String(data.summary.pending) },
        ]);
      }

      if (sections.has('status') && data.status) {
        drawSectionTitle('Lead Status Report');
        if (data.status.length === 0) {
          drawEmptyState('No leads created in this range.');
        } else if (includeCharts) {
          drawBarChart(data.status.slice(0, 8).map((r) => ({ label: humanizeStage(r.stage), value: r.count })));
          if (data.status.length > 8) {
            doc
              .fontSize(8)
              .fillColor(PDF_COLORS.muted)
              .text(`+${data.status.length - 8} more stages not shown`);
            reset();
          }
        } else {
          const total = data.status.reduce((sum, r) => sum + r.count, 0);
          drawTable<(typeof data.status)[number]>(
            [
              { header: 'Stage', flex: 2, value: (r) => humanizeStage(r.stage) },
              { header: 'Count', flex: 1, align: 'right', value: (r) => String(r.count) },
              {
                header: 'Share',
                flex: 1,
                align: 'right',
                value: (r) => `${total > 0 ? ((r.count / total) * 100).toFixed(0) : 0}%`,
              },
            ],
            data.status,
          );
        }
      }

      if (sections.has('enrollment') && data.enrollment) {
        drawSectionTitle('Enrollment Report');
        drawKpiRow([
          { label: 'Total Enrollments', value: String(data.enrollment.totalEnrollments) },
          { label: 'Revenue', value: formatINR(data.enrollment.revenue) },
          { label: 'Conversion Rate', value: `${data.enrollment.conversionRate.toFixed(1)}%` },
        ]);
      }

      // Page 2 (matching the print layout): Campaign, Ad set, and Ad performance tables
      // together on a fresh page — this content is dense enough to warrant its own page
      // rather than flowing awkwardly under whatever's left of page 1.
      if (sections.has('campaign') || sections.has('adsets') || sections.has('ads')) {
        doc.addPage();
        drawRunningHeader();
      }

      if (sections.has('campaign') && data.campaigns) {
        drawSectionTitle('Campaign Performance');
        if (data.campaigns.length === 0) {
          drawEmptyState('No campaign data for this range.');
        } else {
          if (includeCharts) {
            drawBarChart(data.campaigns.slice(0, 10).map((c) => ({ label: c.campaignName, value: c.leads })));
            if (data.campaigns.length > 10) {
              doc
                .fontSize(8)
                .fillColor(PDF_COLORS.muted)
                .text(`+${data.campaigns.length - 10} more campaigns not shown`);
              reset();
            }
          }
          drawTable<(typeof data.campaigns)[number]>(
            [
              { header: 'Campaign', flex: 2.4, value: (c) => c.campaignName },
              { header: 'Leads', flex: 0.9, align: 'right', value: (c) => String(c.leads) },
              { header: 'Interested', flex: 1, align: 'right', value: (c) => String(c.interested) },
              { header: 'Follow-up', flex: 1, align: 'right', value: (c) => String(c.followUp) },
              { header: 'Demo Sched.', flex: 1.1, align: 'right', value: (c) => String(c.demoScheduled) },
              { header: 'Enrollments', flex: 1.2, align: 'right', value: (c) => String(c.enrollments) },
              { header: 'Conv.', flex: 1, align: 'right', value: (c) => `${c.conversionRate.toFixed(1)}%` },
            ],
            data.campaigns.slice(0, 25),
          );
        }
      }

      if (sections.has('adsets') && data.adSets) {
        drawSectionTitle('Ad Set Performance');
        if (data.adSets.length === 0) {
          drawEmptyState('No ad set data for this range.');
        } else {
          drawTable<(typeof data.adSets)[number]>(
            [
              { header: 'Ad Set', flex: 2.2, value: (a) => a.adSetName },
              { header: 'Leads', flex: 1, align: 'right', value: (a) => String(a.leads) },
              { header: 'Interested', flex: 1, align: 'right', value: (a) => String(a.interested) },
              { header: 'Converted Students', flex: 1.4, align: 'right', value: (a) => String(a.enrollments) },
              { header: 'Conv.', flex: 1, align: 'right', value: (a) => `${a.conversionRate.toFixed(1)}%` },
            ],
            data.adSets,
          );
        }
      }

      if (sections.has('ads') && data.ads) {
        drawSectionTitle('Ad Performance');
        if (data.ads.length === 0) {
          drawEmptyState('No ad data for this range.');
        } else {
          drawTable<(typeof data.ads)[number]>(
            [
              { header: 'Ad', flex: 2.2, value: (a) => a.adName },
              { header: 'Leads', flex: 1, align: 'right', value: (a) => String(a.leads) },
              { header: 'Interested', flex: 1, align: 'right', value: (a) => String(a.interested) },
              { header: 'Conv.', flex: 1, align: 'right', value: (a) => String(a.enrollments) },
              { header: 'CTR', flex: 1, align: 'right', value: (a) => (a.ctr === null ? '—' : `${a.ctr.toFixed(2)}%`) },
              { header: 'Conv. Rate', flex: 1.2, align: 'right', value: (a) => `${a.conversionRate.toFixed(1)}%` },
            ],
            data.ads,
          );
        }
      }

      if (sections.has('sources') && data.leadSources) {
        // Page 3 (matching the print layout): a 10-row extract, not the full list — the
        // complete row set belongs in the Excel/CSV export, which has no row cap.
        doc.addPage();
        drawRunningHeader();
        drawSectionTitle('Lead Source Tracking — Extract');
        if (data.leadSources.data.length === 0) {
          drawEmptyState('No leads in this range.');
        } else {
          const shown = data.leadSources.data.slice(0, 10);
          drawTable<(typeof shown)[number]>(
            [
              { header: 'Lead', flex: 2, value: (l) => l.name },
              { header: 'Campaign', flex: 1.8, value: (l) => l.campaign ?? '—' },
              { header: 'Owner', flex: 1.4, value: (l) => l.owner ?? 'Unassigned' },
              { header: 'Stage', flex: 1.3, value: (l) => humanizeStage(l.stage) },
              {
                header: 'Enrolled',
                flex: 1,
                align: 'center',
                value: (l) => (l.enrollmentStatus === 'enrolled' ? 'Yes' : 'No'),
              },
            ],
            shown,
          );
          doc
            .fontSize(8)
            .fillColor(PDF_COLORS.muted)
            .text(
              `Showing ${shown.length} of ${data.leadSources.data.length} leads in this range — see the Excel/CSV export for the complete list.`,
            );
          reset();
        }
      }

      // Footer page numbers are added in a post-process pass (via bufferPages/switchToPage)
      // since the total page count isn't known until all content has been written.
      const pageRange = doc.bufferedPageRange();
      const contentPageCount = options.includeCover ? pageRange.count - 1 : pageRange.count;
      for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        if (options.includeCover && i === pageRange.start) continue; // cover has its own footer
        doc.switchToPage(i);
        const pageNum = options.includeCover ? i - pageRange.start : i - pageRange.start + 1;
        const footerY = doc.page.height - 34;
        // Same margins.bottom-excluded-zone gotcha as the cover footer — zero it for this draw.
        const savedBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc
          .fillColor(PDF_COLORS.muted)
          .font('Helvetica')
          .fontSize(8)
          .text(footerLeftLabel, PDF_MARGIN_X, footerY, { width: 340, lineBreak: false })
          .text(`Page ${pageNum} of ${contentPageCount}`, 0, footerY, {
            width: doc.page.width - PDF_MARGIN_X,
            align: 'right',
            lineBreak: false,
          });
        doc.page.margins.bottom = savedBottomMargin;
      }

      doc.end();
    });
  }
}
