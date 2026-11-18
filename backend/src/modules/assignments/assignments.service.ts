import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma, Role, LeadSource } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { buildLeadScopeFilter } from '../../common/utils/scope.util';
import { ErrorMessages } from '../../common/constants/messages';
import { mergeRoutingSettings, type RoutingSettings } from '../../common/constants/org-defaults';
import { computeAssignmentDelayMs } from '../../common/utils/working-hours.util';

// Maps a lead's source to the matching Administration > Routing "per-source
// team" key. Sources with no configured routing key fall through to normal
// team/org round robin.
const SOURCE_ROUTING_KEY: Partial<Record<LeadSource, keyof RoutingSettings['sourceRouting']>> = {
  [LeadSource.FACEBOOK]: 'facebookInstagram',
  [LeadSource.INSTAGRAM]: 'facebookInstagram',
  [LeadSource.GOOGLE_ADS]: 'googleAds',
  [LeadSource.WEBSITE]: 'website',
  [LeadSource.REFERRAL]: 'referral',
  [LeadSource.WALK_IN]: 'walkIn',
};

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('assignment') private assignmentQueue: Queue,
  ) {}

  async queueForAssignment(leadId: string, teamId: string) {
    await this.assignmentQueue.add(
      'assign',
      { leadId, teamId },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  /** Enqueue an org-wide round-robin (used for imports/creates with no team). */
  async queueForAssignmentOrg(leadId: string, orgId: string) {
    await this.assignmentQueue.add(
      'assign',
      { leadId, orgId },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  /**
   * Automatic, ingestion-time assignment — the only caller of this is
   * LeadsService on lead creation/import. Applies the org's Routing settings:
   * `autoAssign` (skip entirely, leaving the lead unassigned), `sourceRouting`
   * (route to a configured team based on the lead's source), and
   * `skipWeekends`/working hours (delay the queued job rather than dropping it).
   * Manual, caller-directed assignment (bulkAssign, assignOne, distribute*) is
   * intentionally NOT routed through here — those go straight to
   * queueForAssignment/queueForAssignmentOrg, unaffected by these settings,
   * since a director/manager explicitly choosing to assign now should always work.
   */
  async queueAutomaticAssignment(
    leadId: string,
    orgId: string,
    teamId: string | null,
    source: LeadSource,
  ): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { routingSettings: true, timezone: true },
    });
    const routing = mergeRoutingSettings(org?.routingSettings);
    if (!routing.autoAssign) return;

    let targetTeamId = teamId;
    const sourceKey = SOURCE_ROUTING_KEY[source];
    const configuredTeamId = sourceKey ? routing.sourceRouting[sourceKey] : '';
    if (configuredTeamId) {
      const team = await this.prisma.team.findFirst({ where: { id: configuredTeamId, orgId }, select: { id: true } });
      if (team) targetTeamId = team.id;
    }

    const delay = computeAssignmentDelayMs(new Date(), org?.timezone ?? 'UTC', routing);
    const jobData = targetTeamId ? { leadId, teamId: targetTeamId } : { leadId, orgId };
    await this.assignmentQueue.add('assign', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      delay,
    });
  }

  async assignRoundRobin(leadId: string, teamId: string): Promise<void> {
    if (!(await this.isAssignable(leadId))) return;

    // Whoever's turn is oldest (or never had one) goes first.
    const reps = await this.prisma.user.findMany({
      where: { teamId, isActive: true, role: Role.SALES_REP },
      orderBy: [{ lastAssignedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      select: { id: true, name: true, teamId: true },
    });

    if (!reps.length) {
      this.logger.warn(`No active reps for team ${teamId}`);
      return;
    }

    await this.assignToNextInRotation(leadId, reps[0]);
  }

  /** Round-robin across every active rep in the org — used when a lead has no team. */
  async assignRoundRobinOrg(leadId: string, orgId: string): Promise<void> {
    if (!(await this.isAssignable(leadId))) return;

    const reps = await this.prisma.user.findMany({
      where: { orgId, isActive: true, role: Role.SALES_REP },
      orderBy: [{ lastAssignedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      select: { id: true, name: true, teamId: true },
    });

    if (!reps.length) {
      this.logger.warn(`No active reps for org ${orgId}`);
      return;
    }

    await this.assignToNextInRotation(leadId, reps[0]);
  }

  /** Idempotency gate: only a present, non-deleted, unassigned lead may be assigned. */
  private async isAssignable(leadId: string): Promise<boolean> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.isDeleted) {
      this.logger.warn(`Lead ${leadId} not found or deleted, skipping assignment`);
      return false;
    }
    if (lead.assignedToId) {
      this.logger.log(`Lead ${leadId} already assigned to ${lead.assignedToId}, skipping`);
      return false;
    }
    return true;
  }

  /**
   * Shared assignment core: give `leadId` to `chosen`, the rep whose turn is next
   * (oldest `lastAssignedAt`, ties broken by id). Pure turn-taking — every active rep
   * gets an equal share of incoming leads in strict rotation, regardless of how many
   * open leads they're currently sitting on.
   */
  private async assignToNextInRotation(
    leadId: string,
    chosen: { id: string; name: string; teamId: string | null },
  ): Promise<void> {
    // For org-wide assignment the lead has no team yet — inherit the chosen rep's team so the
    // rep's manager (who sees leads by teamId) can see it. Never overwrite an existing team.
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { teamId: true } });
    const teamUpdate = !lead?.teamId && chosen.teamId ? { teamId: chosen.teamId } : {};

    await Promise.all([
      this.prisma.lead.update({ where: { id: leadId }, data: { assignedToId: chosen.id, ...teamUpdate } }),
      this.prisma.user.update({ where: { id: chosen.id }, data: { lastAssignedAt: new Date() } }),
      this.prisma.activity.create({
        data: { leadId, userId: chosen.id, type: 'ASSIGNED', note: `Auto-assigned (round robin) to ${chosen.name}` },
      }),
    ]);

    this.logger.log(`Lead ${leadId} assigned to ${chosen.name} (${chosen.id})`);

    await this.scheduleAssignmentNotice(chosen.id, leadId);
  }

  /**
   * Debounced per-rep assignment notification. Each assignment appends the leadId to a
   * Redis list and schedules a single delayed 'notify' job keyed by `notify-{repId}`.
   * Bull ignores an add for a jobId already in the queue, so a burst of assignments to the
   * same rep (bulk import, distribute-all) collapses to ONE pending job while every leadId
   * accumulates in the list — the rep gets one summary email instead of one per lead.
   * Reuses the Bull queue's existing Redis connection. Never throws: a notification failure
   * must not break the assignment that already committed.
   */
  private async scheduleAssignmentNotice(repId: string, leadId: string): Promise<void> {
    try {
      await this.assignmentQueue.client.rpush(`assign-notify:${repId}`, leadId);
      const parsed = Number(process.env.ASSIGNMENT_NOTIFY_DELAY_MS);
      const delay = Number.isFinite(parsed) && parsed > 0 ? parsed : 45000;
      await this.assignmentQueue.add(
        'notify',
        { repId },
        { jobId: `notify-${repId}`, delay, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule assignment notice for rep ${repId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // A MANAGER may only target their own team; a DIRECTOR any team in their org.
  // Throws NotFoundException if the team doesn't exist / isn't in the caller's org
  // (never leaks whether a team id exists in another org), ForbiddenException if
  // it exists but is outside the MANAGER's own team.
  private async assertTeamInScope(teamId: string, caller: AuthUser): Promise<void> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, ...(caller.orgId ? { orgId: caller.orgId } : {}) },
      select: { id: true },
    });
    if (!team) throw new NotFoundException(ErrorMessages.users.teamNotFound);
    if (caller.role === Role.MANAGER && teamId !== caller.teamId) {
      throw new ForbiddenException(ErrorMessages.users.managerOwnTeamOnly);
    }
  }

  async bulkAssign(leadIds: string[], teamId: string, caller: AuthUser) {
    if (!leadIds.length) return { queued: 0 };
    await this.assertTeamInScope(teamId, caller);

    const leads = await this.prisma.lead.findMany({
      where: { id: { in: leadIds }, ...buildLeadScopeFilter(caller) },
      select: { id: true },
    });
    for (const lead of leads) {
      await this.queueForAssignment(lead.id, teamId);
    }
    return { queued: leads.length };
  }

  async assignOne(leadId: string, teamId: string, caller: AuthUser) {
    await this.assertTeamInScope(teamId, caller);

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.leads.notFound);

    await this.queueForAssignment(leadId, teamId);
    return { queued: 1 };
  }

  /**
   * Distribute the given (unassigned) leads via round robin, each within its own team.
   * Scoped to the caller's org and role: a MANAGER only distributes their own team's leads;
   * a DIRECTOR distributes across any team in the org. Leads that are already assigned or
   * have no team are skipped — `queued` reflects how many were actually enqueued.
   */
  async distributeRoundRobin(leadIds: string[], caller: AuthUser) {
    if (!leadIds.length) return { queued: 0 };

    const where: Prisma.LeadWhereInput = {
      id: { in: leadIds },
      isDeleted: false,
      assignedToId: null,
      teamId: { not: null },
      ...(caller.orgId ? { orgId: caller.orgId } : {}),
      ...(caller.role === Role.MANAGER ? { teamId: caller.teamId ?? undefined } : {}),
    };

    const leads = await this.prisma.lead.findMany({ where, select: { id: true, teamId: true } });
    await Promise.all(leads.map((lead) => this.queueForAssignment(lead.id, lead.teamId!)));
    return { queued: leads.length };
  }

  /**
   * One-click round robin: distribute every unassigned lead in the caller's scope.
   * Scoped to the caller's org and role (a MANAGER only distributes their own team's
   * leads; a DIRECTOR distributes across the org). Teamed leads are balanced within
   * their team; leads without a team are balanced org-wide. Already-assigned leads are
   * never touched — `queued` reflects how many were enqueued. `reps` is the number of
   * active sales reps in scope; when it's 0 nothing is queued (there is no one to
   * assign to) and the caller can tell the user.
   */
  async distributeAllUnassigned(caller: AuthUser) {
    // No point queuing anything if there are no reps to round-robin across.
    const reps = await this.prisma.user.count({
      where: {
        role: Role.SALES_REP,
        isActive: true,
        ...(caller.orgId ? { orgId: caller.orgId } : {}),
        ...(caller.role === Role.MANAGER ? { teamId: caller.teamId ?? undefined } : {}),
      },
    });
    if (reps === 0) return { queued: 0, reps: 0 };

    const where: Prisma.LeadWhereInput = {
      isDeleted: false,
      assignedToId: null,
      ...(caller.orgId ? { orgId: caller.orgId } : {}),
      ...(caller.role === Role.MANAGER ? { teamId: caller.teamId ?? undefined } : {}),
    };

    const leads = await this.prisma.lead.findMany({
      where,
      select: { id: true, teamId: true, orgId: true },
    });

    await Promise.all(
      leads.map((lead) =>
        lead.teamId
          ? this.queueForAssignment(lead.id, lead.teamId)
          : lead.orgId
            ? this.queueForAssignmentOrg(lead.id, lead.orgId)
            : Promise.resolve(),
      ),
    );

    return { queued: leads.filter((lead) => lead.teamId || lead.orgId).length, reps };
  }
}
