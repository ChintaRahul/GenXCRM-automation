import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { FormSubmissionsService } from './form-submissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookService } from '../../integrations/webhook/webhook.service';

describe('FormSubmissionsService', () => {
  let service: FormSubmissionsService;
  let prisma: {
    $transaction: jest.Mock;
    googleForm: { findUnique: jest.Mock; update: jest.Mock };
    formSubmission: { create: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    lead: { findFirst: jest.Mock; update: jest.Mock };
    activity: { create: jest.Mock };
  };
  let webhook: { ingestLead: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      googleForm: { findUnique: jest.fn(), update: jest.fn() },
      formSubmission: { create: jest.fn().mockResolvedValue({ id: 's1' }), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      lead: { findFirst: jest.fn(), update: jest.fn() },
      activity: { create: jest.fn() },
    };
    webhook = { ingestLead: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        FormSubmissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebhookService, useValue: webhook },
      ],
    }).compile();
    service = module.get(FormSubmissionsService);
  });

  describe('ingestResponse', () => {
    const oauthForm = { id: 'f1', orgId: 'org-1', name: 'Intake', leadIdQuestionId: 'q-lead' } as never;
    const questions = [
      { id: 'q-lead', title: 'Lead ID' },
      { id: 'q-name', title: 'Name' },
      { id: 'q-phone', title: 'Mobile Number' },
    ];
    const response = {
      responseId: 'r-1',
      createTime: '2026-09-24T10:00:00Z',
      lastSubmittedTime: '2026-09-24T10:01:00Z',
      answers: {
        'q-lead': { questionId: 'q-lead', textAnswers: { answers: [{ value: ' lead-1 ' }] } },
        'q-name': { questionId: 'q-name', textAnswers: { answers: [{ value: 'Asha' }] } },
        'q-phone': { questionId: 'q-phone', textAnswers: { answers: [{ value: '9876543210' }, { value: 'x' }] } },
      },
    };

    it('stores the raw response first (answers keyed by title, Lead ID kept out of the answers) then processes it inline', async () => {
      prisma.formSubmission.create.mockResolvedValue({ id: 's1' });
      prisma.formSubmission.findUnique.mockResolvedValue({
        id: 's1', orgId: 'org-1', formId: 'f1', status: 'RECEIVED', form: { name: 'Intake' },
        answers: { Name: 'Asha', 'Mobile Number': '9876543210, x' }, rawPayload: { leadId: 'lead-1' },
      });
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });

      await service.ingestResponse(oauthForm, response, questions);

      const data = prisma.formSubmission.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        orgId: 'org-1', formId: 'f1', externalResponseId: 'r-1',
        answers: { Name: 'Asha', 'Mobile Number': '9876543210, x' },
      });
      expect(data.rawPayload).toMatchObject({ leadId: 'lead-1' });
      expect(data.submittedAt).toEqual(new Date('2026-09-24T10:01:00Z'));
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED', leadId: 'lead-1' }) }),
      );
    });

    it('is a no-op for a response that is already stored (P2002) - the retry pass handles unfinished rows', async () => {
      prisma.formSubmission.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await service.ingestResponse(oauthForm, response, questions);
      expect(prisma.formSubmission.findUnique).not.toHaveBeenCalled();
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });

    it('keeps the stored response and marks it FAILED when processing throws', async () => {
      prisma.formSubmission.create.mockResolvedValue({ id: 's1' });
      prisma.formSubmission.findUnique.mockRejectedValue(new Error('db blip'));
      await expect(service.ingestResponse(oauthForm, response, questions)).resolves.toBeUndefined();
      expect(prisma.formSubmission.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'FAILED', error: 'db blip' },
      });
    });

    it('uses the question id as the key when a question is unknown', async () => {
      prisma.formSubmission.create.mockResolvedValue({ id: 's1' });
      prisma.formSubmission.findUnique.mockResolvedValue(null);
      await service.ingestResponse(oauthForm, response, [{ id: 'q-lead', title: 'Lead ID' }]);
      expect(prisma.formSubmission.create.mock.calls[0][0].data.answers).toMatchObject({ 'q-name': 'Asha' });
    });
  });

  describe('retryUnprocessed', () => {
    it('reprocesses RECEIVED and FAILED submissions for the form, scoped by form id', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      prisma.formSubmission.findUnique.mockResolvedValue(null);
      await expect(service.retryUnprocessed('f1')).resolves.toBe(2);
      expect(prisma.formSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { formId: 'f1', status: { in: ['RECEIVED', 'FAILED'] } }, take: 50 }),
      );
      expect(prisma.formSubmission.findUnique).toHaveBeenCalledTimes(2);
    });
  });


  describe('processSubmission', () => {
    const submission = (over = {}) => ({
      id: 's1', orgId: 'org-1', formId: 'f1', status: 'RECEIVED',
      answers: { Name: 'Asha', 'Mobile Number': '9876543210', Email: 'a@x.com' },
      rawPayload: { leadId: 'lead-1' }, form: { name: 'Intake' }, ...over,
    });

    it('is a no-op for an already processed submission', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission({ status: 'PROCESSED' }));
      await service.processSubmission('s1');
      expect(prisma.formSubmission.update).not.toHaveBeenCalled();
    });

    it('reprocesses a FAILED submission and clears the error', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission({ status: 'FAILED', error: 'old' }));
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      await service.processSubmission('s1');
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED', error: null }) }),
      );
    });

    it('links the lead named by Lead ID, scoped to the form org', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission());
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      await service.processSubmission('s1');
      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'lead-1', orgId: 'org-1', isDeleted: false }) }),
      );
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-1', status: 'PROCESSED' }) }),
      );
      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-1', type: 'FORM_SUBMITTED' }) }),
      );
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lead-1' }, data: { activityAt: expect.any(Date) } }),
      );
      expect(prisma.googleForm.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f1' }, data: { lastSubmissionAt: expect.any(Date) } }),
      );
    });

    it('ignores a Lead ID from another org and falls back to phone/email in the same org', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission());
      prisma.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'lead-7' });
      await service.processSubmission('s1');
      const fallbackWhere = prisma.lead.findFirst.mock.calls[1][0].where;
      expect(fallbackWhere).toEqual(expect.objectContaining({ orgId: 'org-1', isDeleted: false }));
      expect(fallbackWhere.OR).toEqual(expect.arrayContaining([{ phone: { endsWith: '9876543210' } }, { email: 'a@x.com' }]));
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-7' }) }),
      );
    });

    it('creates a new lead through WebhookService when nothing matches', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission({ rawPayload: { leadId: '' } }));
      prisma.lead.findFirst.mockResolvedValue(null);
      webhook.ingestLead.mockResolvedValue({ id: 'lead-new' });
      await service.processSubmission('s1');
      expect(webhook.ingestLead).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Asha', phone: '9876543210', email: 'a@x.com' }),
        'org-1',
      );
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-new' }) }),
      );
    });

    it('links the existing lead when ingestLead reports a duplicate', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission({ rawPayload: { leadId: '' } }));
      prisma.lead.findFirst.mockResolvedValue(null);
      webhook.ingestLead.mockResolvedValue({ duplicate: true, leadId: 'lead-dup' });
      await service.processSubmission('s1');
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-dup' }) }),
      );
    });

    it('coerces non-string answers without throwing and still uses the digits', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(
        submission({ answers: { Name: 'Asha', 'Mobile Number': 9876543210 }, rawPayload: {} }),
      );
      prisma.lead.findFirst.mockResolvedValue(null);
      webhook.ingestLead.mockResolvedValue({ id: 'lead-num' });
      await expect(service.processSubmission('s1')).resolves.toBeUndefined();
      expect(webhook.ingestLead).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9876543210' }),
        'org-1',
      );
    });

    it('marks processed without a lead when there is no phone to create one from', async () => {
      prisma.formSubmission.findUnique.mockResolvedValue(submission({ answers: { Course: 'MBA' }, rawPayload: {} }));
      await service.processSubmission('s1');
      expect(webhook.ingestLead).not.toHaveBeenCalled();
      expect(prisma.formSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: null, status: 'PROCESSED' }) }),
      );
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });
  });

  it('markFailed never throws when the update fails', async () => {
    prisma.formSubmission.update.mockRejectedValue(new Error('db down'));
    await expect(service.markFailed('s1', 'boom')).resolves.toBeUndefined();
  });

  it('runs the four writes in a single transaction for a matched lead', async () => {
    prisma.formSubmission.findUnique.mockResolvedValue({
      id: 's1', orgId: 'org-1', formId: 'f1', status: 'RECEIVED',
      answers: { Name: 'Asha' }, rawPayload: { leadId: 'lead-1' }, form: { name: 'Intake' },
    });
    prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
    await service.processSubmission('s1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(4);
  });

  it('runs only the submission and form writes in the transaction when there is no lead', async () => {
    prisma.formSubmission.findUnique.mockResolvedValue({
      id: 's1', orgId: 'org-1', formId: 'f1', status: 'RECEIVED',
      answers: { Course: 'MBA' }, rawPayload: {}, form: { name: 'Intake' },
    });
    await service.processSubmission('s1');
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('rejects when activity.create fails so the job can retry', async () => {
    prisma.formSubmission.findUnique.mockResolvedValue({
      id: 's1', orgId: 'org-1', formId: 'f1', status: 'RECEIVED',
      answers: {}, rawPayload: { leadId: 'lead-1' }, form: { name: 'Intake' },
    });
    prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
    prisma.activity.create.mockRejectedValue(new Error('boom'));
    await expect(service.processSubmission('s1')).rejects.toThrow('boom');
  });

  it('markFailed records the error on the submission', async () => {
    await service.markFailed('s1', 'boom');
    expect(prisma.formSubmission.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'FAILED', error: 'boom' },
    });
  });
});
