import { Injectable, Logger } from '@nestjs/common';
import { GoogleForm, IntegrationProvider, IntegrationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleApiClient, type GoogleFormResponse } from './google-api.client';
import { FormSubmissionsService } from './form-submissions.service';
import { buildSheetHeader, buildSheetRow, questionsFromDoc, type QuestionMeta } from './form-sheet.util';

export interface SyncResult {
  synced: number;
  skipped?: boolean;
  error?: string;
}

const CURSOR_OVERLAP_MS = 1000;
const PAUSE_BETWEEN_FORMS_MS = 250;
const SHEET_BATCH = 100;
const MAX_ERROR_LENGTH = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// Messages only, never answers or tokens; kept short so it fits a status column.
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Sync failed').slice(0, MAX_ERROR_LENGTH);
const responseTime = (r: GoogleFormResponse) => new Date(r.lastSubmittedTime ?? r.createTime);

@Injectable()
export class FormSyncService {
  private readonly logger = new Logger(FormSyncService.name);
  private readonly lastAttempt = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GoogleAuthService,
    private readonly api: GoogleApiClient,
    private readonly submissions: FormSubmissionsService,
  ) {}

  async syncAllActive(): Promise<void> {
    const connected = await this.prisma.orgIntegration.findMany({
      where: { provider: IntegrationProvider.GOOGLE_FORMS, status: IntegrationStatus.CONNECTED },
      select: { orgId: true },
    });
    if (connected.length === 0) return;
    const forms = await this.prisma.googleForm.findMany({
      where: { orgId: { in: connected.map((c) => c.orgId) }, isActive: true, googleFormId: { not: null } },
      select: { id: true },
    });
    for (const { id } of forms) {
      // syncForm never throws; the guard keeps one unexpected failure from stopping the others.
      try {
        await this.syncForm(id);
      } catch (err) {
        this.logger.error(`Form sync crashed for ${id}: ${errorMessage(err)}`);
      }
      await sleep(PAUSE_BETWEEN_FORMS_MS);
    }
  }

  // Never throws: a failing form records its own syncError and never stops the others.
  async syncForm(formId: string, opts: { minIntervalMs?: number } = {}): Promise<SyncResult> {
    let form: GoogleForm | null;
    try {
      form = await this.prisma.googleForm.findUnique({ where: { id: formId } });
    } catch (err) {
      return { synced: 0, error: errorMessage(err) };
    }
    if (!form?.isActive || !form.googleFormId) return { synced: 0 };

    // One run per form at a time (tick vs "Check now") so sheet rows are never appended twice.
    if (this.inFlight.has(formId)) return { synced: 0, skipped: true };
    const now = Date.now();
    const last = this.lastAttempt.get(formId);
    if (opts.minIntervalMs && last !== undefined && now - last < opts.minIntervalMs) {
      return { synced: 0, skipped: true };
    }
    this.lastAttempt.set(formId, now);
    this.inFlight.add(formId);

    try {
      return await this.run(form, form.googleFormId);
    } catch (err) {
      const message = errorMessage(err);
      this.logger.warn(`Form sync failed for ${formId}: ${message}`);
      try {
        await this.prisma.googleForm.update({ where: { id: formId }, data: { syncError: message } });
      } catch (updateErr) {
        this.logger.error(`Could not record the sync error for ${formId}: ${errorMessage(updateErr)}`);
      }
      return { synced: 0, error: message };
    } finally {
      this.inFlight.delete(formId);
    }
  }

  private async run(form: GoogleForm, googleFormId: string): Promise<SyncResult> {
    const token = await this.auth.getAccessToken(form.orgId);
    let questions = (form.questionTitles as unknown as QuestionMeta[] | null) ?? [];
    const since = form.lastResponseAt ? new Date(form.lastResponseAt.getTime() - CURSOR_OVERLAP_MS) : undefined;
    const responses = await this.api.listResponses(token, googleFormId, since);

    const known = new Set(questions.map((q) => q.id));
    const hasUnknown = responses.some((r) => Object.keys(r.answers ?? {}).some((id) => !known.has(id)));
    let titlesChanged = false;
    if (hasUnknown) {
      const doc = await this.api.getForm(token, googleFormId);
      questions = questionsFromDoc(doc.items);
      titlesChanged = true;
    }

    // Store every response first; a throw here leaves the cursor where it was.
    for (const response of responses) {
      await this.submissions.ingestResponse(form, response, questions);
    }
    const newest = responses.reduce<Date | null>((max, r) => {
      const at = responseTime(r);
      return !max || at > max ? at : max;
    }, null);

    // Commit the cursor and refreshed titles as soon as the batch is stored, so a failure in the
    // follow-up steps below can never stall ingestion.
    await this.prisma.googleForm.update({
      where: { id: form.id },
      data: {
        lastSyncedAt: new Date(),
        syncError: null,
        ...(newest && { lastResponseAt: newest }),
        ...(titlesChanged && { questionTitles: questions as unknown as Prisma.InputJsonValue }),
      },
    });

    try {
      await this.submissions.retryUnprocessed(form.id);
    } catch (err) {
      this.logger.warn(`Retrying unprocessed submissions failed for form ${form.id}: ${errorMessage(err)}`);
    }

    try {
      const visible = questions.filter((q) => q.id !== form.leadIdQuestionId);
      if (titlesChanged && form.sheetId && form.sheetTab) {
        await this.rewriteHeader(token, form, visible);
      }
      await this.appendPending(token, form, visible);
    } catch (err) {
      this.logger.warn(`Sheet step failed for form ${form.id}: ${errorMessage(err)}`);
    }
    return { synced: responses.length };
  }

  private async rewriteHeader(token: string, form: GoogleForm, visible: QuestionMeta[]): Promise<void> {
    try {
      await this.api.writeHeader(token, form.sheetId as string, form.sheetTab as string, buildSheetHeader(visible));
    } catch (err) {
      this.logger.warn(`Could not update the sheet header for form ${form.id}: ${errorMessage(err)}`);
    }
  }

  // Sheet writes are a separate, retried step: a failure leaves the stored response untouched.
  private async appendPending(token: string, form: GoogleForm, visible: QuestionMeta[]): Promise<void> {
    if (!form.sheetId || !form.sheetTab) return;
    const pending = await this.prisma.formSubmission.findMany({
      where: { orgId: form.orgId, formId: form.id, status: 'PROCESSED', sheetSyncedAt: null },
      orderBy: { submittedAt: 'asc' },
      take: SHEET_BATCH,
      include: { lead: { select: { name: true, isDeleted: true, assignedTo: { select: { name: true } } } } },
    });
    if (pending.length === 0) return;

    const ids = pending.map((p) => p.id);
    const rows = pending.map((p) => {
      // A deleted lead yields a blank name and owner.
      const lead = p.lead && !p.lead.isDeleted ? p.lead : null;
      return buildSheetRow(
        {
          submittedAt: p.submittedAt,
          leadName: lead?.name ?? null,
          ownerName: lead?.assignedTo?.name ?? null,
          answers: p.answers as Record<string, string>,
        },
        visible,
      );
    });
    try {
      await this.api.appendRows(token, form.sheetId, form.sheetTab, rows);
      await this.prisma.formSubmission.updateMany({
        where: { id: { in: ids } },
        data: { sheetSyncedAt: new Date(), sheetError: null },
      });
    } catch (err) {
      try {
        await this.prisma.formSubmission.updateMany({ where: { id: { in: ids } }, data: { sheetError: errorMessage(err) } });
      } catch (updateErr) {
        this.logger.warn(`Could not record the sheet error for form ${form.id}: ${errorMessage(updateErr)}`);
      }
    }
  }
}
