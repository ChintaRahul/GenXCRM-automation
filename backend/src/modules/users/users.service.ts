import { Injectable, Logger, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionTokenService } from '../../auth/session-token.service';
import { Role, TeamType, VerificationTokenType, LeadStage } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import * as bcrypt from 'bcrypt';
import { TrialService } from '../trial/trial.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';
import { generateRawToken, hashToken } from '../../common/crypto.utils';
import { teamInviteTemplate } from '../mail/mail.templates';
import { ErrorMessages } from '../../common/constants/messages';
import { MfaService } from '../../auth/mfa.service';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
// Invite set-password links live longer than ordinary resets — the member may
// not check email immediately. Defaults to 72 hours.
const INVITE_TOKEN_TTL_HOURS = Number(process.env.INVITE_TOKEN_TTL_HOURS ?? 72);

// "Open" = not yet at a terminal outcome. Used for the Owner filter's per-rep
// workload chip (GET /users?include=openLeads).
const TERMINAL_LEAD_STAGES: LeadStage[] = [
  LeadStage.ENROLLED,
  LeadStage.NOT_INTERESTED,
  LeadStage.DROPPED,
  LeadStage.CLOSED_WON,
  LeadStage.CLOSED_LOST,
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trial: TrialService,
    private readonly mail: MailService,
    private readonly billing: BillingService,
    private readonly sessionToken: SessionTokenService,
    private readonly mfa: MfaService,
  ) {}

  // Keep the billed seat count in step with the number of active members.
  // Seats are charged per active user (OrgSubscription.userCount → Razorpay
  // quantity), so this is called whenever a member is added or removed.
  // Trial orgs have no active subscription: updateSeats throws
  // ForbiddenException there, which we swallow — seat sync must never block
  // user management.
  private async syncSeats(caller: AuthUser): Promise<void> {
    if (!caller.orgId) return;
    try {
      const count = await this.prisma.user.count({
        where: { orgId: caller.orgId, isActive: true },
      });
      await this.billing.updateSeats(count, caller);
    } catch (err) {
      this.logger.warn(
        `Seat sync skipped for org ${caller.orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async create(dto: CreateUserDto, caller: AuthUser) {
    await this.trial.checkLimit(caller.orgId, 'users');

    // Managers may only create Sales Reps assigned to their own team
    if (caller.role === Role.MANAGER) {
      if (dto.role !== Role.SALES_REP) {
        throw new ForbiddenException(ErrorMessages.users.managerCreateRepOnly);
      }
      if (dto.teamId && dto.teamId !== caller.teamId) {
        throw new ForbiddenException(ErrorMessages.users.managerOwnTeamOnly);
      }
      if (dto.mfgRole !== undefined) {
        throw new ForbiddenException(ErrorMessages.users.managerCannotAssignMfgRole);
      }
    }

    // Normalize so case/whitespace variants resolve to one record (mirrors auth).
    const email = dto.email.trim().toLowerCase();

    // Email is globally unique. A match is either a genuine duplicate (active),
    // an email owned by another org (also a duplicate from this caller's view),
    // or a previously removed member in this org — which we reactivate below
    // rather than block, since deactivation is a soft delete.
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      const reusable =
        !existing.isActive && (!existing.orgId || existing.orgId === caller.orgId);
      if (!reusable) throw new ConflictException(ErrorMessages.users.emailInUse);
    }

    // If assigning to a team, the team's type must match the new user's role
    // (Member team → Sales Reps, Manager team → Managers). Directors oversee the
    // whole org and may belong to any team. Keep this rule in sync with update().
    if (dto.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: dto.teamId, ...(caller.orgId ? { orgId: caller.orgId } : {}) },
      });
      if (!team) throw new NotFoundException(ErrorMessages.users.teamNotFound);

      if (dto.role !== Role.DIRECTOR) {
        const expectedRole = team.type === TeamType.MANAGER ? Role.MANAGER : Role.SALES_REP;
        if (dto.role !== expectedRole) {
          throw new ForbiddenException(
            ErrorMessages.users.teamRoleMismatch(team.type === TeamType.MANAGER),
          );
        }
      }
    }

    // The admin never types or sees a password — the invited member sets their
    // own via an emailed link. If an explicit dto.password is supplied (e.g. via
    // API), it is honored and no invite link is sent.
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;
    const { password: _password, email: _email, ...rest } = dto;

    // Pre-verified: the admin vouches for them and the invite goes to that
    // address, so they skip the verify-on-login gate. Setting their own password
    // via the invite link is the activation step instead. Re-adding a removed
    // member reactivates their existing row (email is globally unique, so a second
    // row can't be created) and clears their old password for a fresh invite.
    const data = {
      ...rest,
      email,
      passwordHash,
      isActive: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      mustChangePassword: false,
      orgId: caller.orgId ?? undefined,
    };
    const select = { id: true, name: true, email: true, role: true, teamId: true, mfgRole: true, createdAt: true };

    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data, select })
      : await this.prisma.user.create({ data, select });

    // Fire-and-forget invite email: a failed send must never roll back user
    // creation (CLAUDE.md rule). Errors are logged, never thrown.
    if (!dto.password) void this.sendInvite(user.id, user.name, user.email, caller.orgId);

    // A new (or reactivated) active member raises the billed seat count.
    await this.syncSeats(caller);

    return user;
  }

  // Issues a single-use set-password token (reusing the PASSWORD_RESET flow and
  // its /reset-password page) and emails the invited member the link. Returns
  // whether the email actually went out — callers that fire this and forget
  // (create()) ignore it; resendInvite() awaits it to report failure to the caller.
  private async sendInvite(userId: string, name: string, email: string, orgId?: string | null): Promise<boolean> {
    try {
      if (!(await this.billing.hasEmailQuota(orgId))) {
        this.logger.warn(`Org ${orgId} has exhausted its email quota — skipping team invite to ${email}`);
        return false;
      }
      // Drop any prior tokens so only the newest invite link is valid.
      await this.prisma.verificationToken.deleteMany({
        where: { userId, type: VerificationTokenType.PASSWORD_RESET },
      });
      const raw = generateRawToken();
      const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);
      await this.prisma.verificationToken.create({
        data: { userId, type: VerificationTokenType.PASSWORD_RESET, tokenHash: hashToken(raw), expiresAt },
      });
      const setupUrl = `${FRONTEND_URL}/reset-password?token=${raw}`;
      const sent = await this.mail.send(email, "You've been added to GenX CRM", teamInviteTemplate(name, email, setupUrl));
      if (sent) void this.billing.recordEmailSent(orgId);
      return sent;
    } catch (err) {
      this.logger.error(
        `Failed to send team invite to ${email}`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  // Lets a Director (any member) or Manager (their managed teams / unassigned
  // only — same scope as update()) re-trigger the set-password invite for a
  // member who hasn't accepted yet. A no-op token from create()/reactivation
  // is superseded since sendInvite() always issues a fresh one.
  async resendInvite(id: string, caller: AuthUser): Promise<void> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const user = await this.prisma.user.findFirst({ where: { id, ...orgFilter } });
    if (!user) throw new NotFoundException(ErrorMessages.users.notFound);

    if (caller.role === Role.MANAGER) {
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: caller.id, ...orgFilter },
        select: { id: true },
      });
      const managedTeamIds = new Set(managedTeams.map((t) => t.id));
      if (user.teamId !== null && !managedTeamIds.has(user.teamId)) {
        throw new ForbiddenException(ErrorMessages.users.managerModifyManagedOnly);
      }
    }

    if (user.passwordHash) throw new ConflictException(ErrorMessages.users.inviteAlreadyAccepted);

    const sent = await this.sendInvite(user.id, user.name, user.email, caller.orgId);
    if (!sent) throw new ForbiddenException(ErrorMessages.users.resendInviteFailed);
  }

  // Who a caller is allowed to see in the user roster: SALES_REP → self only,
  // MANAGER → their managed teams' members + unassigned users, everyone else → whole org.
  private async buildVisibilityFilter(caller: AuthUser): Promise<Record<string, unknown>> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};

    if (caller.role === Role.SALES_REP) {
      return { ...orgFilter, id: caller.id };
    }

    if (caller.role === Role.MANAGER) {
      // Collect all teams this manager is responsible for:
      // their own teamId + any teams where they are the managerId
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: caller.id, ...orgFilter },
        select: { id: true },
      });
      const managedIds = managedTeams.map((t) => t.id);
      const allTeamIds = [...new Set([
        ...(caller.teamId ? [caller.teamId] : []),
        ...managedIds,
      ])];

      // Include managed-team members AND unassigned users (Manager can recruit them)
      return {
        ...orgFilter,
        OR: [
          ...(allTeamIds.length > 0 ? [{ teamId: { in: allTeamIds } }] : []),
          { teamId: null },
        ],
      };
    }

    return orgFilter;
  }

  async directory(caller: AuthUser) {
    if (!caller.orgId) return [];
    return this.prisma.user.findMany({
      where: { orgId: caller.orgId, isActive: true },
      select: { id: true, name: true, role: true, mfgRole: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAll(caller: AuthUser, includeOpenLeads = false) {
    const where = { isActive: true, ...(await this.buildVisibilityFilter(caller)) };

    const rows = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        team: { select: { name: true } },
        lastAssignedAt: true,
        monthlyTarget: true,
        passwordHash: true,
        mfaSecret: true,
      },
      orderBy: { name: 'asc' },
    });
    // Pending = invited but hasn't set a password yet via the invite link.
    const users = rows.map(({ passwordHash, mfaSecret, ...u }) => ({
      ...u,
      pending: !passwordHash,
      mfaConfigured: !!mfaSecret,
    }));

    if (!includeOpenLeads || users.length === 0) return users;

    const openLeadCounts = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: {
        isDeleted: false,
        ...(caller.orgId && { orgId: caller.orgId }),
        assignedToId: { in: users.map((u) => u.id) },
        stage: { notIn: TERMINAL_LEAD_STAGES },
      },
      _count: { assignedToId: true },
    });
    const countByUserId = new Map(
      openLeadCounts.map((c) => [c.assignedToId, c._count.assignedToId]),
    );

    return users.map((u) => ({ ...u, openLeads: countByUserId.get(u.id) ?? 0 }));
  }

  async findOne(id: string, caller: AuthUser) {
    // AND (not a flat spread) — the SALES_REP branch of buildVisibilityFilter also
    // returns an `id` key (caller.id), which would silently clobber the requested id.
    const visibilityFilter = await this.buildVisibilityFilter(caller);
    const user = await this.prisma.user.findFirst({
      where: { AND: [{ id }, visibilityFilter] },
      select: { id: true, name: true, email: true, role: true, teamId: true, team: true, monthlyTarget: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException(ErrorMessages.users.notFound);
    const { passwordHash, ...rest } = user;
    return { ...rest, pending: !passwordHash };
  }

  // Self-service profile update. Unlike update(), any authenticated role may
  // call this for their own record — it only ever touches name/password, both
  // of which are always safe for a user to change about themselves. Email is
  // intentionally not accepted here; it's read-only in the profile UI.
  async updateMe(dto: UpdateMeDto, caller: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: caller.id } });
    if (!user) throw new NotFoundException(ErrorMessages.users.notFound);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;

    let passwordChanged = false;
    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new ForbiddenException(ErrorMessages.users.currentPasswordRequired);
      }
      if (!user.passwordHash) {
        throw new ForbiddenException(ErrorMessages.users.ssoNoPassword);
      }
      const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!valid) throw new ForbiddenException(ErrorMessages.users.incorrectCurrentPassword);
      data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
      data.passwordChangedAt = new Date();
      passwordChanged = true;
    }

    const updated = await this.prisma.user.update({
      where: { id: caller.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        orgId: true,
        org: { select: { id: true, name: true, planStatus: true, trialEndsAt: true, gstNumber: true } },
      },
    });

    // Changing a password invalidates every other outstanding token (see
    // JwtStrategy.validate's passwordChangedAt check) — reissue one for the
    // session that just proved ownership of the current password so it isn't
    // logged out by its own change.
    if (!passwordChanged) return updated;
    const token = await this.sessionToken.mint({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      orgId: updated.orgId,
    });
    return { ...updated, token };
  }

  // Director-assisted recovery for a teammate locked out of MFA (lost both
  // their authenticator and their recovery codes). Same not-found-not-forbidden
  // convention as the rest of this service for cross-tenant access.
  async resetMfa(id: string, caller: AuthUser): Promise<void> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const user = await this.prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true } });
    if (!user) throw new NotFoundException(ErrorMessages.users.notFound);

    await this.mfa.adminReset(id);
  }

  async deactivate(id: string, caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const user = await this.prisma.user.findFirst({
      where: { id, ...orgFilter },
      select: { id: true, teamId: true, orgId: true },
    });
    if (!user) throw new NotFoundException(ErrorMessages.users.notFound);

    // Re-home the removed rep's open leads so they aren't orphaned on an
    // inactive owner: prefer the rep's team manager, else any active Director.
    const target = await this.resolveReassignTarget(user);
    if (target) {
      const orphaned = await this.prisma.lead.findMany({
        where: { assignedToId: id, isDeleted: false, ...orgFilter },
        select: { id: true },
      });
      if (orphaned.length > 0) {
        await this.prisma.$transaction([
          this.prisma.lead.updateMany({
            where: { assignedToId: id, isDeleted: false, ...orgFilter },
            data: { assignedToId: target },
          }),
          this.prisma.activity.createMany({
            data: orphaned.map((lead) => ({
              leadId: lead.id,
              userId: target,
              type: 'REASSIGN',
              note: 'Reassigned automatically after the previous owner was removed',
            })),
          }),
        ]);
      }
    } else {
      this.logger.warn(`No reassign target for removed user ${id}; leads left assigned.`);
    }

    const result = await this.prisma.user.update({ where: { id }, data: { isActive: false } });

    // Removing an active member lowers the billed seat count.
    await this.syncSeats(caller);

    return result;
  }

  // The owner to hand a removed rep's leads to: their team's manager (if active
  // and not the rep themselves), otherwise any active Director in the org.
  private async resolveReassignTarget(user: {
    id: string;
    teamId: string | null;
    orgId: string | null;
  }): Promise<string | null> {
    const orgFilter = user.orgId ? { orgId: user.orgId } : {};

    if (user.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: user.teamId, ...orgFilter },
        select: { managerId: true },
      });
      if (team?.managerId && team.managerId !== user.id) {
        const manager = await this.prisma.user.findFirst({
          where: { id: team.managerId, isActive: true, ...orgFilter },
          select: { id: true },
        });
        if (manager) return manager.id;
      }
    }

    const director = await this.prisma.user.findFirst({
      where: { role: Role.DIRECTOR, isActive: true, id: { not: user.id }, ...orgFilter },
      select: { id: true },
    });
    return director?.id ?? null;
  }

  async update(id: string, dto: UpdateUserDto, caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const user = await this.prisma.user.findFirst({ where: { id, ...orgFilter } });
    if (!user) throw new NotFoundException(ErrorMessages.users.notFound);

    // "" (e.g. an unset <select>, or a client that doesn't distinguish "no team" from
    // "not provided") means the same as null here — without this, Prisma tries a foreign-key
    // update to a team with id "", which doesn't exist, and throws an unhandled P2003 that
    // surfaces as a bare 500.
    const teamId = dto.teamId === '' ? null : dto.teamId;

    // Managers may only change teamId (not role), only to a team they manage,
    // and only for users currently in one of their managed teams or unassigned
    if (caller.role === Role.MANAGER) {
      if (dto.role !== undefined) {
        throw new ForbiddenException(ErrorMessages.users.managerCannotChangeRoles);
      }
      if (dto.mfgRole !== undefined) {
        throw new ForbiddenException(ErrorMessages.users.managerCannotAssignMfgRole);
      }

      // Fetch all teams this manager manages (managerId = caller.id)
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: caller.id, ...orgFilter },
        select: { id: true },
      });
      const managedTeamIds = new Set(managedTeams.map((t) => t.id));

      // Can only assign to a team they manage (not arbitrary teams)
      if (teamId !== undefined && teamId !== null && !managedTeamIds.has(teamId)) {
        throw new ForbiddenException(ErrorMessages.users.managerAssignManagedOnly);
      }

      // Can only modify users who are unassigned or already in one of their managed teams
      if (user.teamId !== null && !managedTeamIds.has(user.teamId)) {
        throw new ForbiddenException(ErrorMessages.users.managerModifyManagedOnly);
      }
    }

    // Prevent demoting the last Director in the org
    if (dto.role && dto.role !== Role.DIRECTOR && user.role === Role.DIRECTOR) {
      const directorCount = await this.prisma.user.count({
        where: { role: Role.DIRECTOR, isActive: true, ...orgFilter },
      });
      if (directorCount <= 1) throw new ForbiddenException(ErrorMessages.users.cannotDemoteLastDirector);
    }

    // Ensure target team belongs to the same org. A team's type restricts which
    // roles it accepts (Member team → Sales Reps, Manager team → Managers), but
    // Directors oversee the whole org and may belong to any team.
    if (teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: teamId, ...orgFilter },
      });
      if (!team) throw new NotFoundException(ErrorMessages.users.teamNotFound);

      const effectiveRole = dto.role ?? user.role;
      if (effectiveRole !== Role.DIRECTOR) {
        const expectedRole = team.type === TeamType.MANAGER ? Role.MANAGER : Role.SALES_REP;
        if (effectiveRole !== expectedRole) {
          throw new ForbiddenException(
            ErrorMessages.users.teamRoleMismatch(team.type === TeamType.MANAGER),
          );
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (teamId !== undefined) data.teamId = teamId;
    if (dto.monthlyTarget !== undefined) data.monthlyTarget = dto.monthlyTarget;
    if (dto.mfgRole !== undefined) data.mfgRole = dto.mfgRole;

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, teamId: true, team: true, monthlyTarget: true, mfgRole: true },
    });
  }

  async updateTeam(
    id: string,
    patch: { name?: string; managerId?: string | null; type?: TeamType; monthlyTarget?: number },
    caller: AuthUser,
  ) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const team = await this.prisma.team.findFirst({ where: { id, ...orgFilter } });
    if (!team) throw new NotFoundException(ErrorMessages.users.teamNotFound);

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.managerId !== undefined) data.managerId = patch.managerId;
    if (patch.type !== undefined) data.type = patch.type;
    // updateTeam's body isn't a validated DTO (see controller), so guard against a
    // malformed/negative value reaching Prisma directly.
    if (patch.monthlyTarget !== undefined && Number.isInteger(patch.monthlyTarget) && patch.monthlyTarget >= 0) {
      data.monthlyTarget = patch.monthlyTarget;
    }

    return this.prisma.team.update({
      where: { id },
      data,
      include: {
        manager: { select: { id: true, name: true } },
        members: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async deleteTeam(id: string, caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const team = await this.prisma.team.findFirst({ where: { id, ...orgFilter } });
    if (!team) throw new NotFoundException(ErrorMessages.users.teamNotFound);

    // Detach all members before deleting to avoid FK constraint errors
    await this.prisma.user.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await this.prisma.team.delete({ where: { id } });
  }

  async createTeam(name: string, managerId: string | undefined, type: TeamType = TeamType.MEMBER, caller: AuthUser) {
    await this.trial.checkLimit(caller.orgId, 'teams');

    // Managers can only create MEMBER-type teams and are automatically set as the manager
    if (caller.role === Role.MANAGER) {
      if (type !== TeamType.MEMBER) throw new ForbiddenException(ErrorMessages.users.managerMemberTeamsOnly);
      managerId = caller.id;
    }

    return this.prisma.team.create({
      data: { name, type, managerId: managerId || null, orgId: caller.orgId ?? undefined },
      include: {
        manager: { select: { id: true, name: true } },
        members: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async registerPushToken(token: string, caller: AuthUser) {
    await this.prisma.user.update({
      where: { id: caller.id },
      data: { pushToken: token, pushTokenUpdatedAt: new Date() },
    });
    return { ok: true as const };
  }

  findAllTeams(caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};

    // Manager sees only teams they manage or belong to; Director sees all org teams
    const teamWhere = caller.role === Role.MANAGER
      ? {
          ...orgFilter,
          OR: [
            { managerId: caller.id },
            ...(caller.teamId ? [{ id: caller.teamId }] : []),
          ],
        }
      : { ...orgFilter };

    return this.prisma.team.findMany({
      where: teamWhere,
      include: {
        manager: { select: { id: true, name: true } },
        members: { select: { id: true, name: true, role: true } },
      },
    });
  }
}
