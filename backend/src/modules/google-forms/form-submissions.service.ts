import { Injectable, Logger } from '@nestjs/common';
import { GoogleForm, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookService } from '../../integrations/webhook/webhook.service';
import { extractContact } from './form-contact.util';
import type { GoogleFormResponse } from './google-api.client';
import type { QuestionMeta } from './form-sheet.util';

@Injectable()
export class FormSubmissionsService {
  private readonly logger = new Logger(FormSubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: WebhookService,
  ) {}

  // Store the raw response first (Google's response id dedups), then process it inline. A processing
  // failure is recorded on the row and retried by the next sync run.
  async ingestResponse(form: GoogleForm, response: GoogleFormResponse, questions: QuestionMeta[]): Promise<void> {
    const titles = new Map(questions.map((q) => [q.id, q.title]));
    const answers: Record<string, string> = {};
    let claimedLeadId = '';
    for (const [questionId, answer] of Object.entries(response.answers ?? {})) {
      const value = (answer.textAnswers?.answers ?? []).map((a) => a.value).join(', ');
      if (questionId === form.leadIdQuestionId) {
        claimedLeadId = value.trim();
        continue;
      }
      answers[titles.get(questionId) ?? questionId] = value;
    }

    let submissionId: string;
    try {
      const created = await this.prisma.formSubmission.create({
        data: {
          orgId: form.orgId,
          formId: form.id,
          externalResponseId: response.responseId,
          answers,
          rawPayload: { leadId: claimedLeadId, response } as unknown as Prisma.InputJsonValue,
          submittedAt: new Date(response.lastSubmittedTime ?? response.createTime),
        },
      });
      submissionId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
    await this.processSafely(submissionId);
  }

  async retryUnprocessed(formId: string, limit = 50): Promise<number> {
    const rows = await this.prisma.formSubmission.findMany({
      where: { formId, status: { in: ['RECEIVED', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const { id } of rows) await this.processSafely(id);
    return rows.length;
  }

  private async processSafely(submissionId: string): Promise<void> {
    try {
      await this.processSubmission(submissionId);
    } catch (err) {
      await this.markFailed(submissionId, err instanceof Error ? err.message.slice(0, 300) : 'Processing failed');
    }
  }

  async processSubmission(submissionId: string): Promise<void> {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: { form: { select: { name: true } } },
    });
    if (!submission || submission.status === 'PROCESSED') return;

    const { orgId, formId } = submission;
    // The DTO only guarantees an object, so coerce every value to a string.
    const rawAnswers = (submission.answers ?? {}) as Record<string, unknown>;
    const answers: Record<string, string> = Object.fromEntries(
      Object.entries(rawAnswers).map(([key, value]) => [key, String(value ?? '')]),
    );
    const claimedLeadId = (submission.rawPayload as { leadId?: string } | null)?.leadId;
    const leadId = await this.resolveLead(orgId, claimedLeadId, answers);

    // Lead resolution above is retry-safe (dedup finds a created lead); the writes are atomic.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.formSubmission.update({
        where: { id: submissionId },
        data: { leadId, status: 'PROCESSED', error: null },
      }),
      ...(leadId
        ? [
            this.prisma.activity.create({
              data: {
                leadId,
                type: 'FORM_SUBMITTED',
                note: `Submitted form "${submission.form.name}"`,
                metadata: { submissionId },
              },
            }),
            this.prisma.lead.update({ where: { id: leadId }, data: { activityAt: now } }),
          ]
        : []),
      this.prisma.googleForm.update({ where: { id: formId }, data: { lastSubmissionAt: now } }),
    ]);
  }

  async markFailed(submissionId: string, message: string): Promise<void> {
    try {
      await this.prisma.formSubmission.update({
        where: { id: submissionId },
        data: { status: 'FAILED', error: message },
      });
    } catch (err) {
      this.logger.error(`Could not mark form submission ${submissionId} failed (${message})`, err);
    }
  }

  // Lead ID (exact) → phone/email (existing dedup rules) → create. Always inside the form's org.
  private async resolveLead(
    orgId: string,
    claimedLeadId: string | undefined,
    answers: Record<string, string>,
  ): Promise<string | null> {
    if (claimedLeadId) {
      const byId = await this.prisma.lead.findFirst({
        where: { id: claimedLeadId, orgId, isDeleted: false },
        select: { id: true },
      });
      if (byId) return byId.id;
    }

    const { name, phone, email } = extractContact(answers);
    const last10 = phone?.slice(-10);
    const or: Prisma.LeadWhereInput[] = [
      ...(last10 ? [{ phone: { endsWith: last10 } }] : []),
      ...(email ? [{ email }] : []),
    ];
    if (or.length > 0) {
      const existing = await this.prisma.lead.findFirst({
        where: { orgId, isDeleted: false, OR: or },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    if (!phone || !last10 || last10.length < 10) return null;
    const created = await this.webhook.ingestLead({ name: name ?? 'Form respondent', phone, email }, orgId);
    if ('id' in created) return created.id;
    if ('leadId' in created) return created.leadId ?? null;
    return null;
  }
}
