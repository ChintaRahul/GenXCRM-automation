import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { MailService } from '../mail/mail.service';
import { MfgReportsService } from './mfg-reports.service';

const CHECK_EVERY_MS = 3_600_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// A Daily/Weekly/Monthly report is due once its send hour (sendAt "HH:mm", default 08:00) has passed
// and a full period has elapsed since the last delivery.
export const isDeliveryDue = (frequency: string, sendAt: string | null, lastRanAt: Date | null, now: Date): boolean => {
  if (!['Daily', 'Weekly', 'Monthly'].includes(frequency)) return false;
  const sendHour = Number(sendAt?.split(':')[0] ?? 8);
  if (now.getHours() < (Number.isNaN(sendHour) ? 8 : sendHour)) return false;
  if (!lastRanAt) return true;
  if (frequency === 'Daily') return now.getTime() - lastRanAt.getTime() >= 20 * 60 * 60 * 1000;
  if (frequency === 'Weekly') return now.getTime() - lastRanAt.getTime() >= 6.5 * DAY_MS;
  return lastRanAt.getMonth() !== now.getMonth() || lastRanAt.getFullYear() !== now.getFullYear();
};

@Injectable()
export class MfgReportDeliveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #logger = new Logger(MfgReportDeliveryService.name);
  #timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: MfgReportsService,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.#timer = setInterval(() => void this.deliverDueReports(), CHECK_EVERY_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.#timer);
  }

  async deliverDueReports(now = new Date()): Promise<void> {
    try {
      const scheduled = await this.prisma.report.findMany({
        where: { isDeleted: false, scheduleFrequency: { in: ['Daily', 'Weekly', 'Monthly'] }, recipients: { not: null } },
        include: { schedules: { orderBy: { ranAt: 'desc' }, take: 1 } },
      });
      for (const report of scheduled) {
        if (!isDeliveryDue(report.scheduleFrequency, report.sendAt, report.schedules[0]?.ranAt ?? null, now)) continue;
        try {
          await this.deliver(report);
        } catch (err) {
          this.#logger.error(`Scheduled report '${report.name}' failed`, err instanceof Error ? err.stack : err);
          await this.prisma.reportSchedule.create({ data: { reportId: report.id, status: 'Failed', format: report.format } });
        }
      }
    } catch (err) {
      this.#logger.error('Scheduled report delivery failed', err instanceof Error ? err.stack : err);
    }
  }

  private async deliver(report: { id: string; orgId: string; name: string; format: string; recipients: string | null }): Promise<void> {
    const wanted = (report.recipients ?? '').split(/[,;\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
    // Only people in the org may receive its data.
    const members = await this.prisma.user.findMany({
      where: { orgId: report.orgId, isActive: true, email: { in: wanted, mode: 'insensitive' } },
      select: { email: true },
    });
    const recipients = members.map((member) => member.email);
    if (!recipients.length) {
      await this.prisma.reportSchedule.create({ data: { reportId: report.id, status: 'Skipped — no recipient belongs to this organization', format: report.format } });
      return;
    }
    const caller = { id: 'system', orgId: report.orgId, role: Role.DIRECTOR } as AuthUser;
    const { filename, buffer } = await this.reports.buildCsv(report.id, caller);
    for (const to of recipients) {
      await this.mail.sendRaw(to, `${report.name} — scheduled report`, `<p>Your scheduled report <b>${report.name}</b> is attached.</p>`, [
        { filename, content: buffer, contentType: 'text/csv' },
      ]);
    }
    await this.prisma.reportSchedule.create({ data: { reportId: report.id, status: 'Sent', recipientsSentTo: recipients.join(', '), format: 'CSV' } });
  }
}
