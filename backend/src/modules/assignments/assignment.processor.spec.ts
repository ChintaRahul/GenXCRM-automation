import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Job } from 'bull';
import { AssignmentProcessor } from './assignment.processor';
import { AssignmentsService } from './assignments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';

const mockPrisma = {
  activity: { create: jest.fn() },
  user: { findUnique: jest.fn() },
  lead: { findMany: jest.fn() },
};

const mockAssignments = {
  assignRoundRobin: jest.fn(),
  assignRoundRobinOrg: jest.fn(),
};

const mockMail = { send: jest.fn() };
const mockBilling = { hasEmailQuota: jest.fn().mockResolvedValue(true), recordEmailSent: jest.fn() };
const mockRedis = { lrange: jest.fn(), del: jest.fn() };
const mockQueue = { client: mockRedis };

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    name: 'assign',
    data: { leadId: 'lead-1', teamId: 'team-1' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    ...overrides,
  }) as unknown as Job;

describe('AssignmentProcessor', () => {
  let processor: AssignmentProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBilling.hasEmailQuota.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        AssignmentProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AssignmentsService, useValue: mockAssignments },
        { provide: MailService, useValue: mockMail },
        { provide: BillingService, useValue: mockBilling },
        { provide: getQueueToken('assignment'), useValue: mockQueue },
      ],
    }).compile();
    processor = module.get(AssignmentProcessor);
  });

  describe('handleAssign', () => {
    it('delegates to AssignmentsService.assignRoundRobin', async () => {
      await processor.handleAssign(makeJob());
      expect(mockAssignments.assignRoundRobin).toHaveBeenCalledWith('lead-1', 'team-1');
      expect(mockAssignments.assignRoundRobinOrg).not.toHaveBeenCalled();
    });

    it('delegates to assignRoundRobinOrg for an org-scoped job (no team)', async () => {
      await processor.handleAssign(makeJob({ data: { leadId: 'lead-1', orgId: 'org-1' } }));
      expect(mockAssignments.assignRoundRobinOrg).toHaveBeenCalledWith('lead-1', 'org-1');
      expect(mockAssignments.assignRoundRobin).not.toHaveBeenCalled();
    });
  });

  describe('handleNotify', () => {
    const notifyJob = makeJob({ name: 'notify', data: { repId: 'rep-1' } as never });

    it('sends one summary email listing every batched lead', async () => {
      mockRedis.lrange.mockResolvedValue(['l1', 'l2', 'l3']);
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'rep@acme.com', name: 'Rep One' });
      mockPrisma.lead.findMany.mockResolvedValue([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);

      await processor.handleNotify(notifyJob);

      expect(mockRedis.del).toHaveBeenCalledWith('assign-notify:rep-1');
      expect(mockMail.send).toHaveBeenCalledTimes(1);
      const [to, subject] = mockMail.send.mock.calls[0];
      expect(to).toBe('rep@acme.com');
      expect(subject).toContain('3 new leads');
    });

    it('uses singular subject for a single lead', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'rep@acme.com', name: 'Rep One' });
      mockPrisma.lead.findMany.mockResolvedValue([{ name: 'A' }]);

      await processor.handleNotify(notifyJob);

      expect(mockMail.send.mock.calls[0][1]).toBe('You have a new lead');
    });

    it('does not email when the list is empty', async () => {
      mockRedis.lrange.mockResolvedValue([]);
      await processor.handleNotify(notifyJob);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('does not email when the rep has no email', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({ email: null, name: 'Rep One' });
      await processor.handleNotify(notifyJob);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('does not email when every batched lead was deleted', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'rep@acme.com', name: 'Rep One' });
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await processor.handleNotify(notifyJob);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('does not email when the rep org has opted out of assignment notifications', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'rep@acme.com',
        name: 'Rep One',
        org: { notifyRepOnAssignment: false },
      });
      await processor.handleNotify(notifyJob);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('does not email when notificationSettings.newLeadAssigned.email is off, even if notifyRepOnAssignment is on', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'rep@acme.com',
        name: 'Rep One',
        org: { notifyRepOnAssignment: true, notificationSettings: { newLeadAssigned: { email: false } } },
      });
      await processor.handleNotify(notifyJob);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('still emails when notificationSettings is unset (defaults to on)', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'rep@acme.com',
        name: 'Rep One',
        orgId: 'org-1',
        org: { notifyRepOnAssignment: true, notificationSettings: null },
      });
      mockPrisma.lead.findMany.mockResolvedValue([{ name: 'A' }]);
      await processor.handleNotify(notifyJob);
      expect(mockMail.send).toHaveBeenCalledTimes(1);
    });

    it('does not email when the rep org has exhausted its email quota', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'rep@acme.com',
        name: 'Rep One',
        orgId: 'org-1',
        org: { notifyRepOnAssignment: true },
      });
      mockBilling.hasEmailQuota.mockResolvedValue(false);

      await processor.handleNotify(notifyJob);

      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('meters a sent assignment notice against the org email quota', async () => {
      mockRedis.lrange.mockResolvedValue(['l1']);
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'rep@acme.com', name: 'Rep One', orgId: 'org-1' });
      mockPrisma.lead.findMany.mockResolvedValue([{ name: 'A' }]);

      await processor.handleNotify(notifyJob);

      expect(mockBilling.recordEmailSent).toHaveBeenCalledWith('org-1');
    });
  });

  describe('handleFailed', () => {
    it('ignores a failed notify job (no leadId to record)', async () => {
      const job = makeJob({ name: 'notify', data: { repId: 'rep-1' } as never, attemptsMade: 3 });
      await processor.handleFailed(job, new Error('boom'));
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });

    it('creates an ASSIGNMENT_FAILED activity once attempts are exhausted', async () => {
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
      await processor.handleFailed(job, new Error('boom'));
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ leadId: 'lead-1', type: 'ASSIGNMENT_FAILED' }),
        }),
      );
    });

    it('does not create an activity while retries remain', async () => {
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
      await processor.handleFailed(job, new Error('boom'));
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });
  });
});
