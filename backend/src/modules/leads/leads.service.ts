import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Role, LeadStage, CommType, LeadSource, Industry, OrgSize } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { CreateLeadDto } from './dto/create-lead.dto';
import type { UpdateLeadDto } from './dto/update-lead.dto';
import type { QueryLeadDto } from './dto/query-lead.dto';
import { TrialService } from '../trial/trial.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { NurturingService } from '../nurturing/nurturing.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CoursesService } from '../courses/courses.service';
import { ErrorMessages } from '../../common/constants/messages';
import {
  CLOSED_LEAD_STAGES,
  SYSTEM_ACTIVITY_TYPES,
  ENGAGEMENT_SCORE_POINTS,
  RESUBMITTED_ACTIVITY_TYPE,
} from '../../common/constants/lead.constants';
import { bumpLeadScore } from '../../common/utils/lead-score.util';
import { leadActivityInRange, leadInRange } from '../../common/utils/lead-range.util';
import { hasRepeatedDomainLabel } from '../../common/validators/no-repeated-tld.validator';

const LEAD_SORTABLE_FIELDS = new Set(['name', 'stage', 'source', 'score', 'createdAt']);
const MAX_NAME_LENGTH = 100;
const MIN_PHONE_DIGITS = 10; // Indian mobile numbers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A "before" filter sent as a date-only string (e.g. "2026-08-08") means "through the end
// of that day", but new Date() parses it to that day's UTC midnight (its start) — so it
// must be used as an exclusive upper bound (`lt`) at the start of the *next* day, not `lte`
// on the raw parsed instant, or the entire day gets excluded. A string with an explicit time
// component already names a precise instant and is used as-is. Returns an Invalid Date
// unchanged when the input doesn't parse, so callers' existing NaN checks still catch it.
function exclusiveEndOfDay(dateStr: string): Date {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime()) || dateStr.includes('T')) return date;
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trial: TrialService,
    private readonly assignments: AssignmentsService,
    private readonly nurturing: NurturingService,
    private readonly campaigns: CampaignsService,
    private readonly courses: CoursesService,
  ) {}

  private normalizePhone(phone: string | undefined): string {
    return phone?.replace(/\D/g, '') ?? '';
  }

  // Trims and collapses internal whitespace so a stray "John   Doe" or leading/trailing
  // padding doesn't count against the 100-char cap (@MaxLength(100) on the DTOs) or
  // slip through as visually-different duplicate names.
  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private buildScopeFilter(caller: AuthUser): Prisma.LeadWhereInput {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    if (caller.role === Role.SALES_REP) return { ...orgFilter, assignedToId: caller.id };
    if (caller.role === Role.MANAGER) return { ...orgFilter, teamId: caller.teamId ?? undefined };
    return orgFilter; // DIRECTOR sees all leads within their org only
  }

  // `deferNurturing` (bulk CSV import): enroll in nurturing sequences but leave the sends to the
  // periodic tick, which spreads them out, instead of firing them all immediately.
  // `touchOnDuplicate: false` (bulk CSV import): a duplicate row is a rep re-uploading a file, not the
  // person submitting again, so it must not resurface the lead or log a "Submitted again" entry.
  async create(
    dto: CreateLeadDto,
    caller: AuthUser,
    opts: { deferNurturing?: boolean; touchOnDuplicate?: boolean } = {},
  ) {
    await this.trial.checkLimit(caller.orgId, 'leads');

    const normalizedPhone = this.normalizePhone(dto.phone);
    if (normalizedPhone.length < MIN_PHONE_DIGITS) {
      throw new BadRequestException(ErrorMessages.leads.invalidPhone);
    }
    const last10 = normalizedPhone.slice(-10);

    const existing = await this.prisma.lead.findFirst({
      where: {
        isDeleted: false,
        ...(caller.orgId && { orgId: caller.orgId }), // dedup scoped to tenant
        OR: [{ phone: { endsWith: last10 } }, ...(dto.email ? [{ email: dto.email.toLowerCase().trim() }] : [])],
      },
    });
    if (existing) {
      // Same phone or email within the org is always a duplicate — a differently-worded
      // `course` on the new submission must not bypass this (see SCRUM-29: that escape
      // hatch let a second record get created for a lead that already existed). Touch
      // activityAt (not just the auto-bumped updatedAt) so the existing lead resurfaces
      // at the top of the list and in notifications instead of silently vanishing.
      // Routine edits (stage change, reassignment, notes) must NOT trigger this — they
      // bump updatedAt automatically but leave activityAt untouched.
      if (opts.touchOnDuplicate !== false) {
        await this.prisma.lead.update({ where: { id: existing.id }, data: { activityAt: new Date() } });
        // Also written to the timeline, so the resurfacing is explained instead of silent.
        await this.prisma.activity.create({
          data: {
            leadId: existing.id,
            userId: caller.id,
            type: RESUBMITTED_ACTIVITY_TYPE,
            note: `Submitted again via ${dto.source ?? 'manual entry'}`,
            metadata: { source: dto.source ?? null },
          },
        });
      }
      throw new ConflictException({ message: ErrorMessages.leads.duplicate, existingId: existing.id });
    }

    const { campaignId, adSetId, adId } = await this.campaigns.resolveHierarchy(caller.orgId, dto.source, {
      campaign: dto.sourceCampaign,
      adSet: dto.sourceAdSet,
      ad: dto.sourceAd,
    });

    const lead = await this.prisma.lead.create({
      data: {
        name: this.normalizeName(dto.name),
        phone: last10,
        email: dto.email?.toLowerCase().trim(),
        altEmail: dto.altEmail?.toLowerCase().trim(),
        altPhone: dto.altPhone,
        course: dto.course,
        location: dto.location,
        language: dto.language,
        source: dto.source,
        sourceCampaign: dto.sourceCampaign,
        sourceAdSet: dto.sourceAdSet,
        sourceAd: dto.sourceAd,
        campaignId,
        adSetId,
        adId,
        tags: dto.tags ?? [],
        customFields: (dto.customFields ?? null) as Prisma.InputJsonValue,
        ...(dto.rawFields && { rawFields: dto.rawFields as Prisma.InputJsonValue }),
        teamId: caller.teamId ?? undefined,
        orgId: caller.orgId ?? undefined,
      },
    });

    if (lead.course && lead.orgId) {
      await this.courses.ensureCourseFromLead(lead.course, lead.name, lead.orgId).catch((err) => {
        this.logger.error(`Failed to auto-create course for lead ${lead.id}`, err);
      });
    }

    // Welcome email is delivered by the nurturing engine via the org's default
    // `lead_created` sequence (see NurturingService.createDefaultWelcomeSequence).
    // Auto-enroll fires for every active lead_created sequence. Fire-and-forget —
    // a nurturing failure must never block lead creation.
    void this.nurturing.autoEnroll(lead.id, lead.orgId, 'lead_created', undefined, !opts.deferNurturing);

    // Auto-assign via round robin, subject to the org's Routing settings
    // (autoAssign, sourceRouting, working hours/skipWeekends).
    if (lead.orgId) {
      await this.assignments.queueAutomaticAssignment(lead.id, lead.orgId, lead.teamId, lead.source);
    }

    return lead;
  }

  // Called fire-and-forget from AuthService.register() when a prospect signs up on the
  // public site — drops a Lead into GenXCRM's own org (GENXCRM_INTERNAL_ORG_ID) so the
  // sales team can follow up on trial signups from inside the CRM itself, same as any
  // other inbound source. No-ops without the env var (e.g. local dev). Bypasses
  // trial.checkLimit — the internal org is billing-exempt (see BillingService.subscribe).
  // Never throws — a failure here must never affect a real signup.
  async captureWebsiteSignupLead(data: {
    name: string;
    email: string;
    phone?: string;
    orgName: string;
    industry: Industry;
    orgSize: OrgSize;
  }): Promise<void> {
    const orgId = process.env.GENXCRM_INTERNAL_ORG_ID;
    if (!orgId) return;

    try {
      const phone = this.normalizePhone(data.phone);
      const last10 = phone.slice(-10);
      const email = data.email.toLowerCase().trim();

      const lead = await this.prisma.$transaction(async (tx) => {
        const lockKey = `${orgId}:${last10 || email}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

        const existing = await tx.lead.findFirst({
          where: {
            isDeleted: false,
            orgId,
            OR: [...(last10.length >= MIN_PHONE_DIGITS ? [{ phone: { endsWith: last10 } }] : []), { email }],
          },
        });
        if (existing) {
          await tx.lead.update({ where: { id: existing.id }, data: { activityAt: new Date() } });
          await tx.activity.create({
            data: {
              leadId: existing.id,
              type: RESUBMITTED_ACTIVITY_TYPE,
              note: 'Signed up again on the website',
              metadata: { source: LeadSource.WEBSITE },
            },
          });
          return null;
        }

        return tx.lead.create({
          data: {
            name: this.normalizeName(data.name),
            phone: last10,
            email,
            source: LeadSource.WEBSITE,
            customFields: {
              signupOrgName: data.orgName,
              industry: data.industry,
              orgSize: data.orgSize,
            } as Prisma.InputJsonValue,
            orgId,
          },
        });
      });

      if (!lead) return;

      void this.nurturing.autoEnroll(lead.id, lead.orgId, 'lead_created');
      await this.assignments.queueAutomaticAssignment(lead.id, orgId, null, LeadSource.WEBSITE);
    } catch (err) {
      this.logger.error('Failed to capture website signup lead', err instanceof Error ? err.stack : err);
    }
  }

  async importLeads(rows: CreateLeadDto[], caller: AuthUser) {
    let imported = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];
    const warnings: { row: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.name?.trim()) {
        skipped++;
        errors.push({ row: i + 1, reason: 'Missing required field: name' });
        continue;
      }
      if (!row.phone?.trim()) {
        skipped++;
        errors.push({ row: i + 1, reason: 'Missing required field: phone' });
        continue;
      }
      // Email is optional, but the ValidationPipe's @IsEmail() never runs against import
      // rows (see comment below), so a malformed value would otherwise be saved as-is.
      if (row.email?.trim() && (!EMAIL_REGEX.test(row.email.trim()) || hasRepeatedDomainLabel(row.email.trim()))) {
        skipped++;
        errors.push({ row: i + 1, reason: ErrorMessages.leads.invalidEmail });
        continue;
      }
      // altEmail is supplementary, so a malformed value drops just that field
      // (with a warning) instead of skipping the whole row like a bad primary email does.
      if (
        row.altEmail?.trim() &&
        (!EMAIL_REGEX.test(row.altEmail.trim()) || hasRepeatedDomainLabel(row.altEmail.trim()))
      ) {
        warnings.push({ row: i + 1, reason: 'alt email invalid — dropped' });
        row.altEmail = undefined;
      }

      // The ValidationPipe does not run CreateLeadDto's decorators against import
      // rows (the controller's `{ leads: CreateLeadDto[] }` body is an inline
      // literal type, which the pipe can't resolve a metatype for) — so the
      // @MaxLength(100) on the DTO never fires here. Enforce the cap explicitly:
      // truncate (not reject) so the row still imports, and flag it for review.
      const normalizedName = this.normalizeName(row.name);
      if (normalizedName.length > MAX_NAME_LENGTH) {
        row.name = normalizedName.slice(0, MAX_NAME_LENGTH);
        warnings.push({ row: i + 1, reason: `name truncated to ${MAX_NAME_LENGTH} characters` });
      }

      // create() stores only the last 10 digits, but that truncation happens silently —
      // flag it here so an import row with a mistyped/extra-digit phone number is visible
      // in the import summary instead of just quietly saving a different number than the sheet had.
      const normalizedPhone = this.normalizePhone(row.phone);
      if (normalizedPhone.length > MIN_PHONE_DIGITS) {
        warnings.push({ row: i + 1, reason: 'phone number truncated to last 10 digits' });
      }

      try {
        await this.create(row, caller, { deferNurturing: true, touchOnDuplicate: false });
        imported++;
      } catch (err) {
        skipped++;
        if (err instanceof ForbiddenException) {
          const res = err.getResponse() as Record<string, unknown>;
          const msg = (res['message'] as string | undefined) ?? err.message;
          errors.push({ row: i + 1, reason: msg });
          // Abort — all remaining rows will hit the same limit
          for (let j = i + 1; j < rows.length; j++) {
            errors.push({ row: j + 1, reason: msg });
          }
          skipped += rows.length - i - 1;
          break;
        }
        errors.push({
          row: i + 1,
          reason:
            err instanceof ConflictException ? ErrorMessages.leads.duplicate : ((err as Error).message ?? String(err)),
        });
      }
    }

    return { total: rows.length, imported, skipped, errors, warnings };
  }

  // Shared by findAll() and archiveAllMatching() so "delete all matching filter"
  // archives exactly the set the filtered list shows. Org + role scoping included.
  private buildListWhere(query: QueryLeadDto, caller: AuthUser): Prisma.LeadWhereInput {
    const {
      stage,
      source,
      assignedToId,
      stages,
      customStageIds,
      sources,
      assignedToIds,
      cities,
      courses,
      scoreMin,
      scoreMax,
      hotOnly,
      unassigned,
      notEngaged,
      untouched,
      followupOverdue,
      leaking,
      idle,
      commsAfter,
      commsBefore,
      pendingFollowup,
      teamId,
      teamIds,
      search,
      course,
      createdAfter,
      createdBefore,
      dateField,
    } = query;

    const createdAfterDate = createdAfter ? new Date(createdAfter) : undefined;
    const isValidCreatedAfter = createdAfterDate && !Number.isNaN(createdAfterDate.getTime());
    // "Before" filters are date-only strings (e.g. "2026-08-08") meaning "through the end
    // of that day" — new Date() parses them to that day's UTC midnight (its start), so the
    // exclusive upper bound must be the start of the *next* day, not that instant itself.
    // See reports.service.ts resolveDateRange() for the same fix applied to the daily report.
    const createdBeforeDate = createdBefore ? exclusiveEndOfDay(createdBefore) : undefined;
    const isValidCreatedBefore = createdBeforeDate && !Number.isNaN(createdBeforeDate.getTime());

    const commsAfterDate = commsAfter ? new Date(commsAfter) : undefined;
    const isValidCommsAfter = commsAfterDate && !Number.isNaN(commsAfterDate.getTime());
    const commsBeforeDate = commsBefore ? exclusiveEndOfDay(commsBefore) : undefined;
    const isValidCommsBefore = commsBeforeDate && !Number.isNaN(commsBeforeDate.getTime());

    const stageFilter = stages?.length ? { in: stages } : stage;
    const sourceFilter = sources?.length ? { in: sources } : source;
    const assignedToFilter =
      caller.role !== Role.SALES_REP ? (assignedToIds?.length ? { in: assignedToIds } : assignedToId) : undefined;
    // Team filter only makes sense for DIRECTOR — MANAGER/SALES_REP are already scoped
    // to their own team/leads by buildScopeFilter() above.
    const teamFilter = caller.role === Role.DIRECTOR ? (teamIds?.length ? { in: teamIds } : teamId) : undefined;

    const where: Prisma.LeadWhereInput = {
      isDeleted: false,
      ...this.buildScopeFilter(caller),
      ...(stageFilter && { stage: stageFilter }),
      ...(customStageIds?.length && { customStageId: { in: customStageIds } }),
      ...(sourceFilter && { source: sourceFilter }),
      ...(courses?.length
        ? { course: { in: courses } }
        : course && { course: { contains: course, mode: 'insensitive' } }),
      ...(cities?.length && { location: { in: cities } }),
      ...(assignedToFilter && { assignedToId: assignedToFilter }),
      ...(unassigned && caller.role !== Role.SALES_REP && { assignedToId: null }),
      ...(teamFilter && { teamId: teamFilter }),
      ...((scoreMin !== undefined || scoreMax !== undefined) && {
        score: {
          ...(scoreMin !== undefined && { gte: scoreMin }),
          ...(scoreMax !== undefined && { lte: scoreMax }),
        },
      }),
    };

    // Two independent OR-groups (search, hotOnly) must combine with AND, not
    // overwrite each other via a single top-level `where.OR` assignment.
    const andGroups: Prisma.LeadWhereInput[] = [];
    // By default a lead is in the date range if it was created in it OR a team member did real
    // work on it in it (a stage change, note, call or message they sent — never assignment,
    // resubmission or system writes; see lead-range.util.ts, the rule every report count
    // uses). `dateField` narrows it to just one of the two.
    if (isValidCreatedAfter || isValidCreatedBefore) {
      const dateFilter = {
        ...(isValidCreatedAfter && { gte: createdAfterDate }),
        ...(isValidCreatedBefore && { lt: createdBeforeDate }),
      };
      if (dateField === 'created') andGroups.push({ createdAt: dateFilter });
      else if (dateField === 'updated') andGroups.push(leadActivityInRange(dateFilter));
      else andGroups.push(leadInRange(dateFilter));
    }
    if (search) {
      andGroups.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (hotOnly) {
      andGroups.push({ OR: [{ score: { gte: 85 } }, { tags: { has: 'hot-lead' } }] });
    }
    // Quick filters mirroring the Reports > Sales Rep Productivity metrics — pushed
    // as their own AND-group entries so they never collide with the scoreMin/scoreMax
    // or stage filters above, which write to the same `where.score`/`where.stage` keys.
    if (notEngaged) andGroups.push({ score: { lt: 10 } });
    // Excludes system-written activity types (ASSIGNED, REASSIGN, ASSIGNMENT_FAILED) so
    // the auto-assignment activity every lead gets the instant it's routed to a rep
    // doesn't make it count as "touched" — see reports.service.ts productivity().
    if (untouched) andGroups.push({ activities: { none: { type: { notIn: SYSTEM_ACTIVITY_TYPES } } } });
    if (followupOverdue) andGroups.push({ stage: { notIn: CLOSED_LEAD_STAGES } });
    // Union of untouched + followupOverdue — mirrors reports.service.ts productivity() `leaking`.
    if (leaking) {
      // Only leads owned by an active sales rep — productivity() counts per active rep, so a
      // lead assigned to a manager/director or a deactivated user would otherwise make the
      // list larger than the "Leads leaking" card it was opened from.
      andGroups.push({
        assignedTo: { is: { role: Role.SALES_REP, isActive: true } },
        OR: [
          { activities: { none: { type: { notIn: SYSTEM_ACTIVITY_TYPES } } } },
          { stage: { notIn: CLOSED_LEAD_STAGES } },
        ],
      });
    }
    // Saved view "Idle 24h+" — no genuine (non-system) logged activity within the last 24 hours.
    if (idle) {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      andGroups.push({
        activities: { none: { createdAt: { gte: since24h }, type: { notIn: SYSTEM_ACTIVITY_TYPES } } },
      });
    }
    // Quick filters mirroring the Reports > Daily Report KPI cards — see
    // reports.service.ts dailySummary() for the source-of-truth definitions.
    if (isValidCommsAfter || isValidCommsBefore) {
      andGroups.push({
        communications: {
          some: {
            sentAt: {
              ...(isValidCommsAfter && { gte: commsAfterDate }),
              ...(isValidCommsBefore && { lt: commsBeforeDate }),
            },
          },
        },
      });
    }
    if (pendingFollowup) {
      andGroups.push({
        stage: LeadStage.NEW,
        assignedToId: { not: null },
        communications: { none: {} },
      });
    }
    if (andGroups.length) where.AND = andGroups;

    return where;
  }

  // Original form answers (Lead.rawFields) are only for the backfill job — they hold the same
  // PII as the lead's own columns, so they are never serialized to clients.
  #withoutRawFields<T extends { rawFields?: unknown }>(lead: T): Omit<T, 'rawFields'> {
    const { rawFields, ...rest } = lead;
    void rawFields;
    return rest;
  }

  #buildOrderBy(sortBy: string | undefined, dir: 'asc' | 'desc'): Prisma.LeadOrderByWithRelationInput {
    if (sortBy === 'owner') return { assignedTo: { name: dir } };
    if (sortBy && LEAD_SORTABLE_FIELDS.has(sortBy)) return { [sortBy]: dir };
    return { createdAt: dir };
  }

  async findAll(query: QueryLeadDto, caller: AuthUser) {
    const { sortBy, sortOrder } = query;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = this.buildListWhere(query, caller);

    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.#buildOrderBy(sortBy, sortOrder ?? 'desc'),
        include: {
          assignedTo: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          customStage: { select: { id: true, label: true, color: true } },
          _count: { select: { activities: true, communications: true } },
        },
      }),
    ]);

    return { data: leads.map((l) => this.#withoutRawFields(l)), total, page, limit, pages: Math.ceil(total / limit) };
  }

  // Powers the header notification badge: leads created OR resubmitted (activityAt
  // bumped by a duplicate resubmission — see create()/ingestLead()) since `since`
  // within the caller's scope. `count` is the true total; `leads` is capped for the
  // toast feed. Deliberately keyed on activityAt, not the auto-bumped `updatedAt` —
  // routine edits (stage change, reassignment, notes) must not resurface a lead here.
  async getRecent(since: string | undefined, caller: AuthUser) {
    const sinceDate = since ? new Date(since) : new Date();
    const after = Number.isNaN(sinceDate.getTime()) ? new Date() : sinceDate;

    const where: Prisma.LeadWhereInput = {
      isDeleted: false,
      ...this.buildScopeFilter(caller),
      activityAt: { gt: after },
    };

    const [count, leads] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        take: 20,
        orderBy: { activityAt: 'desc' },
        select: {
          id: true,
          name: true,
          source: true,
          createdAt: true,
          activityAt: true,
          assignedTo: { select: { id: true, name: true } },
        },
      }),
    ]);

    // API contract keeps the field name `updatedAt` (existing frontend consumers key
    // toast dedup/unread checks on it) — its value now comes from activityAt.
    return {
      count,
      leads: leads.map(({ activityAt, ...lead }) => ({ ...lead, updatedAt: activityAt })),
    };
  }

  async findOne(id: string, caller: AuthUser) {
    // Not scoped by the `take: 20` cap on the `communications` include below — a WhatsApp
    // send can fall off that window on a chatty lead. Meta only allows a free-form
    // (non-template) WhatsApp send within 24h of the lead's *last inbound* message —
    // sending them a template does NOT open this window, only the customer replying does
    // (this was the actual bug behind SCRUM-50: the previous heuristic counted our own
    // outbound sends, which let free-form be attempted — and fail with Meta's 131047
    // "re-engagement message" error — even when the customer had never actually replied).
    const whatsappWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [lead, whatsappInboundReplyCount] = await Promise.all([
      this.prisma.lead.findFirst({
        where: { id, isDeleted: false, ...(caller.orgId && { orgId: caller.orgId }) },
        include: {
          assignedTo: { select: { id: true, name: true, role: true } },
          customStage: { select: { id: true, label: true, color: true } },
          team: { select: { id: true, name: true, manager: { select: { id: true, name: true } } } },
          campaign: { select: { name: true } },
          adSet: { select: { name: true } },
          ad: { select: { name: true } },
          activities: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { user: { select: { name: true } } },
          },
          communications: { orderBy: { sentAt: 'desc' }, take: 20 },
          payments: { include: { installments: true } },
          // Never select s3Key here — it's a raw storage identifier. Playback URLs are minted
          // on demand via CommunicationsService.getRecordingPlaybackUrl (short-lived, signed).
          callRecordings: {
            where: { status: 'UPLOADED' },
            orderBy: { recordedAt: 'desc' },
            select: { id: true, durationSec: true, recordedAt: true, mimeType: true },
          },
          enrollments: {
            where: { status: 'active' },
            take: 1,
            include: { sequence: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
          },
        },
      }),
      // Inbound WhatsApp messages are created by handleInboundMessage (whatsapp-webhook.service.ts)
      // with direction: 'inbound' — this is the only thing that actually opens Meta's 24h window.
      this.prisma.communication.count({
        where: {
          leadId: id,
          type: CommType.WHATSAPP,
          direction: 'inbound',
          sentAt: { gte: whatsappWindowStart },
        },
      }),
    ]);

    if (!lead) throw new NotFoundException(ErrorMessages.leads.notFound);

    if (caller.role === Role.SALES_REP && lead.assignedToId !== caller.id) {
      throw new NotFoundException(ErrorMessages.leads.notFound);
    }
    if (caller.role === Role.MANAGER && lead.teamId !== caller.teamId) {
      throw new NotFoundException(ErrorMessages.leads.notFound);
    }

    // Director→Manager→Owner chain for the Lead Detail hierarchy card. There's no
    // explicit Director-per-team/org link in the schema, so this picks *a* director
    // in the org (deterministically, oldest first) rather than *the* director tied
    // to this specific lead — acceptable since the product model assumes ~one
    // Director per org; orgs with multiple Directors will see an arbitrary one.
    const director = caller.orgId
      ? await this.prisma.user.findFirst({
          where: { orgId: caller.orgId, role: Role.DIRECTOR },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        })
      : null;

    return {
      ...this.#withoutRawFields(lead),
      whatsappConversationOpen: whatsappInboundReplyCount > 0,
      assignmentChain: {
        owner: lead.assignedTo,
        manager: lead.team?.manager ?? null,
        director,
      },
    };
  }

  // Open follow-ups for the dashboard: scheduled leads still being worked, through the next 7 days
  // (everything overdue included). Org + role scoped like the leads list. The client buckets
  // them into overdue / today / upcoming using the viewer's own calendar day.
  async findFollowUps(caller: AuthUser) {
    const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const data = await this.prisma.lead.findMany({
      where: {
        ...this.buildScopeFilter(caller),
        isDeleted: false,
        stage: { notIn: [LeadStage.ENROLLED, LeadStage.NOT_INTERESTED] },
        followUpAt: { not: null, lte: horizon },
      },
      orderBy: { followUpAt: 'asc' },
      take: 200,
      select: {
        id: true,
        name: true,
        stage: true,
        followUpAt: true,
        followUpNote: true,
        assignedTo: { select: { name: true } },
      },
    });
    return { data };
  }

  // The timeline entry for an update. Follow-up changes get their own types so they read clearly
  // and are not counted as stage changes (which feed the reports' call estimate).
  private async describeUpdate(
    dto: UpdateLeadDto,
    current: { assignedTo?: { name: string } | null },
    caller: AuthUser,
    stageLabel?: string,
  ): Promise<{ type: string; note: string }> {
    if (dto.assignedToId === null) {
      return { type: 'REASSIGN', note: `Unassigned from ${current.assignedTo?.name ?? 'previous owner'}` };
    }
    if (stageLabel) return { type: 'STAGE_CHANGE', note: `Stage changed to ${stageLabel}` };
    if (dto.followUpAt === null) return { type: 'FOLLOW_UP_DONE', note: 'Follow-up marked done' };
    if (dto.followUpAt) {
      const org = caller.orgId
        ? await this.prisma.organization.findUnique({ where: { id: caller.orgId }, select: { timezone: true } })
        : null;
      let when = dto.followUpAt;
      try {
        when = new Date(dto.followUpAt).toLocaleString('en-IN', {
          timeZone: org?.timezone ?? 'Asia/Kolkata',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch {
        // keep the ISO string
      }
      return {
        type: 'FOLLOW_UP_SCHEDULED',
        note: `Follow-up scheduled for ${when}${dto.followUpNote ? `: ${dto.followUpNote}` : ''}`,
      };
    }
    return { type: 'STAGE_CHANGE', note: 'Lead updated' };
  }

  async update(id: string, dto: UpdateLeadDto, caller: AuthUser) {
    const current = await this.findOne(id, caller);

    // Count each fresh transition into INTERESTED (not repeated saves while
    // already INTERESTED), mirroring the NOT_INTERESTED side-effect below.
    const custom = dto.customStageId
      ? await this.prisma.stageConfig.findFirst({
          where: { id: dto.customStageId, orgId: caller.orgId ?? undefined, baseStage: null },
        })
      : null;
    if (dto.customStageId && !custom) throw new NotFoundException('Stage not found');
    // Custom stages roll up to a built-in stage (countsAs); all stage side-effects use it.
    const effectiveStage = custom?.countsAs ?? dto.stage;
    const becameInterested = effectiveStage === LeadStage.INTERESTED && current.stage !== LeadStage.INTERESTED;

    const data: Prisma.LeadUpdateInput = {
      ...(dto.name !== undefined && { name: this.normalizeName(dto.name) }),
      ...(dto.phone !== undefined && { phone: this.normalizePhone(dto.phone) }),
      ...(dto.email !== undefined && { email: dto.email.toLowerCase().trim() }),
      ...(dto.altEmail !== undefined && { altEmail: dto.altEmail.toLowerCase().trim() }),
      ...(dto.course !== undefined && { course: dto.course }),
      ...(dto.location !== undefined && { location: dto.location }),
      ...(effectiveStage !== undefined && { stage: effectiveStage }),
      ...(custom
        ? { customStage: { connect: { id: custom.id } } }
        : dto.stage !== undefined && { customStage: { disconnect: true } }),
      ...(dto.score !== undefined && { score: dto.score }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
      ...(dto.notInterestedReason !== undefined && { notInterestedReason: dto.notInterestedReason }),
      ...(dto.customFields !== undefined && { customFields: dto.customFields as Prisma.InputJsonValue }),
      ...(dto.assignedToId === null && { assignedToId: null }),
      ...(dto.followUpAt !== undefined && { followUpAt: dto.followUpAt === null ? null : new Date(dto.followUpAt) }),
      // Clearing the date (follow-up done) also clears its note.
      ...(dto.followUpAt === null && { followUpNote: null }),
      ...(dto.followUpNote !== undefined && dto.followUpAt !== null && { followUpNote: dto.followUpNote }),
      ...(effectiveStage === LeadStage.NOT_INTERESTED && { notInterestedAt: new Date() }),
      ...(becameInterested && { interestedCount: { increment: 1 } }),
    };

    const { type: activityType, note: activityNote } = await this.describeUpdate(
      dto,
      current,
      caller,
      custom?.label ?? dto.stage,
    );

    const [lead] = await Promise.all([
      this.prisma.lead.update({ where: { id }, data }),
      this.prisma.activity.create({
        data: {
          leadId: id,
          userId: caller.id,
          type: activityType,
          note: activityNote,
          metadata: dto as Prisma.InputJsonValue,
        },
      }),
    ]);

    // Auto-enroll into any active `stage_change`-triggered sequences. Fire-and-forget.
    if (effectiveStage !== undefined) {
      void this.nurturing.autoEnroll(lead.id, lead.orgId, 'stage_change', lead.stage);
    }
    // A caller-driven stage move is a rep actively working the lead — count it as
    // engagement, same as a call/note/message (see ENGAGEMENT_SCORE_POINTS).
    if (effectiveStage !== undefined && (effectiveStage !== current.stage || custom)) {
      void bumpLeadScore(this.prisma, id, ENGAGEMENT_SCORE_POINTS.STAGE_CHANGE);
    }

    return lead;
  }

  async softDelete(id: string, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.lead.update({ where: { id }, data: { isDeleted: true } });
  }

  // Bulk archive (soft-delete) the given leads. Scoped to the caller's org + role so a
  // MANAGER can only archive their own team's leads. Returns how many were archived.
  async archiveMany(leadIds: string[], caller: AuthUser) {
    if (!leadIds.length) return { archived: 0 };

    const res = await this.prisma.lead.updateMany({
      where: { id: { in: leadIds }, isDeleted: false, ...this.buildScopeFilter(caller) },
      data: { isDeleted: true },
    });
    return { archived: res.count };
  }

  // Archive every lead matching the active list filters (across all pages), using the
  // exact same where clause as findAll. Org + role scoped. Returns how many were archived.
  async archiveAllMatching(query: QueryLeadDto, caller: AuthUser) {
    const where = this.buildListWhere(query, caller);
    const res = await this.prisma.lead.updateMany({ where, data: { isDeleted: true } });
    return { archived: res.count };
  }

  async addNote(leadId: string, note: string, caller: AuthUser, type = 'NOTE') {
    await this.findOne(leadId, caller);
    const activity = await this.prisma.activity.create({
      data: { leadId, userId: caller.id, type, note },
    });
    void bumpLeadScore(this.prisma, leadId, ENGAGEMENT_SCORE_POINTS.NOTE);
    return activity;
  }

  async reassign(leadId: string, userId: string, caller: AuthUser) {
    const [lead, newAssignee] = await Promise.all([
      this.findOne(leadId, caller),
      this.prisma.user.findFirst({
        where: { id: userId, ...(caller.orgId && { orgId: caller.orgId }) },
        select: { name: true },
      }),
    ]);

    const [updated] = await Promise.all([
      this.prisma.lead.update({ where: { id: leadId }, data: { assignedToId: userId } }),
      this.prisma.activity.create({
        data: {
          leadId,
          userId: caller.id,
          type: 'REASSIGN',
          note: `Reassigned from ${lead.assignedTo?.name ?? 'unassigned'} to ${newAssignee?.name ?? 'unknown user'}`,
        },
      }),
    ]);

    return updated;
  }

  // Powers the stage chip row above the leads list — counts must reflect every
  // OTHER active filter (city, owner, search, etc.) so a chip shows how many
  // leads in that stage match the rest of the applied filters. The stage/stages
  // fields themselves are stripped since these chips are the stage picker.
  async getStageStats(caller: AuthUser, query: QueryLeadDto = {}) {
    const where = this.buildListWhere(
      { ...query, stage: undefined, stages: undefined, customStageIds: undefined },
      caller,
    );

    return this.prisma.lead.groupBy({ by: ['stage'], where, _count: { stage: true } });
  }

  async getSourceStats(caller: AuthUser) {
    const where: Prisma.LeadWhereInput = {
      isDeleted: false,
      ...this.buildScopeFilter(caller),
    };

    return this.prisma.lead.groupBy({ by: ['source'], where, _count: { source: true } });
  }

  // Powers the Filters drawer — distinct values + counts, scoped identically to
  // findAll (org + role), so a Rep only ever sees facets within their own leads.
  async getFacets(caller: AuthUser) {
    const where: Prisma.LeadWhereInput = {
      isDeleted: false,
      ...this.buildScopeFilter(caller),
    };

    const [stageCounts, sourceCounts, courses, cities, customCounts] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['stage'], where, _count: { stage: true } }),
      this.prisma.lead.groupBy({ by: ['source'], where, _count: { source: true } }),
      this.prisma.lead.findMany({
        where: { ...where, course: { not: null } },
        select: { course: true },
        distinct: ['course'],
      }),
      this.prisma.lead.findMany({
        where: { ...where, location: { not: null } },
        select: { location: true },
        distinct: ['location'],
      }),
      this.prisma.lead.groupBy({
        by: ['customStageId'],
        where: { ...where, customStageId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      stages: stageCounts.map((s) => ({ value: s.stage, count: s._count.stage })),
      customStages: customCounts.flatMap((c) =>
        c.customStageId ? [{ id: c.customStageId, count: c._count._all }] : [],
      ),
      sources: sourceCounts.map((s) => ({ value: s.source, count: s._count.source })),
      courses: courses.map((c) => c.course).filter((c): c is string => !!c),
      cities: cities.map((c) => c.location).filter((c): c is string => !!c),
    };
  }

  // Feeds the Android dialer's on-device number → lead matcher (see native LeadMatcher).
  // Scoped identically to findAll (org + role), so a rep's device only ever learns their
  // own leads' numbers, and a soft-deleted or erased (null phone) lead is never included.
  async getPhoneIndex(caller: AuthUser) {
    const leads = await this.prisma.lead.findMany({
      where: { isDeleted: false, ...this.buildScopeFilter(caller) },
      select: { id: true, name: true, phone: true, altPhone: true },
    });
    return leads.flatMap(({ id, name, phone, altPhone }) =>
      [phone, altPhone]
        .filter((number): number is string => Boolean(number))
        .map((number) => ({ leadId: id, name, phone: number })),
    );
  }
}
