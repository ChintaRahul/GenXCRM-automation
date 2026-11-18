import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { LeadStage, Role, WorkspaceType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { mergeNotificationSettings, type NotificationSettings } from '../../common/constants/org-defaults';

type ReminderSettings = NotificationSettings['followUpReminders'];

const CHECK_EVERY_MS = 15 * 60 * 1000;

interface Counts {
  overdue: number;
  today: number;
}

// The org's calendar date ('YYYY-MM-DD') and hour right now, in its own timezone.
export const orgClock = (timezone: string, now: Date): { date: string; hour: number; weekday: string } => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday: get('weekday') };
  } catch {
    return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours(), weekday: '' };
  }
};

// The instant the org-local calendar day `date` begins. Follow-ups before it are overdue; from it
// until 24h later, due today. (Fixed 24h day — a DST change inside the day shifts it by an hour.)
export const orgDayStart = (date: string, timezone: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    return new Date(guess - (wall - guess));
  } catch {
    return new Date(guess);
  }
};

@Injectable()
export class FollowUpRemindersService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #logger = new Logger(FollowUpRemindersService.name);
  #timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.#timer = setInterval(() => void this.sendDueDigests(), CHECK_EVERY_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.#timer);
  }

  // Sends each opted-in org's digest once per org-local day, from its configured hour. Never throws.
  async sendDueDigests(now = new Date()): Promise<void> {
    try {
      const orgs = await this.prisma.organization.findMany({
        select: { id: true, timezone: true, workspaceType: true, notificationSettings: true, followUpDigestSentOn: true },
      });
      for (const org of orgs) {
        const settings = mergeNotificationSettings(org.notificationSettings).followUpReminders;
        if (!settings.enabled || (!settings.email && !settings.inApp)) continue;
        const { date, hour, weekday } = orgClock(org.timezone, now);
        if (hour < settings.sendHour || org.followUpDigestSentOn === date) continue;
        if (settings.skipSundays && weekday === 'Sun') continue;
        try {
          // Claim the day first so a slow send can't be repeated by the next tick.
          await this.prisma.organization.update({ where: { id: org.id }, data: { followUpDigestSentOn: date } });
          await this.sendOrgDigest(org.id, org.workspaceType, org.timezone, date, settings);
        } catch (err) {
          this.#logger.error(`Follow-up digest failed for org ${org.id}`, err instanceof Error ? err.stack : err);
        }
      }
    } catch (err) {
      this.#logger.error('Follow-up digest sweep failed', err instanceof Error ? err.stack : err);
    }
  }

  private async sendOrgDigest(
    orgId: string,
    workspace: WorkspaceType,
    timezone: string,
    date: string,
    settings: ReminderSettings,
  ): Promise<void> {
    const roles = [...(settings.reps ? [Role.SALES_REP] : []), ...(settings.managers ? [Role.MANAGER] : [])];
    if (!roles.length) return;
    const dayStart = orgDayStart(date, timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const users = await this.prisma.user.findMany({
      where: { orgId, isActive: true, role: { in: roles } },
      select: { id: true, name: true, email: true, role: true, teamId: true },
    });
    for (const user of users) {
      const counts =
        workspace === WorkspaceType.MANUFACTURING
          ? await this.countMfg(orgId, user.id, dayStart, dayEnd)
          : await this.countLeads(orgId, user, dayStart, dayEnd);
      const overdue = settings.overdue ? counts.overdue : 0;
      const today = settings.today ? counts.today : 0;
      const total = overdue + today;
      if (total === 0) continue; // nothing due, no noise

      const title = `${total} follow-up${total === 1 ? '' : 's'} today`;
      const parts = [
        ...(settings.overdue ? [`${overdue} overdue`] : []),
        ...(settings.today ? [`${today} due today`] : []),
      ];
      const summary = `${parts.join(', ')}.`;
      const channels = settings;
      if (channels.inApp) await this.notifications.createOnce(orgId, user.id, title, summary, '/dashboard');
      if (channels.email && user.email) {
        await this.mail.send(
          user.email,
          `Your ${total} follow-up${total === 1 ? '' : 's'} for today`,
          `<p>Good morning ${user.name},</p><p>${summary}</p><p>Open GenXCRM to see who to reach out to first.</p>`,
        );
      }
    }
  }

  // Same org + role scope as the leads list: reps their own, managers their team, directors the whole org.
  private async countLeads(
    orgId: string,
    user: { id: string; role: Role; teamId: string | null },
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Counts> {
    const scope: Prisma.LeadWhereInput =
      user.role === Role.SALES_REP
        ? { assignedToId: user.id }
        : user.role === Role.MANAGER
          ? { teamId: user.teamId ?? undefined }
          : {};
    const open: Prisma.LeadWhereInput = {
      orgId,
      ...scope,
      isDeleted: false,
      stage: { notIn: [LeadStage.ENROLLED, LeadStage.NOT_INTERESTED] },
    };
    const [overdue, today] = await Promise.all([
      this.prisma.lead.count({ where: { ...open, followUpAt: { lt: dayStart } } }),
      this.prisma.lead.count({ where: { ...open, followUpAt: { gte: dayStart, lt: dayEnd } } }),
    ]);
    return { overdue, today };
  }

  // Manufacturing: the user's open activities, which already carry due dates.
  private async countMfg(orgId: string, userId: string, dayStart: Date, dayEnd: Date): Promise<Counts> {
    const open = { orgId, ownerId: userId, status: 'Open', isDeleted: false };
    const [overdue, today] = await Promise.all([
      this.prisma.mfgActivity.count({ where: { ...open, dueDate: { lt: dayStart } } }),
      this.prisma.mfgActivity.count({ where: { ...open, dueDate: { gte: dayStart, lt: dayEnd } } }),
    ]);
    return { overdue, today };
  }
}
