import { Test } from '@nestjs/testing';
import { MfgNurturingService } from './mfg-nurturing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';

describe('MfgNurturingService', () => {
  let service: MfgNurturingService;
  let prisma: any;
  const comms = { sendEmailToAddress: jest.fn() };

  const lead = { id: 'l-1', orgId: 'org-1', contactName: 'Meera', company: 'Acme', email: 'm@acme.in', phone: '98220', ownerId: 'u1' };
  const sequence = (steps: object[]) => ({ id: 's-1', steps });
  const enrollment = (steps: object[], currentStep = 0) => ({
    id: 'e-1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'l-1', currentStep,
    sequence: { steps },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      nurturingSequence: { findMany: jest.fn() },
      mfgNurtureEnrollment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      mfgLead: { findFirst: jest.fn().mockResolvedValue(lead) },
      mfgActivity: { create: jest.fn() },
      messageTemplate: { findFirst: jest.fn() },
      opportunity: { findFirst: jest.fn() },
      quotation: { findFirst: jest.fn() },
      coverage: { findFirst: jest.fn() },
      contact: { findFirst: jest.fn() },
      account: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [MfgNurturingService, { provide: PrismaService, useValue: prisma }, { provide: CommunicationsService, useValue: comms }],
    }).compile();
    service = module.get(MfgNurturingService);
  });

  describe('enroll', () => {
    it('enrols into every active sequence of the org with the trigger, after the first step delay', async () => {
      prisma.nurturingSequence.findMany.mockResolvedValue([{ ...sequence([{ delayDays: 2 }]) }]);
      prisma.mfgNurtureEnrollment.findUnique.mockResolvedValue(null);
      await service.enroll('org-1', 'mfg_lead_created', 'MfgLead', 'l-1');
      expect(prisma.nurturingSequence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-1', isActive: true, triggerEvent: 'mfg_lead_created' } }));
      const { data } = prisma.mfgNurtureEnrollment.create.mock.calls[0][0];
      expect(data).toMatchObject({ orgId: 'org-1', sequenceId: 's-1', entityType: 'MfgLead', entityId: 'l-1', status: 'active', currentStep: 0 });
      expect(Math.round((data.nextRunAt.getTime() - Date.now()) / 86_400_000)).toBe(2);
    });

    it('does not enrol twice while already active, but re-activates a finished one', async () => {
      prisma.nurturingSequence.findMany.mockResolvedValue([sequence([{ delayDays: 0 }])]);
      prisma.mfgNurtureEnrollment.findUnique.mockResolvedValueOnce({ id: 'e-9', status: 'active' });
      await service.enroll('org-1', 'quotation_sent', 'Quotation', 'q-1');
      expect(prisma.mfgNurtureEnrollment.create).not.toHaveBeenCalled();
      expect(prisma.mfgNurtureEnrollment.update).not.toHaveBeenCalled();
      prisma.mfgNurtureEnrollment.findUnique.mockResolvedValueOnce({ id: 'e-9', status: 'completed' });
      await service.enroll('org-1', 'quotation_sent', 'Quotation', 'q-1');
      expect(prisma.mfgNurtureEnrollment.update).toHaveBeenCalledWith({ where: { id: 'e-9' }, data: expect.objectContaining({ status: 'active', currentStep: 0 }) });
    });

    it('skips sequences without steps', async () => {
      prisma.nurturingSequence.findMany.mockResolvedValue([sequence([])]);
      await service.enroll('org-1', 'mfg_lead_created', 'MfgLead', 'l-1');
      expect(prisma.mfgNurtureEnrollment.create).not.toHaveBeenCalled();
    });

    it('never throws into the action that triggered it', async () => {
      prisma.nurturingSequence.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.enroll('org-1', 'mfg_lead_created', 'MfgLead', 'l-1')).resolves.toBeUndefined();
    });
  });

  it('endEnrollments stops every active sequence for the record', async () => {
    await service.endEnrollments('org-1', 'MfgLead', 'l-1');
    expect(prisma.mfgNurtureEnrollment.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', entityType: 'MfgLead', entityId: 'l-1', status: 'active' },
      data: { status: 'removed', nextRunAt: null },
    });
  });

  describe('executeDue', () => {
    it('sends the email through the org setup and logs it as a completed activity on the lead', async () => {
      const steps = [{ type: 'email', subject: 'Hi {{name}}', body: 'Thanks, {{name}} of {{company}}', delayDays: 0 }, { type: 'wait', delayDays: 3 }];
      prisma.mfgNurtureEnrollment.findMany.mockResolvedValue([enrollment(steps)]);
      comms.sendEmailToAddress.mockResolvedValue(true);
      await service.executeDue();
      expect(comms.sendEmailToAddress).toHaveBeenCalledWith('org-1', 'm@acme.in', 'Hi Meera', 'Thanks, Meera of Acme');
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ orgId: 'org-1', type: 'Email', status: 'Completed', outcome: 'Sent', mfgLeadId: 'l-1', ownerId: 'u1' }),
      });
      expect(prisma.mfgNurtureEnrollment.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: expect.objectContaining({ currentStep: 1 }) });
    });

    it('logs a failed send honestly', async () => {
      prisma.mfgNurtureEnrollment.findMany.mockResolvedValue([enrollment([{ type: 'email', subject: 'x', body: 'y', delayDays: 0 }])]);
      comms.sendEmailToAddress.mockResolvedValue(false);
      await service.executeDue();
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: 'Failed' }) });
    });

    it('turns a WhatsApp step into a task for the owner and completes the last step', async () => {
      prisma.mfgNurtureEnrollment.findMany.mockResolvedValue([enrollment([{ type: 'whatsapp', body: 'Hello {{name}}', delayDays: 0 }])]);
      await service.executeDue();
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'WhatsApp', status: 'Open', ownerId: 'u1', notes: 'Hello Meera' }) });
      expect(prisma.mfgNurtureEnrollment.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: expect.objectContaining({ status: 'completed' }) });
    });

    it('does not use a WhatsApp template that Meta has not approved', async () => {
      prisma.mfgNurtureEnrollment.findMany.mockResolvedValue([enrollment([{ type: 'whatsapp', body: 'x', templateName: 'promo', delayDays: 0 }])]);
      prisma.messageTemplate.findFirst.mockResolvedValue({ status: 'PENDING' });
      await service.executeDue();
      expect(prisma.messageTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-1', metaTemplateName: 'promo' } }));
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ subject: expect.stringContaining('not approved') }) });
    });

    it('completes the enrolment when its record is gone', async () => {
      prisma.mfgLead.findFirst.mockResolvedValue(null);
      prisma.mfgNurtureEnrollment.findMany.mockResolvedValue([enrollment([{ type: 'email', subject: 'x', body: 'y', delayDays: 0 }, { type: 'email', delayDays: 1 }])]);
      await service.executeDue();
      expect(comms.sendEmailToAddress).not.toHaveBeenCalled();
      expect(prisma.mfgNurtureEnrollment.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: expect.objectContaining({ status: 'completed' }) });
    });

    it('addresses a quotation reminder to the account contact', async () => {
      prisma.quotation.findFirst.mockResolvedValue({ id: 'q-1', accountId: 'a-1', opportunityId: 'op-1', ownerId: 'u2' });
      prisma.contact.findFirst.mockResolvedValue({ id: 'c-1', name: 'Ravi', email: 'r@acme.in', phone: '1' });
      prisma.account.findFirst.mockResolvedValue({ name: 'Acme' });
      prisma.mfgNurtureEnrollment.findMany.mockResolvedValue([{ ...enrollment([{ type: 'email', subject: 'Quote', body: 'Hi {{name}}', delayDays: 0 }]), entityType: 'Quotation', entityId: 'q-1' }]);
      comms.sendEmailToAddress.mockResolvedValue(true);
      await service.executeDue();
      expect(comms.sendEmailToAddress).toHaveBeenCalledWith('org-1', 'r@acme.in', 'Quote', 'Hi Ravi');
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ opportunityId: 'op-1', accountId: 'a-1', contactId: 'c-1' }) });
    });
  });
});
