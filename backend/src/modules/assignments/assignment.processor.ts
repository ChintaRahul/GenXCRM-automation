import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from './assignments.service';
import { MailService } from '../mail/mail.service';
import { leadsAssignedTemplate } from '../mail/mail.templates';
import { BillingService } from '../billing/billing.service';
import { mergeNotificationSettings } from '../../common/constants/org-defaults';

type AssignJobData = { leadId: string; teamId?: string; orgId?: string };
type NotifyJobData = { repId: string };

@Processor('assignment')
export class AssignmentProcessor {
  private readonly logger = new Logger(AssignmentProcessor.name);

  constructor(
    private prisma: PrismaService,
    private assignments: AssignmentsService,
    private mail: MailService,
    private billing: BillingService,
    @InjectQueue('assignment') private queue: Queue,
  ) {}

  @Process('assign')
  async handleAssign(job: Job<AssignJobData>) {
    const { leadId, teamId, orgId } = job.data;
    if (teamId) {
      await this.assignments.assignRoundRobin(leadId, teamId);
    } else if (orgId) {
      await this.assignments.assignRoundRobinOrg(leadId, orgId);
    }
  }

  /**
   * Flushes the debounced per-rep assignment list and sends ONE email summarising every
   * lead assigned to the rep during the debounce window. Reads + clears the Redis list,
   * then emails the rep (singular vs plural copy). Degrades quietly: no leads, no email,
   * missing rep email, or the rep's org opting out via `notifyRepOnAssignment` simply
   * skips the send.
   */
  @Process('notify')
  async handleNotify(job: Job<NotifyJobData>) {
    const { repId } = job.data;
    const key = `assign-notify:${repId}`;
    const leadIds = await this.queue.client.lrange(key, 0, -1);
    await this.queue.client.del(key);
    if (!leadIds.length) return;

    const rep = await this.prisma.user.findUnique({
      where: { id: repId },
      select: {
        email: true,
        name: true,
        orgId: true,
        org: { select: { notifyRepOnAssignment: true, notificationSettings: true } },
      },
    });
    if (!rep?.email) return;
    if (rep.org && !rep.org.notifyRepOnAssignment) return;
    // Both this older org-wide toggle above and the newer per-notification-type
    // setting must agree to send — collapsing them into one would silently
    // change behavior for orgs that already rely on the older flag alone.
    if (rep.org && !mergeNotificationSettings(rep.org.notificationSettings).newLeadAssigned.email) return;
    if (!(await this.billing.hasEmailQuota(rep.orgId))) {
      this.logger.warn(`Org ${rep.orgId} has exhausted its email quota — skipping assignment notice for rep ${repId}`);
      return;
    }

    const leads = await this.prisma.lead.findMany({
      where: { id: { in: leadIds }, isDeleted: false },
      select: { name: true },
    });
    if (!leads.length) return;

    const subject = leads.length === 1 ? 'You have a new lead' : `You have ${leads.length} new leads assigned`;
    await this.mail.send(rep.email, subject, leadsAssignedTemplate(rep.name, leads));
    void this.billing.recordEmailSent(rep.orgId);
  }

  @OnQueueFailed()
  async handleFailed(job: Job<AssignJobData>, err: Error) {
    // Only 'assign' jobs carry a leadId and warrant an ASSIGNMENT_FAILED activity.
    if (job.name !== 'assign') return;

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      // Will be retried — not a terminal failure yet.
      return;
    }

    const { leadId } = job.data;
    this.logger.error(`Assignment failed for lead ${leadId} after ${job.attemptsMade} attempts: ${err.message}`);
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'ASSIGNMENT_FAILED',
        note: `Round-robin assignment failed after ${job.attemptsMade} attempts: ${err.message}`,
      },
    });
  }
}
