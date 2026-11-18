import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { GoogleFormsService } from './google-forms.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { GoogleApiClient, GoogleApiError } from './google-api.client';
import { GoogleAuthService } from './google-auth.service';
import { resolveEntryId } from './entry-id.util';
import { FormSyncService } from './form-sync.service';

jest.mock('./entry-id.util', () => ({ resolveEntryId: jest.fn().mockResolvedValue('4242') }));

const VIEW_KEYS = ['createdAt', 'id', 'isActive', 'isLegacy', 'lastSubmissionAt', 'lastSyncedAt', 'name', 'syncError'];

const user = (over: Partial<AuthUser>): AuthUser => ({
  id: 'u1', name: 'U', email: 'u@t.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1', ...over,
});

const form = {
  id: 'f1', orgId: 'org-1', name: 'Intake', isActive: true,
  formUrl: 'https://docs.google.com/forms/d/e/abc/viewform', leadIdEntryId: '555',
  googleFormId: 'g-form', responderUri: 'https://docs.google.com/forms/d/e/abc/viewform', leadIdQuestionId: 'q-lead',
  questionTitles: [{ id: 'q-lead', title: 'Lead ID' }], sheetId: 'sheet-1', sheetTab: 'Sheet1',
  lastResponseAt: null, lastSyncedAt: null, syncError: null,
  lastSubmissionAt: null, createdAt: new Date(), updatedAt: new Date(),
};

describe('GoogleFormsService', () => {
  let service: GoogleFormsService;
  let prisma: {
    googleForm: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock; delete: jest.Mock };
    lead: { findFirst: jest.Mock };
    formSubmission: { findMany: jest.Mock };
  };
  let auth: { getAccessToken: jest.Mock };
  let api: {
    getForm: jest.Mock; addShortAnswerQuestion: jest.Mock; createSpreadsheet: jest.Mock;
    getFirstTab: jest.Mock; writeHeader: jest.Mock; getPublicFormHtml: jest.Mock;
  };
  let sync: { syncForm: jest.Mock };
  let comms: { sendEmail: jest.Mock; sendWhatsApp: jest.Mock; sendSms: jest.Mock };

  beforeEach(async () => {
    prisma = {
      googleForm: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
      lead: { findFirst: jest.fn() },
      formSubmission: { findMany: jest.fn() },
    };
    comms = {
      sendEmail: jest.fn().mockResolvedValue({ status: 'sent' }),
      sendWhatsApp: jest.fn().mockResolvedValue({ status: 'sent' }),
      sendSms: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    sync = { syncForm: jest.fn().mockResolvedValue({ synced: 0 }) };
    auth = { getAccessToken: jest.fn().mockResolvedValue('tok') };
    api = {
      getForm: jest.fn(), addShortAnswerQuestion: jest.fn(), createSpreadsheet: jest.fn(),
      getFirstTab: jest.fn(), writeHeader: jest.fn(), getPublicFormHtml: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        GoogleFormsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommunicationsService, useValue: comms },
        { provide: GoogleAuthService, useValue: auth },
        { provide: GoogleApiClient, useValue: api },
        { provide: FormSyncService, useValue: sync },
      ],
    }).compile();
    service = module.get(GoogleFormsService);
  });

  it('rejects callers with no org', async () => {
    await expect(service.listForms(user({ orgId: null }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listForms scopes by orgId and omits questionTitles', async () => {
    prisma.googleForm.findMany.mockResolvedValue([form]);
    const result = await service.listForms(user({}));
    expect(prisma.googleForm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
    );
    expect(result[0]).not.toHaveProperty('questionTitles');
    expect(result[0].isLegacy).toBe(false);
    expect(Object.keys(result[0]).sort()).toEqual(VIEW_KEYS);
  });

  describe('syncNow', () => {
    it('checks the form belongs to the caller org, then runs a rate-limited sync', async () => {
      prisma.googleForm.findFirst.mockResolvedValue(form);
      sync.syncForm.mockResolvedValue({ synced: 2 });
      await expect(service.syncNow('f1', user({ role: Role.SALES_REP }))).resolves.toEqual({ synced: 2 });
      expect(prisma.googleForm.findFirst).toHaveBeenCalledWith({ where: { id: 'f1', orgId: 'org-1' } });
      expect(sync.syncForm).toHaveBeenCalledWith('f1', { minIntervalMs: 15_000 });
    });

    it('throws NotFound for a form outside the org without syncing', async () => {
      prisma.googleForm.findFirst.mockResolvedValue(null);
      await expect(service.syncNow('other', user({}))).rejects.toBeInstanceOf(NotFoundException);
      expect(sync.syncForm).not.toHaveBeenCalled();
    });
  });

  describe('updateForm', () => {
    it('scopes the lookup by id and orgId, and throws NotFound outside the org', async () => {
      prisma.googleForm.findFirst.mockResolvedValue(null);
      await expect(service.updateForm('f1', { name: 'X' }, user({}))).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.googleForm.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'f1', orgId: 'org-1' }) }),
      );
      expect(prisma.googleForm.update).not.toHaveBeenCalled();
    });

    it('blocks re-activating a legacy form but allows deactivating and renaming it', async () => {
      const legacy = { ...form, googleFormId: null };
      prisma.googleForm.findFirst.mockResolvedValue(legacy);
      await expect(service.updateForm('f1', { isActive: true }, user({}))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.googleForm.update).not.toHaveBeenCalled();
      prisma.googleForm.update.mockResolvedValue({ ...legacy, isActive: false });
      await expect(service.updateForm('f1', { isActive: false }, user({}))).resolves.toBeDefined();
      await expect(service.updateForm('f1', { name: 'N' }, user({}))).resolves.toBeDefined();
    });

    it('activates and deactivates a connected form, passing only name/isActive', async () => {
      prisma.googleForm.findFirst.mockResolvedValue(form);
      prisma.googleForm.update.mockResolvedValue(form);
      const r = await service.updateForm('f1', { isActive: true, name: 'N', extra: 'x' } as never, user({}));
      await service.updateForm('f1', { isActive: false }, user({}));
      expect(prisma.googleForm.update.mock.calls[0][0]).toEqual({ where: { id: 'f1' }, data: { name: 'N', isActive: true } });
      expect(prisma.googleForm.update.mock.calls[1][0].data).toEqual({ isActive: false });
      expect(Object.keys(r).sort()).toEqual(VIEW_KEYS);
    });
  });

  describe('deleteForm', () => {
    it('throws NotFound outside the org without deleting', async () => {
      prisma.googleForm.findFirst.mockResolvedValue(null);
      await expect(service.deleteForm('f1', user({}))).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.googleForm.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'f1', orgId: 'org-1' }) }),
      );
      expect(prisma.googleForm.delete).not.toHaveBeenCalled();
    });

    it('deletes a form in the caller org', async () => {
      prisma.googleForm.findFirst.mockResolvedValue(form);
      await service.deleteForm('f1', user({}));
      expect(prisma.googleForm.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });
  });

  describe('sendFormToLead', () => {
    beforeEach(() => {
      prisma.googleForm.findFirst.mockResolvedValue(form);
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-9', name: 'Asha' });
    });

    it('builds a prefilled link and returns it for the LINK channel without sending', async () => {
      const r = await service.sendFormToLead('lead-9', { formId: 'f1', channel: 'LINK' }, user({}));
      expect(r).toEqual({
        sent: false,
        link: 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.555=lead-9',
      });
      expect(comms.sendEmail).not.toHaveBeenCalled();
    });

    it('sends the link by WhatsApp', async () => {
      const r = await service.sendFormToLead('lead-9', { formId: 'f1', channel: 'WHATSAPP' }, user({}));
      expect(comms.sendWhatsApp).toHaveBeenCalledWith('lead-9', expect.stringContaining('entry.555=lead-9'), expect.anything());
      expect(r.sent).toBe(true);
    });

    it('EMAIL reports sent:true and passes subject, prefilled link and caller', async () => {
      const caller = user({});
      const r = await service.sendFormToLead('lead-9', { formId: 'f1', channel: 'EMAIL' }, caller);
      expect(r.sent).toBe(true);
      expect(comms.sendEmail).toHaveBeenCalledWith(
        'lead-9',
        expect.stringContaining('Intake'),
        expect.stringContaining('entry.555=lead-9'),
        caller,
      );
    });

    it('EMAIL reports sent:false with the link when delivery failed', async () => {
      comms.sendEmail.mockResolvedValue({ status: 'failed' });
      const r = await service.sendFormToLead('lead-9', { formId: 'f1', channel: 'EMAIL' }, user({}));
      expect(r.sent).toBe(false);
      expect(r.link).toContain('entry.555=lead-9');
    });

    it('a team-less MANAGER matches no leads', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(
        service.sendFormToLead('lead-9', { formId: 'f1', channel: 'LINK' }, user({ role: Role.MANAGER, teamId: null })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.lead.findFirst.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ orgId: 'org-1', id: { in: [] } }),
      );
    });

    it('scopes the lead lookup by org, isDeleted, and rep ownership', async () => {
      await service.sendFormToLead('lead-9', { formId: 'f1', channel: 'LINK' }, user({ role: Role.SALES_REP, id: 'rep-1' }));
      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'lead-9', orgId: 'org-1', isDeleted: false, assignedToId: 'rep-1' }),
        }),
      );
    });

    it('refuses an inactive form', async () => {
      prisma.googleForm.findFirst.mockResolvedValue({ ...form, isActive: false });
      await expect(
        service.sendFormToLead('lead-9', { formId: 'f1', channel: 'LINK' }, user({})),
      ).rejects.toThrow();
    });

    it('throws NotFound when the lead is not visible to the caller', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(
        service.sendFormToLead('nope', { formId: 'f1', channel: 'LINK' }, user({})),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listSubmissions hierarchy scoping', () => {
    beforeEach(() => prisma.formSubmission.findMany.mockResolvedValue([]));
    const where = () => prisma.formSubmission.findMany.mock.calls[0][0].where;

    it('SALES_REP only sees submissions for own leads', async () => {
      await service.listSubmissions({}, user({ role: Role.SALES_REP, id: 'rep-1' }));
      expect(where()).toEqual(
        expect.objectContaining({ orgId: 'org-1', lead: expect.objectContaining({ assignedToId: 'rep-1', isDeleted: false }) }),
      );
    });

    it('MANAGER is limited to the team', async () => {
      await service.listSubmissions({}, user({ role: Role.MANAGER, teamId: 't1' }));
      expect(where().lead).toEqual(expect.objectContaining({ teamId: 't1' }));
    });

    it('team-less MANAGER sees nothing', async () => {
      await service.listSubmissions({}, user({ role: Role.MANAGER, teamId: null }));
      expect(where().lead).toEqual(expect.objectContaining({ id: { in: [] } }));
    });

    it('DIRECTOR sees the whole org including unmatched submissions', async () => {
      await service.listSubmissions({ formId: 'f1' }, user({}));
      expect(where()).toEqual(expect.objectContaining({ orgId: 'org-1', formId: 'f1' }));
      expect(where().lead).toBeUndefined();
    });
  });

  describe('connectForm', () => {
    const doc = {
      formId: 'g-form',
      info: { title: 'Admissions' },
      responderUri: 'https://docs.google.com/forms/d/e/abc/viewform',
      items: [
        { itemId: 'a', title: 'Course', questionItem: { question: { questionId: 'q-course' } } },
        { itemId: 'b', title: ' lead id ', questionItem: { question: { questionId: 'q-lead' } } },
      ],
    };

    beforeEach(() => {
      prisma.googleForm.findFirst.mockResolvedValue(null);
      prisma.googleForm.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...form, ...data, id: 'new-1' }));
      api.getForm.mockResolvedValue(doc);
      api.createSpreadsheet.mockResolvedValue({ spreadsheetId: 'new-sheet', tab: 'Sheet1' });
      api.getFirstTab.mockResolvedValue('Data');
      (resolveEntryId as jest.Mock).mockClear();
    });

    it('rejects callers with no org, and requires exactly one sheet choice', async () => {
      await expect(service.connectForm({ googleFormId: 'g', createSheet: true }, user({ orgId: null }))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.connectForm({ googleFormId: 'g' }, user({}))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.connectForm({ googleFormId: 'g', googleSheetId: 's', createSheet: true }, user({}))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('scopes the duplicate check by org and refuses a form that is already connected', async () => {
      prisma.googleForm.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.googleForm.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', googleFormId: 'g-form' } }),
      );
    });

    it('reuses an existing Lead ID question, creates a sheet, writes the header and saves the form', async () => {
      const view = await service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}));

      expect(auth.getAccessToken).toHaveBeenCalledWith('org-1');
      expect(api.addShortAnswerQuestion).not.toHaveBeenCalled();
      expect(resolveEntryId).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q-lead', title: 'Lead ID' }));
      expect(api.createSpreadsheet).toHaveBeenCalledWith('tok', 'Admissions — GenXCRM responses');
      expect(api.writeHeader).toHaveBeenCalledWith('tok', 'new-sheet', 'Sheet1', ['Submitted at', 'Lead name', 'Lead owner', 'Course']);

      const data = prisma.googleForm.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        orgId: 'org-1', googleFormId: 'g-form', name: 'Admissions', formUrl: doc.responderUri,
        responderUri: doc.responderUri, leadIdQuestionId: 'q-lead', leadIdEntryId: '4242',
        sheetId: 'new-sheet', sheetTab: 'Sheet1',
        questionTitles: [{ id: 'q-course', title: 'Course' }, { id: 'q-lead', title: ' lead id ' }],
      });
      expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
      expect(view.isLegacy).toBe(false);
      expect(sync.syncForm).toHaveBeenCalledWith('new-1');
    });

    it('adds a Lead ID question at the end when the form has none', async () => {
      api.getForm.mockResolvedValue({ ...doc, items: [doc.items[0]] });
      api.addShortAnswerQuestion.mockResolvedValue({ questionId: 'q-new' });
      await service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}));
      expect(api.addShortAnswerQuestion).toHaveBeenCalledWith('tok', 'g-form', 'Lead ID', 1);
      expect(resolveEntryId).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q-new' }));
      expect(prisma.googleForm.create.mock.calls[0][0].data.leadIdQuestionId).toBe('q-new');
    });

    it('attaches a picked sheet, reading its first tab and writing the header there', async () => {
      await service.connectForm({ googleFormId: 'g-form', googleSheetId: 'picked' }, user({}));
      expect(api.getFirstTab).toHaveBeenCalledWith('tok', 'picked');
      expect(api.createSpreadsheet).not.toHaveBeenCalled();
      expect(api.writeHeader).toHaveBeenCalledWith('tok', 'picked', 'Data', expect.any(Array));
      expect(prisma.googleForm.create.mock.calls[0][0].data).toMatchObject({ sheetId: 'picked', sheetTab: 'Data' });
    });

    it('turns Google access errors into friendly messages and saves nothing', async () => {
      api.getForm.mockRejectedValue(new GoogleApiError('not found', 404, 'NOT_FOUND'));
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toBeInstanceOf(BadRequestException);
      api.getForm.mockResolvedValue(doc);
      api.createSpreadsheet.mockRejectedValue(new GoogleApiError('forbidden', 403, 'PERMISSION_DENIED'));
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.googleForm.create).not.toHaveBeenCalled();
    });

    it('fails clearly when no entry id can be derived, including when resolving rejects', async () => {
      (resolveEntryId as jest.Mock).mockResolvedValueOnce(null);
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toThrow();
      (resolveEntryId as jest.Mock).mockRejectedValueOnce(new GoogleApiError('blocked', 400, 'X'));
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toThrow();
      expect(prisma.googleForm.create).not.toHaveBeenCalled();
    });

    it('still connects when the public page fetch rejects but the derived entry id is usable', async () => {
      const actual = jest.requireActual<typeof import('./entry-id.util')>('./entry-id.util');
      (resolveEntryId as jest.Mock).mockImplementationOnce(actual.resolveEntryId);
      api.getPublicFormHtml.mockRejectedValue(new Error('page down'));
      api.getForm.mockResolvedValue({ ...doc, items: [{ ...doc.items[0] }, { title: 'Lead ID', questionItem: { question: { questionId: '0000002a' } } }] });
      await service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}));
      expect(prisma.googleForm.create.mock.calls[0][0].data.leadIdEntryId).toBe('42');
    });

    it('maps a P2002 from create to Conflict and re-throws other errors unchanged', async () => {
      prisma.googleForm.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toBeInstanceOf(ConflictException);
      const boom = new Error('boom');
      prisma.googleForm.create.mockRejectedValueOnce(boom);
      await expect(service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}))).rejects.toBe(boom);
    });

    it('fetches the public page only through the fetchPublicPage callback', async () => {
      api.getPublicFormHtml.mockResolvedValue('<html/>');
      await service.connectForm({ googleFormId: 'g-form', createSheet: true }, user({}));
      const { fetchPublicPage } = (resolveEntryId as jest.Mock).mock.calls[0][0] as { fetchPublicPage: () => Promise<string> };
      await expect(fetchPublicPage()).resolves.toBe('<html/>');
      expect(api.getPublicFormHtml).toHaveBeenCalledWith(doc.responderUri);
    });
  });
});
