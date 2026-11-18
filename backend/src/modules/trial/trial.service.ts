import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanStatus, SubscriptionStatus } from '@prisma/client';
import { ErrorMessages } from '../../common/constants/messages';

export type TrialResource = 'leads' | 'users' | 'sequences' | 'teams';
type NonSeatResource = Exclude<TrialResource, 'users'>;

// Shape of SubscriptionPlan.features relevant to resource limits. `users` is only
// meaningful on the Trial row (a real cap) — paid plans use -1 there since seats are
// billed/enforced separately via OrgSubscription.userCount.
export interface PlanLimits {
  leads: number;
  teams: number;
  sequences: number;
  users: number;
}

@Injectable()
export class TrialService {
  constructor(private readonly prisma: PrismaService) {}

  // The Trial plan's limits live in the SubscriptionPlan table (tier: 'trial', seeded)
  // rather than a hardcoded constant, so they can change without a code deploy.
  private async getTrialPlanLimits(): Promise<PlanLimits> {
    const plan = await this.prisma.subscriptionPlan.findFirst({ where: { tier: 'trial' } });
    return plan?.features as unknown as PlanLimits;
  }

  async getStatus(orgId: string) {
    const [org, sub] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, planStatus: true, trialEndsAt: true },
      }),
      this.prisma.orgSubscription.findUnique({
        where: { orgId },
        select: { status: true, plan: { select: { features: true } } },
      }),
    ]);
    if (!org) throw new NotFoundException(ErrorMessages.trial.orgNotFound);

    // Active subscription overrides trial state — sync org.planStatus if needed
    if (sub?.status === SubscriptionStatus.ACTIVE || sub?.status === SubscriptionStatus.AUTHENTICATED) {
      if (org.planStatus !== PlanStatus.ACTIVE) {
        await this.prisma.organization.update({
          where: { id: orgId },
          data: { planStatus: PlanStatus.ACTIVE },
        });
      }
      const [userCount, leadCount, sequenceCount, teamCount] = await Promise.all([
        this.prisma.user.count({ where: { orgId } }),
        this.prisma.lead.count({ where: { orgId, isDeleted: false } }),
        this.prisma.nurturingSequence.count({ where: { orgId, isActive: true } }),
        this.prisma.team.count({ where: { orgId } }),
      ]);
      return {
        planStatus: PlanStatus.ACTIVE,
        trialEndsAt: org.trialEndsAt,
        daysRemaining: 0,
        isExpired: false,
        limits: sub.plan.features as unknown as PlanLimits,
        usage: { leads: leadCount, users: userCount, sequences: sequenceCount, teams: teamCount },
      };
    }

    const now = new Date();
    const trialJustExpired = org.planStatus === PlanStatus.TRIAL && org.trialEndsAt < now;

    if (trialJustExpired) {
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { planStatus: PlanStatus.EXPIRED },
      });
    }

    const effectiveStatus = trialJustExpired ? PlanStatus.EXPIRED : org.planStatus;
    const isExpired = effectiveStatus === PlanStatus.EXPIRED;
    const daysRemaining = isExpired
      ? 0
      : Math.max(0, Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / 86_400_000));

    const [userCount, leadCount, sequenceCount, teamCount, limits] = await Promise.all([
      this.prisma.user.count({ where: { orgId } }),
      this.prisma.lead.count({ where: { orgId, isDeleted: false } }),
      this.prisma.nurturingSequence.count({ where: { orgId, isActive: true } }),
      this.prisma.team.count({ where: { orgId } }),
      this.getTrialPlanLimits(),
    ]);

    return {
      planStatus: effectiveStatus,
      trialEndsAt: org.trialEndsAt,
      daysRemaining,
      isExpired,
      limits,
      usage: {
        leads: leadCount,
        users: userCount,
        sequences: sequenceCount,
        teams: teamCount,
      },
    };
  }

  async checkLimit(orgId: string | null | undefined, resource: TrialResource): Promise<void> {
    if (!orgId) return;

    const sub = await this.prisma.orgSubscription.findUnique({
      where: { orgId },
      select: { status: true, userCount: true, plan: { select: { features: true } } },
    });
    if (sub?.status === SubscriptionStatus.ACTIVE || sub?.status === SubscriptionStatus.AUTHENTICATED) {
      // Users are billed per seat — enforce the purchased seat count (sub.userCount).
      if (resource === 'users') {
        const current = await this.prisma.user.count({ where: { orgId } });
        if (current >= sub.userCount) {
          throw new ForbiddenException({
            code: 'SEAT_LIMIT_REACHED',
            resource: 'users',
            limit: sub.userCount,
            current,
            message: ErrorMessages.trial.seatLimit(sub.userCount),
          });
        }
        return;
      }

      // Other resources are capped at the subscribed plan's included allowance.
      const features = sub.plan.features as unknown as PlanLimits;
      const limit = features[resource];
      const current = await this.countResource(orgId, resource);
      if (current >= limit) {
        throw new ForbiddenException({
          code: 'PLAN_LIMIT_REACHED',
          resource,
          limit,
          current,
          message: ErrorMessages.trial.planLimitReached(limit, resource),
        });
      }
      return;
    }

    const status = await this.getStatus(orgId);

    if (status.isExpired) {
      throw new ForbiddenException({
        code: 'TRIAL_EXPIRED',
        message: ErrorMessages.trial.expired,
      });
    }

    if (status.planStatus !== PlanStatus.TRIAL) return;

    const current = status.usage[resource];
    const limit = status.limits[resource];

    if (current >= limit) {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        resource,
        limit,
        current,
        message: ErrorMessages.trial.limitReached(limit, resource),
      });
    }
  }

  private countResource(orgId: string, resource: NonSeatResource): Promise<number> {
    switch (resource) {
      case 'leads':
        return this.prisma.lead.count({ where: { orgId, isDeleted: false } });
      case 'sequences':
        return this.prisma.nurturingSequence.count({ where: { orgId, isActive: true } });
      case 'teams':
        return this.prisma.team.count({ where: { orgId } });
    }
  }
}
