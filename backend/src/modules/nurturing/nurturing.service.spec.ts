import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { NurturingService } from './nurturing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrialService } from '../trial/trial.service';
import { CommunicationsService } from '../communications/communications.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller: AuthUser = {
  id: 'dir-1',
  name: 'Director',
  email: 'dir@test.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

describe('NurturingService', () => {
  let service: NurturingService;
  let prisma: jest.Mocked<PrismaService>;
  let trial: jest.Mocked<TrialService>;
  let comms: {
    sendEmail: jest.Mock;
    sendSms: jest.Mock;
    sendWhatsApp: jest.Mock;
    sendWhatsAppTemplate: jest.Mock;
    resolveAttachments: jest.Mock;
  };

  const mockSeq = {
    id: 'seq-1',
    name: 'Test',
    description: null,
    triggerEvent: 'manual',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockStep = {
    id: 'step-1',
    sequenceId: 'seq-1',
    stepOrder: 0,
    type: 'email',
    subject: 'Hi',
    body: 'Hello',
    delayDays: 0,
    createdAt: new Date(),
  };
  const mockEnrollment = {
    id: 'enr-1',
    sequenceId: 'seq-1',
    leadId: 'lead-1',
    status: 'active',
    currentStep: 0,
    enrolledAt: new Date(),
    completedAt: null,
  };

  beforeEach(async () => {
    comms = {
      sendEmail: jest.fn(),
      sendSms: jest.fn(),
      sendWhatsApp: jest.fn(),
      sendWhatsAppTemplate: jest.fn(),
      resolveAttachments: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NurturingService,
        { provide: TrialService, useValue: { checkLimit: jest.fn() } },
        { provide: CommunicationsService, useValue: comms },
        {
          provide: PrismaService,
          useValue: {
            nurturingSequence: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
            },
            nurturingStep: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            nurturingEnrollment: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            lead: {
              findFirst: jest.fn(),
            },
            messageTemplate: {
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(NurturingService);
    prisma = module.get(PrismaService);
    trial = module.get(TrialService);
  });

  describe('findAll', () => {
    it('returns sequences with counts', async () => {
      (prisma.nurturingSequence.findMany as jest.Mock).mockResolvedValue([mockSeq]);
      const result = await service.findAll(caller);
      expect(result).toHaveLength(1);
      expect(prisma.nurturingSequence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.objectContaining({ _count: expect.anything() }) }),
      );
    });

    it('scopes query to caller orgId', async () => {
      (prisma.nurturingSequence.findMany as jest.Mock).mockResolvedValue([]);
      await service.findAll(caller);
      expect(prisma.nurturingSequence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  describe('findOne', () => {
    it('returns sequence with steps and enrollments', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      const result = await service.findOne('seq-1');
      expect(result.id).toBe('seq-1');
    });

    it('throws NotFoundException when not found', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEnrollments', () => {
    it('throws NotFoundException when the sequence is outside the caller scope', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getEnrollments('seq-1', caller)).rejects.toThrow(NotFoundException);
      expect(prisma.nurturingEnrollment.findMany).not.toHaveBeenCalled();
    });

    it('paginates with defaults (page 1, limit 20) and returns the computed page count', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ id: 'seq-1' });
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([mockEnrollment]);
      (prisma.nurturingEnrollment.count as jest.Mock).mockResolvedValue(45);

      const result = await service.getEnrollments('seq-1', caller);

      expect(prisma.nurturingEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sequenceId: 'seq-1', status: { not: 'removed' } }),
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toEqual({ data: [mockEnrollment], total: 45, page: 1, limit: 20, pages: 3 });
    });

    it('applies skip/take for a requested page and limit', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ id: 'seq-1' });
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.nurturingEnrollment.count as jest.Mock).mockResolvedValue(0);

      await service.getEnrollments('seq-1', caller, 3, 10);

      expect(prisma.nurturingEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('scopes the sequence lookup to caller orgId', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ id: 'seq-1' });
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.nurturingEnrollment.count as jest.Mock).mockResolvedValue(0);

      await service.getEnrollments('seq-1', caller);

      expect(prisma.nurturingSequence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'seq-1', orgId: 'org-1' }) }),
      );
    });
  });

  describe('create', () => {
    it('creates a sequence with defaults', async () => {
      (prisma.nurturingSequence.create as jest.Mock).mockResolvedValue(mockSeq);
      const result = await service.create({ name: 'Test' }, caller);
      expect(result.name).toBe('Test');
      expect(prisma.nurturingSequence.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ triggerEvent: 'manual' }) }),
      );
    });

    it('counts the org sequences and rejects creation at the 50 cap', async () => {
      (prisma.nurturingSequence.count as jest.Mock).mockResolvedValue(50);
      await expect(service.create({ name: 'Test' }, caller)).rejects.toThrow(ForbiddenException);
      expect(prisma.nurturingSequence.count).toHaveBeenCalledWith({ where: { orgId: 'org-1' } });
      expect(prisma.nurturingSequence.create).not.toHaveBeenCalled();
    });

    it('does not apply the plan limit when creating an inactive sequence', async () => {
      (prisma.nurturingSequence.create as jest.Mock).mockResolvedValue(mockSeq);
      await service.create({ name: 'Test' }, caller);
      expect(trial.checkLimit).not.toHaveBeenCalled();
    });

    it('stores orgId from caller on new sequence', async () => {
      (prisma.nurturingSequence.create as jest.Mock).mockResolvedValue(mockSeq);
      await service.create({ name: 'Test' }, caller);
      expect(prisma.nurturingSequence.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  describe('enrollLead', () => {
    beforeEach(() => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({ id: 'lead-1' });
    });

    it('throws NotFoundException when the lead is outside the caller scope', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.enrollLead('seq-1', 'lead-1', caller)).rejects.toThrow(NotFoundException);
      expect(prisma.nurturingEnrollment.create).not.toHaveBeenCalled();
    });

    it('creates enrollment when no existing', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue(mockStep);
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingEnrollment.create as jest.Mock).mockResolvedValue(mockEnrollment);
      const result = await service.enrollLead('seq-1', 'lead-1', caller);
      expect(result.status).toBe('active');
    });

    it('schedules nextRunAt from the first step delayDays', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue({ ...mockStep, delayDays: 2 });
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingEnrollment.create as jest.Mock).mockResolvedValue(mockEnrollment);
      const before = Date.now();
      await service.enrollLead('seq-1', 'lead-1', caller);
      const { data } = (prisma.nurturingEnrollment.create as jest.Mock).mock.calls[0][0];
      expect(data.status).toBe('active');
      expect(data.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 24 * 60 * 60 * 1000 - 1000);
    });

    it('completes immediately when the sequence has no steps', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingEnrollment.create as jest.Mock).mockResolvedValue(mockEnrollment);
      await service.enrollLead('seq-1', 'lead-1', caller);
      const { data } = (prisma.nurturingEnrollment.create as jest.Mock).mock.calls[0][0];
      expect(data.status).toBe('completed');
      expect(data.nextRunAt).toBeNull();
    });

    it('throws ConflictException when already enrolled', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(mockEnrollment);
      await expect(service.enrollLead('seq-1', 'lead-1', caller)).rejects.toThrow(ConflictException);
    });

    it('re-enrolls a previously removed lead', async () => {
      const removed = { ...mockEnrollment, status: 'removed' };
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue(mockStep);
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(removed);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({ ...removed, status: 'active' });
      const result = await service.enrollLead('seq-1', 'lead-1', caller);
      expect(result.status).toBe('active');
      expect(prisma.nurturingEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'enr-1' } }),
      );
    });
  });

  describe('autoEnroll', () => {
    it('enrolls the lead into matching active sequences', async () => {
      (prisma.nurturingSequence.findMany as jest.Mock).mockResolvedValue([{ id: 'seq-1' }]);
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue(mockStep);
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingEnrollment.create as jest.Mock).mockResolvedValue(mockEnrollment);

      await service.autoEnroll('lead-1', 'org-1', 'lead_created');

      expect(prisma.nurturingSequence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, triggerEvent: 'lead_created', orgId: 'org-1' }),
        }),
      );
      expect(prisma.nurturingEnrollment.create).toHaveBeenCalledTimes(1);
    });

    it('skips a sequence the lead is already actively enrolled in', async () => {
      (prisma.nurturingSequence.findMany as jest.Mock).mockResolvedValue([{ id: 'seq-1' }]);
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(mockEnrollment);

      await service.autoEnroll('lead-1', 'org-1', 'lead_created');

      expect(prisma.nurturingEnrollment.create).not.toHaveBeenCalled();
      expect(prisma.nurturingEnrollment.update).not.toHaveBeenCalled();
    });

    it('filters stage_change sequences to ones whose triggerStage matches or is unset', async () => {
      (prisma.nurturingSequence.findMany as jest.Mock).mockResolvedValue([{ id: 'seq-1' }]);
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue(mockStep);
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingEnrollment.create as jest.Mock).mockResolvedValue(mockEnrollment);

      await service.autoEnroll('lead-1', 'org-1', 'stage_change', 'DEMO_SCHEDULED');

      expect(prisma.nurturingSequence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            triggerEvent: 'stage_change',
            orgId: 'org-1',
            OR: [{ triggerStage: null }, { triggerStage: 'DEMO_SCHEDULED' }],
          }),
        }),
      );
    });
  });

  describe('autoEnroll — immediate sends', () => {
    const emailStep = { type: 'email', subject: 'Hi', body: 'Hello', delayDays: 0 };
    const waStep = { type: 'sms', subject: null, body: 'Txt', delayDays: 0 };
    const enrollmentWith = (steps: unknown[]) => ({
      id: 'enr-1',
      status: 'active',
      leadId: 'lead-1',
      currentStep: 0,
      lead: null,
      sequence: { isActive: true, steps },
    });
    const setup = (steps: { delayDays: number }[], loaded: unknown) => {
      (prisma.nurturingSequence.findMany as jest.Mock).mockResolvedValue([{ id: 'seq-1' }]);
      (prisma.nurturingStep.findFirst as jest.Mock).mockResolvedValue(steps[0]);
      (prisma.nurturingEnrollment.create as jest.Mock).mockResolvedValue({ id: 'enr-1' });
      (prisma.nurturingEnrollment.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(loaded);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});
    };

    it('sends consecutive delay-0 steps right away and completes the enrollment', async () => {
      setup([emailStep], enrollmentWith([emailStep, waStep]));

      await service.autoEnroll('lead-1', 'org-1', 'lead_created');

      expect(comms.sendEmail).toHaveBeenCalledTimes(1);
      expect(comms.sendSms).toHaveBeenCalledTimes(1);
      const updates = (prisma.nurturingEnrollment.update as jest.Mock).mock.calls.map((c) => c[0].data);
      expect(updates[0].currentStep).toBe(1); // leased so the tick can't double-send
      expect(updates[0].nextRunAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
      expect(updates[1]).toEqual(expect.objectContaining({ status: 'completed', currentStep: 2 }));
    });

    it('leases the new enrollment so the tick cannot pick it up while it runs', async () => {
      setup([emailStep], null);
      await service.autoEnroll('lead-1', 'org-1', 'lead_created');
      const { data } = (prisma.nurturingEnrollment.create as jest.Mock).mock.calls[0][0];
      expect(data.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    });

    it('stops at the first delayed step and schedules it', async () => {
      const delayed = { type: 'sms', subject: null, body: 'Later', delayDays: 2 };
      setup([emailStep], enrollmentWith([emailStep, delayed]));

      const before = Date.now();
      await service.autoEnroll('lead-1', 'org-1', 'lead_created');

      expect(comms.sendEmail).toHaveBeenCalledTimes(1);
      expect(comms.sendSms).not.toHaveBeenCalled();
      const { data } = (prisma.nurturingEnrollment.update as jest.Mock).mock.calls[0][0];
      expect(data.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 24 * 60 * 60 * 1000 - 1000);
    });

    it('leaves sends to the tick when immediate is false (bulk import)', async () => {
      setup([emailStep], enrollmentWith([emailStep]));

      const before = Date.now();
      await service.autoEnroll('lead-1', 'org-1', 'lead_created', undefined, false);

      expect(comms.sendEmail).not.toHaveBeenCalled();
      const { data } = (prisma.nurturingEnrollment.create as jest.Mock).mock.calls[0][0];
      expect(data.nextRunAt.getTime()).toBeLessThan(before + 5_000); // due on the next tick
    });

    it('does not throw when the immediate send fails', async () => {
      setup([emailStep], enrollmentWith([emailStep]));
      comms.sendEmail.mockRejectedValue(new Error('smtp down'));
      await expect(service.autoEnroll('lead-1', 'org-1', 'lead_created')).resolves.toBeUndefined();
    });
  });

  describe('createDefaultWelcomeSequence', () => {
    it('creates a lead_created email sequence when none exists', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.nurturingSequence.create as jest.Mock).mockResolvedValue(mockSeq);

      await service.createDefaultWelcomeSequence('org-1');

      expect(prisma.nurturingSequence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            triggerEvent: 'lead_created',
            isActive: false,
            orgId: 'org-1',
            steps: expect.objectContaining({
              create: expect.arrayContaining([expect.objectContaining({ type: 'email', stepOrder: 0 })]),
            }),
          }),
        }),
      );
    });

    it('is idempotent — skips creation if a lead_created sequence already exists', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ id: 'seq-1' });
      await service.createDefaultWelcomeSequence('org-1');
      expect(prisma.nurturingSequence.create).not.toHaveBeenCalled();
    });
  });

  describe('executeDueEnrollments', () => {
    const enrollmentWith = (steps: unknown[], currentStep = 0, lead: unknown = null) => ({
      id: 'enr-1',
      leadId: 'lead-1',
      currentStep,
      lead,
      sequence: { isActive: true, steps },
    });

    it('sends the current step via the matching channel and advances to the next step', async () => {
      const steps = [
        { type: 'email', subject: 'Hi', body: 'Hello', delayDays: 0 },
        { type: 'sms', subject: null, body: 'Txt', delayDays: 3 },
      ];
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      const before = Date.now();
      const result = await service.executeDueEnrollments();

      expect(comms.sendEmail).toHaveBeenCalledWith('lead-1', 'Hi', 'Hello', expect.objectContaining({ id: 'nurturing-engine' }), undefined, undefined);
      const { data } = (prisma.nurturingEnrollment.update as jest.Mock).mock.calls[0][0];
      expect(data.currentStep).toBe(1);
      expect(data.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000 - 1000);
      expect(result).toEqual({ processed: 1 });
    });

    it('passes the email step attachmentIds through to sendEmail', async () => {
      const steps = [{ type: 'email', subject: 'Hi', body: 'Hello', delayDays: 0, attachmentIds: ['att-1', 'att-2'] }];
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendEmail).toHaveBeenCalledWith(
        'lead-1',
        'Hi',
        'Hello',
        expect.objectContaining({ id: 'nurturing-engine' }),
        undefined,
        ['att-1', 'att-2'],
      );
    });

    it('caps each tick to NURTURING_BATCH_SIZE due enrollments, oldest-due first', async () => {
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([]);

      await service.executeDueEnrollments();

      expect(prisma.nurturingEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: expect.any(Number), orderBy: { nextRunAt: 'asc' } }),
      );
    });

    it('marks the enrollment completed after the last step', async () => {
      const steps = [{ type: 'sms', subject: null, body: 'Bye', delayDays: 0 }];
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendSms).toHaveBeenCalledWith('lead-1', 'Bye', expect.anything());
      const { data } = (prisma.nurturingEnrollment.update as jest.Mock).mock.calls[0][0];
      expect(data.status).toBe('completed');
      expect(data.nextRunAt).toBeNull();
    });

    it('sends a WhatsApp template with interpolated params when templateName is set', async () => {
      const steps = [
        {
          type: 'whatsapp',
          subject: null,
          body: null,
          delayDays: 0,
          templateName: 'welcome_offer',
          templateLang: 'en_US',
          templateParams: ['{{name}}', '{{course}}'],
        },
      ];
      const lead = { name: 'Asha', course: 'MBA', email: null, phone: '999' };
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0, lead)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendWhatsAppTemplate).toHaveBeenCalledWith(
        'lead-1',
        'welcome_offer',
        'en_US',
        ['Asha', 'MBA'],
        expect.objectContaining({ id: 'nurturing-engine' }),
      );
      expect(comms.sendWhatsApp).not.toHaveBeenCalled();
    });

    it('falls back to free-form WhatsApp when no templateName is set', async () => {
      const steps = [{ type: 'whatsapp', subject: null, body: 'Hi {{name}}', delayDays: 0 }];
      const lead = { name: 'Asha', course: null, email: null, phone: '999' };
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0, lead)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendWhatsApp).toHaveBeenCalledWith('lead-1', 'Hi Asha', expect.anything());
      expect(comms.sendWhatsAppTemplate).not.toHaveBeenCalled();
    });

    it('interpolates {{name}}/{{course}} placeholders from the lead', async () => {
      const steps = [{ type: 'email', subject: 'Hi {{name}}', body: 'About {{course}}', delayDays: 0 }];
      const lead = { name: 'Asha', course: 'MBA', email: 'a@x.com', phone: '999' };
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0, lead)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendEmail).toHaveBeenCalledWith('lead-1', 'Hi Asha', 'About MBA', expect.anything(), undefined, undefined);
    });

    it('replaces placeholders with empty string when the lead field is missing', async () => {
      const steps = [{ type: 'email', subject: 'Hi {{name}}', body: 'Re {{course}}', delayDays: 0 }];
      const lead = { name: 'Asha', course: null, email: null, phone: null };
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0, lead)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendEmail).toHaveBeenCalledWith('lead-1', 'Hi Asha', 'Re ', expect.anything(), undefined, undefined);
    });

    it('interpolates {{rep}}, {{plan}}, {{amount}}, {{payment_link}} from assignedTo and the latest payment', async () => {
      const steps = [
        {
          type: 'email',
          subject: 'Hi {{name}}',
          body: 'Rep: {{rep}}, Plan: {{plan}}, Amount: {{amount}}, Link: {{payment_link}}',
          delayDays: 0,
        },
      ];
      const lead = {
        name: 'Asha',
        course: 'MBA',
        email: 'a@x.com',
        phone: '999',
        assignedTo: { name: 'Rohan' },
        payments: [{ amount: 25000, paymentLink: 'https://rzp.io/i/example' }],
      };
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0, lead)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendEmail).toHaveBeenCalledWith(
        'lead-1',
        'Hi Asha',
        'Rep: Rohan, Plan: MBA, Amount: 25000, Link: https://rzp.io/i/example',
        expect.anything(),
        undefined,
        undefined,
      );
    });

    it('replaces {{rep}}, {{amount}}, {{payment_link}} with empty string when assignedTo/payments are missing', async () => {
      const steps = [{ type: 'email', subject: null, body: 'Rep: {{rep}}, Amount: {{amount}}, Link: {{payment_link}}', delayDays: 0 }];
      const lead = { name: 'Asha', course: null, email: null, phone: null, assignedTo: null, payments: [] };
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0, lead)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendEmail).toHaveBeenCalledWith('lead-1', '', 'Rep: , Amount: , Link: ', expect.anything(), undefined, undefined);
    });

    it("includes assignedTo name and the latest payment (amount, paymentLink) in the lead query", async () => {
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([]);
      await service.executeDueEnrollments();
      expect(prisma.nurturingEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            lead: expect.objectContaining({
              select: expect.objectContaining({
                assignedTo: { select: { name: true } },
                payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { amount: true, paymentLink: true } },
              }),
            }),
          }),
        }),
      );
    });

    it('does not send for wait steps but still advances', async () => {
      const steps = [
        { type: 'wait', subject: null, body: null, delayDays: 0 },
        { type: 'email', subject: 'Next', body: 'Soon', delayDays: 1 },
      ];
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([enrollmentWith(steps, 0)]);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({});

      await service.executeDueEnrollments();

      expect(comms.sendEmail).not.toHaveBeenCalled();
      const { data } = (prisma.nurturingEnrollment.update as jest.Mock).mock.calls[0][0];
      expect(data.currentStep).toBe(1);
    });

    it('only queries active, due enrollments under active sequences', async () => {
      (prisma.nurturingEnrollment.findMany as jest.Mock).mockResolvedValue([]);
      await service.executeDueEnrollments();
      expect(prisma.nurturingEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            nextRunAt: expect.objectContaining({ lte: expect.any(Date) }),
            sequence: { isActive: true },
          }),
        }),
      );
    });
  });

  describe('removeEnrollment', () => {
    it('soft-deletes by setting status to removed', async () => {
      (prisma.nurturingEnrollment.findFirst as jest.Mock).mockResolvedValue(mockEnrollment);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({ ...mockEnrollment, status: 'removed' });
      const result = await service.removeEnrollment('enr-1', caller);
      expect(result.status).toBe('removed');
    });

    it('scopes the lookup to the caller via the lead relation', async () => {
      (prisma.nurturingEnrollment.findFirst as jest.Mock).mockResolvedValue(mockEnrollment);
      (prisma.nurturingEnrollment.update as jest.Mock).mockResolvedValue({ ...mockEnrollment, status: 'removed' });
      await service.removeEnrollment('enr-1', caller);
      expect(prisma.nurturingEnrollment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'enr-1', lead: { orgId: 'org-1' } } }),
      );
    });

    it('throws NotFoundException when enrollment missing or out of scope', async () => {
      (prisma.nurturingEnrollment.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.removeEnrollment('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addStep', () => {
    it('creates a step for an existing sequence', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingStep.create as jest.Mock).mockResolvedValue(mockStep);
      const result = await service.addStep('seq-1', { type: 'email', stepOrder: 0 }, caller);
      expect(result.type).toBe('email');
    });

    it('persists template fields for a whatsapp step referencing an APPROVED template', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue({ id: 'wa-1', status: 'APPROVED' });
      (prisma.nurturingStep.create as jest.Mock).mockResolvedValue(mockStep);
      await service.addStep(
        'seq-1',
        { type: 'whatsapp', stepOrder: 0, templateName: 'welcome_org1_ab12', templateLang: 'en_US', templateParams: ['{{name}}'] },
        caller,
      );
      expect(prisma.nurturingStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'whatsapp',
            templateName: 'welcome_org1_ab12',
            templateParams: ['{{name}}'],
          }),
        }),
      );
    });

    it('rejects a whatsapp step whose template is not APPROVED', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.addStep('seq-1', { type: 'whatsapp', stepOrder: 0, templateName: 'unapproved' }, caller),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.nurturingStep.create).not.toHaveBeenCalled();
    });

    it('validates and persists attachmentIds for an email step', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      comms.resolveAttachments.mockResolvedValue([{ id: 'att-1' }]);
      (prisma.nurturingStep.create as jest.Mock).mockResolvedValue({ ...mockStep, attachmentIds: ['att-1'] });

      await service.addStep('seq-1', { type: 'email', stepOrder: 0, attachmentIds: ['att-1'] }, caller);

      expect(comms.resolveAttachments).toHaveBeenCalledWith(['att-1'], caller);
      expect(prisma.nurturingStep.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attachmentIds: ['att-1'] }) }),
      );
    });

    it('rejects an email step whose attachmentIds do not resolve for the caller org', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      comms.resolveAttachments.mockRejectedValue(new BadRequestException('not found'));

      await expect(
        service.addStep('seq-1', { type: 'email', stepOrder: 0, attachmentIds: ['foreign-att'] }, caller),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.nurturingStep.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('returns updated sequence', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingSequence.update as jest.Mock).mockResolvedValue({ ...mockSeq, name: 'Updated' });
      const result = await service.update('seq-1', { name: 'Updated' }, caller);
      expect(result.name).toBe('Updated');
      expect(prisma.nurturingSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'seq-1' } }),
      );
    });

    it('throws NotFoundException when sequence not found', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' }, caller)).rejects.toThrow(NotFoundException);
    });

    it('checks the plan limit when switching a sequence on', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, isActive: false, steps: [] });
      (prisma.nurturingSequence.update as jest.Mock).mockResolvedValue({ ...mockSeq, isActive: true });
      await service.update('seq-1', { isActive: true }, caller);
      expect(trial.checkLimit).toHaveBeenCalledWith('org-1', 'sequences');
    });

    it('does not re-check the limit for edits to an already-active sequence', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, isActive: true, steps: [] });
      (prisma.nurturingSequence.update as jest.Mock).mockResolvedValue(mockSeq);
      await service.update('seq-1', { isActive: true, name: 'Renamed' }, caller);
      expect(trial.checkLimit).not.toHaveBeenCalled();
    });

    it('blocks activation when the plan limit rejects it', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, isActive: false, steps: [] });
      trial.checkLimit.mockRejectedValue(new ForbiddenException());
      await expect(service.update('seq-1', { isActive: true }, caller)).rejects.toThrow(ForbiddenException);
      expect(prisma.nurturingSequence.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes sequence by id', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue({ ...mockSeq, steps: [], enrollments: [] });
      (prisma.nurturingSequence.delete as jest.Mock).mockResolvedValue(mockSeq);
      await service.remove('seq-1', caller);
      expect(prisma.nurturingSequence.delete).toHaveBeenCalledWith({ where: { id: 'seq-1' } });
    });

    it('throws NotFoundException when sequence not found', async () => {
      (prisma.nurturingSequence.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.remove('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStep', () => {
    it('updates step fields', async () => {
      (prisma.nurturingStep.findUnique as jest.Mock).mockResolvedValue(mockStep);
      (prisma.nurturingStep.update as jest.Mock).mockResolvedValue({ ...mockStep, subject: 'New Subject' });
      const result = await service.updateStep('step-1', { subject: 'New Subject' }, caller);
      expect(result.subject).toBe('New Subject');
      expect(prisma.nurturingStep.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'step-1' } }),
      );
    });

    it('throws NotFoundException when step not found', async () => {
      (prisma.nurturingStep.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.updateStep('missing', {}, caller)).rejects.toThrow(NotFoundException);
    });

    it('rejects attachmentIds that do not resolve for the caller org', async () => {
      (prisma.nurturingStep.findUnique as jest.Mock).mockResolvedValue(mockStep);
      comms.resolveAttachments.mockRejectedValue(new BadRequestException('not found'));
      await expect(
        service.updateStep('step-1', { attachmentIds: ['foreign-att'] }, caller),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.nurturingStep.update).not.toHaveBeenCalled();
    });
  });

  describe('removeStep', () => {
    it('deletes step by id', async () => {
      (prisma.nurturingStep.findUnique as jest.Mock).mockResolvedValue(mockStep);
      (prisma.nurturingStep.delete as jest.Mock).mockResolvedValue(mockStep);
      await service.removeStep('step-1');
      expect(prisma.nurturingStep.delete).toHaveBeenCalledWith({ where: { id: 'step-1' } });
    });

    it('throws NotFoundException when step not found', async () => {
      (prisma.nurturingStep.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.removeStep('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
