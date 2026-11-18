import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PaymentMilestonesService } from './payment-milestones.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { MailService } from '../mail/mail.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockMail = { send: jest.fn().mockResolvedValue(true) };

describe('PaymentMilestonesService', () => {
  let service: PaymentMilestonesService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      paymentMilestone: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      receipt: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      salesOrder: { findFirst: jest.fn() },
      account: { findFirst: jest.fn() },
      contact: { findFirst: jest.fn() },
      fieldPermission: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: { findFirst: jest.fn().mockResolvedValue({ recordAccess: 'ALL' }) },
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PaymentMilestonesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    service = module.get(PaymentMilestonesService);
  });

  describe('findAll', () => {
    it('filters by accountId when passed (for the Account detail page\'s Payments tab)', async () => {
      prisma.paymentMilestone.findMany.mockResolvedValue([]);
      prisma.paymentMilestone.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, accountId: 'A-1' }, salesRep);
      expect(prisma.paymentMilestone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountId: 'A-1' }) }),
      );
    });

    it('scopes to ownerId for SALES_REP', async () => {
      prisma.paymentMilestone.findMany.mockResolvedValue([]);
      prisma.paymentMilestone.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      expect(prisma.paymentMilestone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1' }) }),
      );
    });

    it('filters by salesOrderId when provided (used by SalesOrdersAdapter.getRelated)', async () => {
      prisma.paymentMilestone.findMany.mockResolvedValue([]);
      prisma.paymentMilestone.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, salesOrderId: 'so-1' } as any, manager);
      expect(prisma.paymentMilestone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ salesOrderId: 'so-1' }) }),
      );
    });

    it('scopes to orgId only for MANAGER', async () => {
      prisma.paymentMilestone.findMany.mockResolvedValue([]);
      prisma.paymentMilestone.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, manager);
      const where = prisma.paymentMilestone.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('create', () => {
    const dto = { salesOrderId: 'so-1', accountId: 'a-1', milestone: 'Advance', amount: 1000, dueDate: '2026-10-10' };

    it('rejects a salesOrderId from another org', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('creates with status Not due', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.paymentMilestone.create.mockResolvedValue({ id: 'pm-1' });
      await service.create(dto as any, manager);
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Not due', dueDate: new Date('2026-10-10') }) }),
      );
    });
  });

  describe('update', () => {
    it('rejects a salesOrderId from another org when present', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1' });
      prisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.update('pm-1', { salesOrderId: 'other-org-so' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org when present', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.update('pm-1', { accountId: 'other-org-account' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('converts dueDate when present', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1' });
      prisma.paymentMilestone.update.mockResolvedValue({ id: 'pm-1' });
      await service.update('pm-1', { dueDate: '2026-11-01' } as any, manager);
      expect(prisma.paymentMilestone.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dueDate: new Date('2026-11-01') }) }),
      );
    });

    it('does not touch dueDate when absent', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1' });
      prisma.paymentMilestone.update.mockResolvedValue({ id: 'pm-1' });
      await service.update('pm-1', { invoiceRef: 'INV-1' } as any, manager);
      const data = prisma.paymentMilestone.update.mock.calls[0][0].data;
      expect(data.dueDate).toBeUndefined();
    });
  });

  describe('performAction — Record receipt', () => {
    it('requires amt payload', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Due', amount: 1000 });
      await expect(service.performAction('pm-1', 'Record receipt', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('sets status to Partially received when the running total is less than amount', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Due', amount: 1000 });
      prisma.receipt.create.mockResolvedValue({ id: 'r-1', amount: 400, receivedOn: new Date('2026-10-01') });
      prisma.receipt.aggregate.mockResolvedValue({ _sum: { amount: 400 } });
      prisma.paymentMilestone.update.mockResolvedValue({ id: 'pm-1', status: 'Partially received' });
      await service.performAction('pm-1', 'Record receipt', { amt: 400 }, manager);
      expect(prisma.receipt.create).toHaveBeenCalledWith({ data: { paymentMilestoneId: 'pm-1', amount: 400, createdById: 'u2' } });
      expect(prisma.paymentMilestone.update).toHaveBeenCalledWith({
        where: { id: 'pm-1' },
        data: { status: 'Partially received' },
      });
    });

    it('sets status to Received and stamps receivedDate when the running total meets amount', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Partially received', amount: 1000 });
      prisma.receipt.create.mockResolvedValue({ id: 'r-2', amount: 600, receivedOn: new Date('2026-10-05') });
      prisma.receipt.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
      prisma.paymentMilestone.update.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Received' });
      await service.performAction('pm-1', 'Record receipt', { amt: 600 }, manager);
      expect(prisma.paymentMilestone.update).toHaveBeenCalledWith({
        where: { id: 'pm-1' },
        data: { status: 'Received', receivedDate: new Date('2026-10-05') },
      });
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'payments', 'PaymentMilestone', 'pm-1', 'Received in full');
    });

    it('flags an over-payment on the receipt instead of dropping the excess', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Partially received', amount: 1000 });
      prisma.receipt.create.mockResolvedValue({ id: 'r-3', amount: 800, receivedOn: new Date('2026-10-05') });
      prisma.receipt.aggregate.mockResolvedValueOnce({ _sum: { amount: 400 } }).mockResolvedValueOnce({ _sum: { amount: 1200 } });
      prisma.paymentMilestone.update.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Received' });
      await service.performAction('pm-1', 'Record receipt', { amt: 800 }, manager);
      expect(prisma.receipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 800, note: expect.stringContaining('Over-payment of ₹200') }) });
    });

    it('does not stop the SLA-22 timer when only partially received', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Due', amount: 1000 });
      prisma.receipt.create.mockResolvedValue({ id: 'r-1', amount: 400, receivedOn: new Date('2026-10-05') });
      prisma.receipt.aggregate.mockResolvedValue({ _sum: { amount: 400 } });
      prisma.paymentMilestone.update.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Partially received' });
      await service.performAction('pm-1', 'Record receipt', { amt: 400 }, manager);
      expect(mockSlaEngine.stopTimer).not.toHaveBeenCalled();
    });

    it('rejects Record receipt when already Received', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Received', amount: 1000 });
      await expect(service.performAction('pm-1', 'Record receipt', { amt: 100 }, manager)).rejects.toThrow(BadRequestException);
    });

    it('checks status before amt, rejecting without creating receipt', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Received', amount: 1000 });
      await expect(service.performAction('pm-1', 'Record receipt', undefined, manager)).rejects.toThrow(BadRequestException);
      expect(prisma.receipt.create).not.toHaveBeenCalled();
    });
  });

  describe('performAction — Send reminder', () => {
    const dueMilestone = {
      id: 'pm-1', orgId: 'org-1', accountId: 'a-1', status: 'Due', amount: 1000,
      milestone: 'Advance', dueDate: new Date('2026-11-01'),
    };

    it('emails the account\'s first contact with an address on file', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue(dueMilestone);
      prisma.contact.findFirst.mockResolvedValue({ id: 'c-1', name: 'Harish Bansal', email: 'harish@example.com' });
      const result = await service.performAction('pm-1', 'Send reminder', undefined, manager);
      expect(prisma.contact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountId: 'a-1', orgId: 'org-1', email: { not: null } }) }),
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        'harish@example.com',
        expect.stringContaining('Advance'),
        expect.stringContaining('Harish Bansal'),
      );
      expect(result).toMatchObject({ reminderSent: true, reminderSentTo: 'harish@example.com' });
    });

    it('rejects when the milestone is already Received', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ ...dueMilestone, status: 'Received' });
      await expect(service.performAction('pm-1', 'Send reminder', undefined, manager)).rejects.toThrow(BadRequestException);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('rejects when no contact on the account has an email address', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue(dueMilestone);
      prisma.contact.findFirst.mockResolvedValue(null);
      await expect(service.performAction('pm-1', 'Send reminder', undefined, manager)).rejects.toThrow(BadRequestException);
      expect(mockMail.send).not.toHaveBeenCalled();
    });
  });

  describe('getEscalationEvents', () => {
    it('returns overdue-style events when status is Overdue', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Overdue', dueDate: new Date('2026-09-01'), updatedAt: new Date('2026-09-10') });
      const events = await service.getEscalationEvents('pm-1', manager);
      expect(events.length).toBeGreaterThan(1);
    });

    it('returns a single scheduled event otherwise', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1', status: 'Due', dueDate: new Date('2026-10-01'), updatedAt: new Date('2026-09-20') });
      const events = await service.getEscalationEvents('pm-1', manager);
      expect(events).toHaveLength(1);
    });
  });

  describe('getReceipts', () => {
    it('resolves the parent through the org-scoped findOne before querying Receipt', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'pm-1', orgId: 'org-1' });
      prisma.receipt.findMany.mockResolvedValue([]);
      await service.getReceipts('pm-1', { page: 1, limit: 20 }, manager);
      expect(prisma.paymentMilestone.findFirst).toHaveBeenCalled();
      expect(prisma.receipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { paymentMilestoneId: 'pm-1' } }),
      );
    });

    it('throws NotFoundException when the parent milestone is not in the caller org', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue(null);
      await expect(service.getReceipts('pm-1', { page: 1, limit: 20 }, manager)).rejects.toThrow(NotFoundException);
      expect(prisma.receipt.findMany).not.toHaveBeenCalled();
    });

    it('verifies org-scoped findOne check prevents Receipt access outside caller org', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue(null);
      prisma.receipt.findMany.mockResolvedValue([]);
      await expect(service.getReceipts('pm-1', { page: 1, limit: 20 }, manager)).rejects.toThrow(NotFoundException);
      expect(prisma.receipt.findMany).not.toHaveBeenCalled();
    });
  });

  describe('record access scope', () => {
    it('limits a caller whose role has OWN access to their own milestones, inside the org', async () => {
      const accounts = { ...manager, mfgRole: 'ACCOUNTS' } as AuthUser;
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
      prisma.paymentMilestone.findFirst.mockResolvedValue(null);
      await expect(service.findOne('pm-1', accounts)).rejects.toThrow(NotFoundException);
      expect(prisma.paymentMilestone.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: accounts.orgId, ownerId: accounts.id }) }),
      );
    });

    it('does not filter by owner when the role has ALL access', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue(null);
      await expect(service.findOne('pm-1', manager)).rejects.toThrow(NotFoundException);
      const { where } = prisma.paymentMilestone.findFirst.mock.calls[0][0];
      expect(where).not.toHaveProperty('ownerId');
    });
  });

  describe('field security: Payment receipts', () => {
    const restricted = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP, mfgRole: 'SALES_EXECUTIVE' } as AuthUser;
    beforeEach(() => {
      prisma.fieldPermission.findMany.mockResolvedValue([{ fieldLabel: 'Payment receipts' }]);
    });

    it('shows received and balance on a partly paid milestone for an unrestricted role', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'm1', orgId: 'org-1', amount: 300000, dueDate: new Date() });
      prisma.fieldPermission.findMany.mockResolvedValue([]);
      (prisma.receipt as unknown as { groupBy: jest.Mock }).groupBy.mockResolvedValue([{ paymentMilestoneId: 'm1', _sum: { amount: 100000 } }]);
      const record = await service.findOne('m1', manager);
      expect(record).toMatchObject({ received: 100000, balance: 200000 });
    });

    it('masks the milestone amount on a list for a restricted role', async () => {
      prisma.paymentMilestone.findMany.mockResolvedValue([{ id: 'm1', orgId: 'org-1', amount: 300000, milestone: 'Advance' }]);
      prisma.paymentMilestone.count.mockResolvedValue(1);
      const result = await service.findAll({ page: 1, limit: 20 }, restricted);
      expect(result.data[0]).toMatchObject({ id: 'm1', milestone: 'Advance' });
      expect(result.data[0]).not.toHaveProperty('amount');
    });

    it('masks the milestone amount on a single record for a restricted role', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'm1', orgId: 'org-1', amount: 300000, dueDate: new Date() });
      const record = await service.findOne('m1', restricted);
      expect(record).toMatchObject({ id: 'm1' });
      expect(record).not.toHaveProperty('amount');
    });

    it('masks receipt amounts for a restricted role', async () => {
      prisma.paymentMilestone.findFirst.mockResolvedValue({ id: 'm1', orgId: 'org-1', amount: 300000, dueDate: new Date() });
      prisma.receipt.count.mockResolvedValue(1);
      prisma.receipt.findMany.mockResolvedValue([{ id: 'r1', amount: 100000 }]);
      const result = await service.getReceipts('m1', { page: 1, limit: 20 }, restricted);
      expect(result.data).toEqual([{ id: 'r1' }]);
    });
  });
});
