import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GoogleForm, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';
import { ErrorMessages } from '../../common/constants/messages';
import type { AuthUser } from '../../common/types/auth-user.type';
import { GoogleApiClient, GoogleApiError, type GoogleFormDoc, type GoogleFormItem } from './google-api.client';
import { GoogleAuthService } from './google-auth.service';
import { FormSyncService, type SyncResult } from './form-sync.service';
import { resolveEntryId } from './entry-id.util';
import { buildSheetHeader, questionsFromDoc, type QuestionMeta } from './form-sheet.util';
import { ConnectGoogleFormDto } from './dto/connect-google-form.dto';
import { UpdateGoogleFormDto } from './dto/update-google-form.dto';
import { SendFormDto } from './dto/send-form.dto';
import { QuerySubmissionsDto } from './dto/query-submissions.dto';

// Only what the UI reads; Google identifiers (form/sheet ids, entry id, links) never leave the server.
export type GoogleFormView = Pick<
  GoogleForm,
  'id' | 'name' | 'isActive' | 'lastSyncedAt' | 'lastSubmissionAt' | 'syncError' | 'createdAt'
> & { isLegacy: boolean };

const SUBMISSIONS_LIMIT = 100;
const SYNC_NOW_MIN_INTERVAL_MS = 15_000;
const LEAD_ID_TITLE = 'Lead ID';
const isLeadIdTitle = (title: string | undefined) => (title ?? '').trim().toLowerCase() === LEAD_ID_TITLE.toLowerCase();

@Injectable()
export class GoogleFormsService {
  private readonly logger = new Logger(GoogleFormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationsService,
    private readonly auth: GoogleAuthService,
    private readonly api: GoogleApiClient,
    private readonly sync: FormSyncService,
  ) {}

  private requireOrg(caller: AuthUser): string {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.googleForms.noOrg);
    return caller.orgId;
  }

  private toView(form: GoogleForm): GoogleFormView {
    const { id, name, isActive, lastSyncedAt, lastSubmissionAt, syncError, createdAt, googleFormId } = form;
    return { id, name, isActive, lastSyncedAt, lastSubmissionAt, syncError, createdAt, isLegacy: googleFormId === null };
  }

  private async findForm(id: string, orgId: string): Promise<GoogleForm> {
    const form = await this.prisma.googleForm.findFirst({ where: { id, orgId } });
    if (!form) throw new NotFoundException(ErrorMessages.googleForms.formNotFound);
    return form;
  }

  // Google refusing access to a picked file is a customer-fixable problem, not a server fault.
  private async googleCall<T>(request: () => Promise<T>, message: string): Promise<T> {
    try {
      return await request();
    } catch (err) {
      if (err instanceof GoogleApiError) throw new BadRequestException(message);
      throw err;
    }
  }

  private async ensureLeadIdQuestion(
    token: string,
    doc: GoogleFormDoc,
  ): Promise<{ questionId: string; items: GoogleFormItem[] }> {
    const items = doc.items ?? [];
    const existing = items.find((item) => item.questionItem && isLeadIdTitle(item.title));
    if (existing?.questionItem) return { questionId: existing.questionItem.question.questionId, items };

    // Google rejects an index beyond the current item count, so append at items.length.
    const { questionId } = await this.googleCall(
      () => this.api.addShortAnswerQuestion(token, doc.formId, LEAD_ID_TITLE, items.length),
      ErrorMessages.googleForms.formUnavailable,
    );
    return {
      questionId,
      items: [...items, { title: LEAD_ID_TITLE, questionItem: { question: { questionId } } }],
    };
  }

  private async prepareSheet(
    token: string,
    dto: ConnectGoogleFormDto,
    formTitle: string,
    questions: QuestionMeta[],
  ): Promise<{ sheetId: string; sheetTab: string }> {
    return this.googleCall(async () => {
      const sheet = dto.createSheet
        ? await this.api.createSpreadsheet(token, `${formTitle} — GenXCRM responses`)
        : { spreadsheetId: dto.googleSheetId as string, tab: await this.api.getFirstTab(token, dto.googleSheetId as string) };
      await this.api.writeHeader(token, sheet.spreadsheetId, sheet.tab, buildSheetHeader(questions));
      return { sheetId: sheet.spreadsheetId, sheetTab: sheet.tab };
    }, ErrorMessages.googleForms.sheetUnavailable);
  }

  async connectForm(dto: ConnectGoogleFormDto, caller: AuthUser): Promise<GoogleFormView> {
    const orgId = this.requireOrg(caller);
    if (Boolean(dto.googleSheetId) === Boolean(dto.createSheet)) {
      throw new BadRequestException(ErrorMessages.googleForms.sheetChoiceRequired);
    }
    const existing = await this.prisma.googleForm.findFirst({
      where: { orgId, googleFormId: dto.googleFormId },
      select: { id: true },
    });
    if (existing) throw new ConflictException(ErrorMessages.googleForms.formAlreadyConnected);

    const token = await this.auth.getAccessToken(orgId);
    const doc = await this.googleCall(() => this.api.getForm(token, dto.googleFormId), ErrorMessages.googleForms.formUnavailable);
    const { questionId, items } = await this.ensureLeadIdQuestion(token, doc);

    // resolveEntryId handles a failed page fetch itself (falls back to the derived id); a throw here is unexpected.
    let entryId: string | null = null;
    try {
      entryId = await resolveEntryId({
        questionId,
        title: LEAD_ID_TITLE,
        fetchPublicPage: () => this.api.getPublicFormHtml(doc.responderUri),
        warn: (message) => this.logger.warn(message),
      });
    } catch (err) {
      this.logger.warn(`Could not resolve Lead ID entry id: ${err instanceof Error ? err.message : 'unknown error'}`);
      entryId = null;
    }
    if (!entryId) throw new BadGatewayException(ErrorMessages.googleForms.entryIdUnavailable);

    const allQuestions = questionsFromDoc(items);
    const visible = allQuestions.filter((q) => q.id !== questionId);
    // Sheet creation (createSheet: true) happens before the DB write, so it is not idempotent: an orphan sheet
    // can remain if the write fails. Adding the Lead ID question above is idempotent (reused by title).
    const sheet = await this.prepareSheet(token, dto, doc.info.title, visible);

    let created: GoogleForm;
    try {
      created = await this.prisma.googleForm.create({
        data: {
          orgId,
          name: doc.info.title,
          formUrl: doc.responderUri,
          leadIdEntryId: entryId,
          googleFormId: dto.googleFormId,
          responderUri: doc.responderUri,
          leadIdQuestionId: questionId,
          questionTitles: allQuestions as unknown as Prisma.InputJsonValue,
          sheetId: sheet.sheetId,
          sheetTab: sheet.sheetTab,
        },
      });
    } catch (err) {
      // A concurrent connect of the same form hits @@unique([orgId, googleFormId]).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(ErrorMessages.googleForms.formAlreadyConnected);
      }
      throw err;
    }
    // First sync in the background; syncForm never throws and records its own errors.
    void this.sync.syncForm(created.id);
    return this.toView(created);
  }

  async syncNow(id: string, caller: AuthUser): Promise<SyncResult> {
    const orgId = this.requireOrg(caller);
    await this.findForm(id, orgId);
    return this.sync.syncForm(id, { minIntervalMs: SYNC_NOW_MIN_INTERVAL_MS });
  }

  async listForms(caller: AuthUser): Promise<GoogleFormView[]> {
    const orgId = this.requireOrg(caller);
    const forms = await this.prisma.googleForm.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    return forms.map((f) => this.toView(f));
  }

  async updateForm(id: string, dto: UpdateGoogleFormDto, caller: AuthUser): Promise<GoogleFormView> {
    const orgId = this.requireOrg(caller);
    const existing = await this.findForm(id, orgId);
    if (existing.googleFormId === null && dto.isActive === true) {
      throw new BadRequestException(ErrorMessages.googleForms.legacyReactivate);
    }
    const data = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    const form = await this.prisma.googleForm.update({ where: { id }, data });
    return this.toView(form);
  }

  // Removes the form and (by cascade) its stored responses.
  async deleteForm(id: string, caller: AuthUser): Promise<void> {
    const orgId = this.requireOrg(caller);
    await this.findForm(id, orgId);
    await this.prisma.googleForm.delete({ where: { id } });
  }

  // Mirrors LeadsService.buildScopeFilter — org boundary first, then role boundary.
  private leadScope(caller: AuthUser, orgId: string): Prisma.LeadWhereInput {
    if (caller.role === Role.SALES_REP) return { orgId, assignedToId: caller.id };
    if (caller.role === Role.MANAGER) {
      // A team-less manager must see nothing, not the whole org.
      return caller.teamId ? { orgId, teamId: caller.teamId } : { orgId, id: { in: [] } };
    }
    return { orgId };
  }

  async sendFormToLead(leadId: string, dto: SendFormDto, caller: AuthUser): Promise<{ link: string; sent: boolean }> {
    const orgId = this.requireOrg(caller);
    const form = await this.findForm(dto.formId, orgId);
    if (!form.isActive) throw new BadRequestException(ErrorMessages.googleForms.inactiveForm);

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, isDeleted: false, ...this.leadScope(caller, orgId) },
      select: { id: true, name: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.googleForms.leadNotFound);

    const separator = form.formUrl.includes('?') ? '&' : '?';
    const link = `${form.formUrl}${separator}usp=pp_url&entry.${form.leadIdEntryId}=${encodeURIComponent(lead.id)}`;
    if (dto.channel === 'LINK') return { link, sent: false };

    const message = `Hi ${lead.name}, please fill out this form: ${link}`;
    const communication =
      dto.channel === 'EMAIL'
        ? await this.comms.sendEmail(lead.id, `Please fill out: ${form.name}`, message, caller)
        : dto.channel === 'WHATSAPP'
          ? await this.comms.sendWhatsApp(lead.id, message, caller)
          : await this.comms.sendSms(lead.id, message, caller);
    return { link, sent: communication.status === 'sent' };
  }

  async listSubmissions(query: QuerySubmissionsDto, caller: AuthUser) {
    const orgId = this.requireOrg(caller);
    const filters = {
      ...(query.formId && { formId: query.formId }),
      ...(query.leadId && { leadId: query.leadId }),
    };
    let where: Prisma.FormSubmissionWhereInput;
    if (caller.role === Role.SALES_REP) {
      where = { orgId, ...filters, lead: { assignedToId: caller.id, isDeleted: false } };
    } else if (caller.role === Role.MANAGER) {
      where = {
        orgId,
        ...filters,
        lead: caller.teamId ? { teamId: caller.teamId, isDeleted: false } : { id: { in: [] }, isDeleted: false },
      };
    } else {
      // `lead: { isDeleted: false }` is deliberately omitted here: a relation filter would hide unmatched
      // submissions (null lead). Reps and managers therefore never see unmatched submissions.
      where = { orgId, ...filters };
    }
    return this.prisma.formSubmission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: SUBMISSIONS_LIMIT,
      include: { form: { select: { name: true } }, lead: { select: { id: true, name: true } } },
    });
  }
}
