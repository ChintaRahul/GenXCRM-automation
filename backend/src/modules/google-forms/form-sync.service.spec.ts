import { Test } from '@nestjs/testing';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { FormSyncService } from './form-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAuthService, GoogleAccessRevokedError } from './google-auth.service';
import { GoogleApiClient, GoogleApiError } from './google-api.client';
import { FormSubmissionsService } from './form-submissions.service';

const baseForm = {
  id: 'f1', orgId: 'org-1', name: 'Intake', isActive: true, googleFormId: 'g-form',
  leadIdQuestionId: 'q-lead', sheetId: 'sheet-1', sheetTab: 'Sheet1', lastResponseAt: null as Date | null,
  questionTitles: [{ id: 'q-lead', title: 'Lead ID' }, { id: 'q-name', title: 'Name' }],
};
const response = (id: string, at: string, qid = 'q-name') => ({
  responseId: id, createTime: at, lastSubmittedTime: at,
  answers: { [qid]: { questionId: qid, textAnswers: { answers: [{ value: 'Asha' }] } } },
});

describe('FormSyncService', () => {
  let service: FormSyncService;
  let prisma: {
    orgIntegration: { findMany: jest.Mock };
    googleForm: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    formSubmission: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let auth: { getAccessToken: jest.Mock };
  let api: { listResponses: jest.Mock; getForm: jest.Mock; appendRows: jest.Mock; writeHeader: jest.Mock };
  let submissions: { ingestResponse: jest.Mock; retryUnprocessed: jest.Mock };

  beforeEach(async () => {
    prisma = {
      orgIntegration: { findMany: jest.fn() },
      googleForm: { findMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ ...baseForm }), update: jest.fn() },
      formSubmission: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    };
    auth = { getAccessToken: jest.fn().mockResolvedValue('tok') };
    api = {
      listResponses: jest.fn().mockResolvedValue([]), getForm: jest.fn(), appendRows: jest.fn(), writeHeader: jest.fn(),
    };
    submissions = { ingestResponse: jest.fn(), retryUnprocessed: jest.fn().mockResolvedValue(0) };
    const module = await Test.createTestingModule({
      providers: [
        FormSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: GoogleAuthService, useValue: auth },
        { provide: GoogleApiClient, useValue: api },
        { provide: FormSubmissionsService, useValue: submissions },
      ],
    }).compile();
    service = module.get(FormSyncService);
  });

  describe('syncForm', () => {
    it('ingests every response, then advances the cursor to the newest one and clears the error', async () => {
      api.listResponses.mockResolvedValue([response('a', '2026-09-24T10:00:00Z'), response('b', '2026-09-24T10:05:00Z')]);
      const result = await service.syncForm('f1');

      expect(result).toEqual({ synced: 2 });
      expect(submissions.ingestResponse).toHaveBeenCalledTimes(2);
      expect(submissions.ingestResponse).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), expect.objectContaining({ responseId: 'a' }), baseForm.questionTitles);
      const data = prisma.googleForm.update.mock.calls.at(-1)?.[0].data;
      expect(data.lastResponseAt).toEqual(new Date('2026-09-24T10:05:00Z'));
      expect(data.syncError).toBeNull();
      expect(data.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('asks Google only for responses since the cursor, minus one second of overlap', async () => {
      prisma.googleForm.findUnique.mockResolvedValue({ ...baseForm, lastResponseAt: new Date('2026-09-24T10:00:00Z') });
      await service.syncForm('f1');
      expect(api.listResponses).toHaveBeenCalledWith('tok', 'g-form', new Date('2026-09-24T09:59:59Z'));
    });

    it('does nothing for an inactive, missing or legacy (no googleFormId) form', async () => {
      prisma.googleForm.findUnique.mockResolvedValueOnce({ ...baseForm, isActive: false });
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 0 });
      prisma.googleForm.findUnique.mockResolvedValueOnce({ ...baseForm, googleFormId: null });
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 0 });
      prisma.googleForm.findUnique.mockResolvedValueOnce(null);
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 0 });
      expect(auth.getAccessToken).not.toHaveBeenCalled();
    });

    it('refetches the form once when a response carries an unknown question id, saves the new titles and rewrites the header', async () => {
      api.listResponses.mockResolvedValue([response('a', '2026-09-24T10:00:00Z', 'q-new')]);
      api.getForm.mockResolvedValue({
        formId: 'g-form', info: { title: 'Intake' }, responderUri: 'x',
        items: [
          { title: 'Lead ID', questionItem: { question: { questionId: 'q-lead' } } },
          { title: 'Name', questionItem: { question: { questionId: 'q-name' } } },
          { title: 'City', questionItem: { question: { questionId: 'q-new' } } },
        ],
      });
      await service.syncForm('f1');

      expect(api.getForm).toHaveBeenCalledTimes(1);
      const data = prisma.googleForm.update.mock.calls.at(-1)?.[0].data;
      expect(data.questionTitles).toEqual([
        { id: 'q-lead', title: 'Lead ID' }, { id: 'q-name', title: 'Name' }, { id: 'q-new', title: 'City' },
      ]);
      expect(api.writeHeader).toHaveBeenCalledWith('tok', 'sheet-1', 'Sheet1', ['Submitted at', 'Lead name', 'Lead owner', 'Name', 'City']);
    });

    it('records a revoked-access error without throwing and without touching the cursor', async () => {
      auth.getAccessToken.mockRejectedValue(new GoogleAccessRevokedError());
      const result = await service.syncForm('f1');
      expect(result.error).toBeDefined();
      expect(api.listResponses).not.toHaveBeenCalled();
      const data = prisma.googleForm.update.mock.calls.at(-1)?.[0].data;
      expect(data.syncError).toBe(result.error);
      expect(data.lastResponseAt).toBeUndefined();
    });

    it('leaves the cursor untouched on a transient Google error and records a short syncError', async () => {
      api.listResponses.mockRejectedValue(new GoogleApiError('x'.repeat(1000), 503, null));
      const result = await service.syncForm('f1');
      expect(result.synced).toBe(0);
      const data = prisma.googleForm.update.mock.calls.at(-1)?.[0].data;
      expect(data.lastResponseAt).toBeUndefined();
      expect(data.syncError.length).toBeLessThanOrEqual(300);
    });

    it('does not advance the cursor when storing a response fails', async () => {
      api.listResponses.mockResolvedValue([response('a', '2026-09-24T10:00:00Z')]);
      submissions.ingestResponse.mockRejectedValue(new Error('db down'));
      const result = await service.syncForm('f1');
      expect(result).toEqual({ synced: 0, error: 'db down' });
      const data = prisma.googleForm.update.mock.calls.at(-1)?.[0].data;
      expect(data.lastResponseAt).toBeUndefined();
      expect(data.syncError).toBe('db down');
    });

    it('never throws even when recording the error fails', async () => {
      auth.getAccessToken.mockRejectedValue(new Error('boom'));
      prisma.googleForm.update.mockRejectedValue(new Error('db down'));
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 0, error: 'boom' });
    });

    it('skips a run while another run of the same form is still in flight', async () => {
      let release: (v: never[]) => void = () => undefined;
      api.listResponses.mockReturnValue(new Promise<never[]>((r) => (release = r)));
      const first = service.syncForm('f1');
      await new Promise((r) => setImmediate(r));
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 0, skipped: true });
      release([]);
      await first;
    });

    it('keeps the committed cursor, titles and cleared error when retryUnprocessed throws', async () => {
      api.listResponses.mockResolvedValue([response('a', '2026-09-24T10:00:00Z')]);
      submissions.retryUnprocessed.mockRejectedValue(new Error('db blip'));
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 1 });
      expect(prisma.googleForm.update).toHaveBeenCalledTimes(1);
      const data = prisma.googleForm.update.mock.calls[0][0].data;
      expect(data.lastResponseAt).toEqual(new Date('2026-09-24T10:00:00Z'));
      expect(data.syncError).toBeNull();
      expect(data.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('still commits the cursor and resolves when the pending-rows query throws', async () => {
      api.listResponses.mockResolvedValue([response('a', '2026-09-24T10:00:00Z')]);
      prisma.formSubmission.findMany.mockRejectedValue(new Error('db blip'));
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 1 });
      const data = prisma.googleForm.update.mock.calls[0][0].data;
      expect(data.lastResponseAt).toEqual(new Date('2026-09-24T10:00:00Z'));
      expect(prisma.googleForm.update).toHaveBeenCalledTimes(1);
    });

    it('still commits the cursor and titles when the header rewrite throws', async () => {
      api.listResponses.mockResolvedValue([response('a', '2026-09-24T10:00:00Z', 'q-new')]);
      api.getForm.mockResolvedValue({
        formId: 'g-form', info: { title: 'Intake' }, responderUri: 'x',
        items: [{ title: 'City', questionItem: { question: { questionId: 'q-new' } } }],
      });
      api.writeHeader.mockRejectedValue(new Error('sheet gone'));
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 1 });
      const data = prisma.googleForm.update.mock.calls[0][0].data;
      expect(data.questionTitles).toEqual([{ id: 'q-new', title: 'City' }]);
      expect(data.lastResponseAt).toEqual(new Date('2026-09-24T10:00:00Z'));
    });

    it('does not let the sheetError write escape syncForm and never writes sheet problems to syncError', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([
        { id: 's1', submittedAt: new Date('2026-09-24T10:00:00Z'), answers: {}, lead: null },
      ]);
      api.appendRows.mockRejectedValue(new Error('sheet gone'));
      prisma.formSubmission.updateMany.mockRejectedValue(new Error('db blip'));
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 0 });
      for (const [{ data }] of prisma.googleForm.update.mock.calls) expect(data.syncError).toBeNull();
    });

    it('ingests responses from every page and the cursor is the max across them', async () => {
      // the client concatenates pages; Google does not guarantee ordering, so newest is not last
      api.listResponses.mockResolvedValue([
        response('p1-a', '2026-09-24T10:09:00Z'), response('p1-b', '2026-09-24T10:01:00Z'),
        response('p2-a', '2026-09-24T10:03:00Z'),
      ]);
      await expect(service.syncForm('f1')).resolves.toEqual({ synced: 3 });
      expect(submissions.ingestResponse).toHaveBeenCalledTimes(3);
      expect(prisma.googleForm.update.mock.calls[0][0].data.lastResponseAt).toEqual(new Date('2026-09-24T10:09:00Z'));
    });

    it('uses createTime for the cursor when a response has no lastSubmittedTime', async () => {
      api.listResponses.mockResolvedValue([{ responseId: 'a', createTime: '2026-09-24T11:00:00Z', answers: {} }]);
      await service.syncForm('f1');
      expect(prisma.googleForm.update.mock.calls[0][0].data.lastResponseAt).toEqual(new Date('2026-09-24T11:00:00Z'));
    });

    it('on a partial ingest failure keeps earlier responses stored, does not move the cursor and sets syncError', async () => {
      api.listResponses.mockResolvedValue([
        response('a', '2026-09-24T10:00:00Z'), response('b', '2026-09-24T10:01:00Z'), response('c', '2026-09-24T10:02:00Z'),
      ]);
      submissions.ingestResponse.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('db down'));
      const result = await service.syncForm('f1');
      expect(result).toEqual({ synced: 0, error: 'db down' });
      expect(submissions.ingestResponse).toHaveBeenCalledTimes(2);
      expect(prisma.googleForm.update).toHaveBeenCalledTimes(1);
      expect(prisma.googleForm.update.mock.calls[0][0].data).toEqual({ syncError: 'db down' });
    });

    it('retries unprocessed submissions on every run', async () => {
      await service.syncForm('f1');
      expect(submissions.retryUnprocessed).toHaveBeenCalledWith('f1');
    });

    it('appends PROCESSED rows to the sheet (Lead ID question excluded) and marks them synced', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([
        { id: 's1', submittedAt: new Date('2026-09-24T10:00:00Z'), answers: { Name: 'Asha' }, lead: { name: 'Asha R', isDeleted: false, assignedTo: { name: 'Rep' } } },
        { id: 's2', submittedAt: new Date('2026-09-24T10:01:00Z'), answers: {}, lead: null },
        { id: 's3', submittedAt: new Date('2026-09-24T10:02:00Z'), answers: {}, lead: { name: 'Gone', isDeleted: true, assignedTo: { name: 'Rep' } } },
      ]);
      await service.syncForm('f1');

      expect(prisma.formSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', formId: 'f1', status: 'PROCESSED', sheetSyncedAt: null } }),
      );
      expect(api.appendRows).toHaveBeenCalledWith('tok', 'sheet-1', 'Sheet1', [
        ['2026-09-24T10:00:00.000Z', 'Asha R', 'Rep', 'Asha'],
        ['2026-09-24T10:01:00.000Z', '', '', ''],
        ['2026-09-24T10:02:00.000Z', '', '', ''],
      ]);
      expect(prisma.formSubmission.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2', 's3'] } },
        data: { sheetSyncedAt: expect.any(Date), sheetError: null },
      });
    });

    it('keeps the response safe and records sheetError when the sheet append fails', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([
        { id: 's1', submittedAt: new Date('2026-09-24T10:00:00Z'), answers: {}, lead: null },
      ]);
      api.appendRows.mockRejectedValue(new Error('sheet gone'));
      const result = await service.syncForm('f1');
      expect(result.error).toBeUndefined();
      expect(prisma.formSubmission.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] } },
        data: { sheetError: 'sheet gone' },
      });
    });

    it('skips a second run inside the minimum interval', async () => {
      await service.syncForm('f1', { minIntervalMs: 15_000 });
      await expect(service.syncForm('f1', { minIntervalMs: 15_000 })).resolves.toEqual({ synced: 0, skipped: true });
      expect(auth.getAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('syncAllActive', () => {
    it('syncs only active OAuth forms of orgs whose Google connection is CONNECTED, and keeps going after one form errors', async () => {
      prisma.orgIntegration.findMany.mockResolvedValue([{ orgId: 'org-1' }]);
      prisma.googleForm.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }]);
      const spy = jest.spyOn(service, 'syncForm')
        .mockResolvedValueOnce({ synced: 0, error: 'boom' })
        .mockRejectedValueOnce(new Error('unexpected'))
        .mockResolvedValueOnce({ synced: 1 });

      await service.syncAllActive();

      expect(prisma.orgIntegration.findMany).toHaveBeenCalledWith({
        where: { provider: IntegrationProvider.GOOGLE_FORMS, status: IntegrationStatus.CONNECTED },
        select: { orgId: true },
      });
      expect(prisma.googleForm.findMany).toHaveBeenCalledWith({
        where: { orgId: { in: ['org-1'] }, isActive: true, googleFormId: { not: null } },
        select: { id: true },
      });
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('does nothing when no org is connected', async () => {
      prisma.orgIntegration.findMany.mockResolvedValue([]);
      await service.syncAllActive();
      expect(prisma.googleForm.findMany).not.toHaveBeenCalled();
    });
  });
});
