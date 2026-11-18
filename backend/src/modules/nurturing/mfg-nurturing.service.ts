import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';

export type MfgNurtureEntity = 'MfgLead' | 'Quotation' | 'Opportunity' | 'Coverage';

// Sequence triggers a Manufacturing workspace can pick (stored in NurturingSequence.triggerEvent).
export const MFG_NURTURE_TRIGGERS = ['mfg_lead_created', 'mfg_lead_nurture', 'quotation_sent', 'opportunity_lost', 'amc_due_soon'] as const;
export type MfgNurtureTrigger = (typeof MFG_NURTURE_TRIGGERS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

interface Recipient {
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  ownerId: string | null;
  // Where the sent message is logged, so it shows up on the record's activity list.
  links: { mfgLeadId?: string; opportunityId?: string; accountId?: string; contactId?: string };
}

// Engagement for Manufacturing records. An enrolment is "this record is in this sequence": the same
// sequences the Nurturing page builds, but run against leads, quotations, opportunities and AMCs.
// Emails go out through the org's own email setup and are logged as completed activities;
// WhatsApp and SMS steps become tasks for the record's owner.
@Injectable()
export class MfgNurturingService {
  readonly #logger = new Logger(MfgNurturingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationsService,
  ) {}

  // Enrols the record in every active sequence of the org with this trigger. Best effort: a problem here
  // is logged and never reaches the action (sending a quotation, moving a lead) that triggered it.
  async enroll(orgId: string, trigger: MfgNurtureTrigger, entityType: MfgNurtureEntity, entityId: string): Promise<void> {
    try {
      const sequences = await this.prisma.nurturingSequence.findMany({
        where: { orgId, isActive: true, triggerEvent: trigger },
        include: { steps: { orderBy: { stepOrder: 'asc' }, take: 1 } },
      });
      for (const sequence of sequences) {
        const first = sequence.steps[0];
        if (!first) continue;
        const existing = await this.prisma.mfgNurtureEnrollment.findUnique({
          where: { sequenceId_entityType_entityId: { sequenceId: sequence.id, entityType, entityId } },
        });
        if (existing?.status === 'active') continue;
        const fresh = { status: 'active', currentStep: 0, nextRunAt: new Date(Date.now() + first.delayDays * DAY_MS), completedAt: null, enrolledAt: new Date() };
        if (existing) await this.prisma.mfgNurtureEnrollment.update({ where: { id: existing.id }, data: fresh });
        else await this.prisma.mfgNurtureEnrollment.create({ data: { orgId, sequenceId: sequence.id, entityType, entityId, ...fresh } });
      }
    } catch (err) {
      this.#logger.error(`Could not enrol ${entityType} ${entityId} for '${trigger}'`, err instanceof Error ? err.stack : err);
    }
  }

  // Stops every active sequence for a record (it was merged away or removed).
  async endEnrollments(orgId: string, entityType: MfgNurtureEntity, entityId: string): Promise<void> {
    await this.prisma.mfgNurtureEnrollment.updateMany({
      where: { orgId, entityType, entityId, status: 'active' },
      data: { status: 'removed', nextRunAt: null },
    });
  }

  // Advances every due enrolment by one step (oldest first). One failing enrolment never stalls the batch.
  async executeDue(): Promise<{ processed: number }> {
    const due = await this.prisma.mfgNurtureEnrollment.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() }, sequence: { isActive: true } },
      orderBy: { nextRunAt: 'asc' },
      take: BATCH,
      include: { sequence: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
    });
    for (const enrollment of due) {
      try {
        await this.runStep(enrollment);
      } catch (err) {
        this.#logger.error(`Nurturing step failed for enrolment ${enrollment.id}`, err instanceof Error ? err.stack : err);
      }
    }
    return { processed: due.length };
  }

  private async runStep(enrollment: Prisma.MfgNurtureEnrollmentGetPayload<{ include: { sequence: { include: { steps: true } } } }>): Promise<void> {
    const { orgId, entityType, entityId } = enrollment;
    const step = enrollment.sequence.steps[enrollment.currentStep];
    const recipient = step ? await this.resolveRecipient(orgId, entityType as MfgNurtureEntity, entityId) : null;
    if (step && recipient) {
      try {
        await this.perform(orgId, step, recipient);
      } catch (err) {
        // A step that can never succeed must not block the enrolment forever: log it and move on.
        this.#logger.error(`Nurturing ${step.type} step failed for ${entityType} ${entityId}`, err instanceof Error ? err.message : String(err));
      }
    }
    const nextStep = enrollment.sequence.steps[enrollment.currentStep + 1];
    await this.prisma.mfgNurtureEnrollment.update({
      where: { id: enrollment.id },
      data:
        recipient && nextStep
          ? { currentStep: enrollment.currentStep + 1, nextRunAt: new Date(Date.now() + nextStep.delayDays * DAY_MS) }
          : { currentStep: enrollment.currentStep + 1, status: 'completed', completedAt: new Date(), nextRunAt: null },
    });
  }

  private fill(template: string, recipient: Recipient): string {
    const values: Record<string, string> = { name: recipient.name, company: recipient.company, email: recipient.email ?? '', phone: recipient.phone ?? '' };
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
  }

  private async perform(orgId: string, step: { type: string; subject: string | null; body: string | null; templateName: string | null }, recipient: Recipient): Promise<void> {
    const body = this.fill(step.body ?? '', recipient);
    const log = (data: Partial<Prisma.MfgActivityUncheckedCreateInput> & { type: string; subject: string }) =>
      this.prisma.mfgActivity.create({
        data: { orgId, ownerId: recipient.ownerId, priority: 'Medium', status: 'Open', ...recipient.links, ...data },
      });

    if (step.type === 'email') {
      const subject = this.fill(step.subject ?? '', recipient) || 'Following up';
      const outcome = recipient.email ? ((await this.comms.sendEmailToAddress(orgId, recipient.email, subject, body)) ? 'Sent' : 'Failed') : 'No email on file';
      await log({ type: 'Email', subject: `Emailed: ${subject}`, status: 'Completed', outcome, notes: body });
    } else if (step.type === 'whatsapp' || step.type === 'sms') {
      // Messaging channels stay with a person: the task carries the ready-to-send text.
      const approved = !step.templateName || (await this.isTemplateApproved(orgId, step.templateName));
      await log({
        type: step.type === 'whatsapp' ? 'WhatsApp' : 'Call',
        subject: approved ? `Send ${step.type === 'whatsapp' ? 'WhatsApp' : 'SMS'} to ${recipient.name}` : `WhatsApp template '${step.templateName}' is not approved yet`,
        notes: approved ? body : 'Only approved templates can be used. Get the template approved, or send a plain message.',
        dueDate: new Date(),
      });
    }
  }

  private async isTemplateApproved(orgId: string, templateName: string): Promise<boolean> {
    const template = await this.prisma.messageTemplate.findFirst({ where: { orgId, metaTemplateName: templateName }, select: { status: true } });
    return template?.status === 'APPROVED';
  }

  private async resolveRecipient(orgId: string, entityType: MfgNurtureEntity, entityId: string): Promise<Recipient | null> {
    const firstContact = (accountId: string) =>
      this.prisma.contact.findFirst({ where: { orgId, accountId, isDeleted: false, status: 'Active' }, orderBy: { createdAt: 'asc' } });
    const accountName = async (accountId: string) => (await this.prisma.account.findFirst({ where: { id: accountId, orgId }, select: { name: true } }))?.name ?? '';

    if (entityType === 'MfgLead') {
      const lead = await this.prisma.mfgLead.findFirst({ where: { id: entityId, orgId, isDeleted: false } });
      if (!lead) return null;
      return { name: lead.contactName, company: lead.company, email: lead.email, phone: lead.phone, ownerId: lead.ownerId, links: { mfgLeadId: lead.id } };
    }
    if (entityType === 'Opportunity') {
      const opportunity = await this.prisma.opportunity.findFirst({ where: { id: entityId, orgId, isDeleted: false } });
      if (!opportunity) return null;
      const contact = opportunity.contactId ? await this.prisma.contact.findFirst({ where: { id: opportunity.contactId, orgId } }) : await firstContact(opportunity.accountId);
      return {
        name: contact?.name ?? '',
        company: await accountName(opportunity.accountId),
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
        ownerId: opportunity.ownerId,
        links: { opportunityId: opportunity.id, accountId: opportunity.accountId, contactId: contact?.id },
      };
    }
    if (entityType === 'Quotation') {
      const quotation = await this.prisma.quotation.findFirst({ where: { id: entityId, orgId, isDeleted: false } });
      if (!quotation) return null;
      const contact = await firstContact(quotation.accountId);
      return {
        name: contact?.name ?? '',
        company: await accountName(quotation.accountId),
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
        ownerId: quotation.ownerId,
        links: { opportunityId: quotation.opportunityId, accountId: quotation.accountId, contactId: contact?.id },
      };
    }
    const coverage = await this.prisma.coverage.findFirst({ where: { id: entityId, orgId, isDeleted: false } });
    if (!coverage) return null;
    const contact = await firstContact(coverage.accountId);
    return {
      name: contact?.name ?? '',
      company: await accountName(coverage.accountId),
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      ownerId: coverage.ownerId,
      links: { accountId: coverage.accountId, contactId: contact?.id },
    };
  }
}
