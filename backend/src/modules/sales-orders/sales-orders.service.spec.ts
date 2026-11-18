import { Test } from '@nestjs/testing';
import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SalesOrdersService } from './sales-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER, teamId: 'team-1' } as AuthUser;
  const director: AuthUser = { id: 'u3', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;

  beforeEach(async () => {
    prisma = {
      salesOrder: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      orderMilestone: { create: jest.fn(), findMany: jest.fn() },
      mfgActivity: { create: jest.fn() },
      purchaseOrder: { findFirst: jest.fn() },
      account: { findFirst: jest.fn() },
      contact: { findFirst: jest.fn() },
      installedAsset: { create: jest.fn() },
      paymentMilestone: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: { findFirst: jest.fn() },
      fieldPermission: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: PdfService, useValue: { render: jest.fn().mockResolvedValue(Buffer.from('pdf')), fieldBlock: jest.fn(), table: jest.fn() } },
      ],
    }).compile();
    service = module.get(SalesOrdersService);
  });

  describe('findAll', () => {
    it('filters by accountId when passed (for the Account detail page\'s Orders tab)', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([]);
      prisma.salesOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, accountId: 'A-1' }, salesRep);
      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountId: 'A-1' }) }),
      );
    });

    it('scopes to ownerId for SALES_REP', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([]);
      prisma.salesOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1' }) }),
      );
    });

    it('scopes to orgId only for MANAGER', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([]);
      prisma.salesOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, manager);
      const where = prisma.salesOrder.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });

    it('scopes findAll to ownerId for an mfgRole with OWN record access', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
      prisma.salesOrder.count.mockResolvedValue(0);
      prisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, { ...director, mfgRole: 'SALES_EXECUTIVE' } as AuthUser);
      expect(prisma.rolePermission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'sorders', isDeleted: false } }),
      );
      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: 'u3' }) }),
      );
    });

    it('scopes findAll to the team for an mfgRole with TEAM record access', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'TEAM' });
      prisma.user.findMany.mockResolvedValue([{ id: 'u2' }, { id: 'u1' }]);
      prisma.salesOrder.count.mockResolvedValue(0);
      prisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, { ...manager, mfgRole: 'SALES_MANAGER' } as AuthUser);
      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ['u2', 'u1'] } }) }),
      );
    });

    it('does not scope findAll for an mfgRole with ALL record access', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
      prisma.salesOrder.count.mockResolvedValue(0);
      prisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, { ...salesRep, mfgRole: 'SALES_HEAD' } as AuthUser);
      const where = prisma.salesOrder.findMany.mock.calls.at(-1)![0].where;
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('create', () => {
    const dto = { accountId: 'a-1', value: 5000 };

    it('rejects a purchaseOrderId from another org when present', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...dto, purchaseOrderId: 'other-org-po' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('creates with status Order accepted and ackStatus Pending', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });
      await service.create(dto as any, manager);
      expect(prisma.salesOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Order accepted', ackStatus: 'Pending' }) }),
      );
    });

    it('starts the SLA-16 "Operations handover acknowledgement" timer', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.salesOrder.create.mockResolvedValue({ id: 'so-1', orgId: 'org-1' });
      await service.create(dto as any, manager);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'sorders', 'SalesOrder', 'so-1', 'Sales order created');
    });

    it('rejects a custContactId from another org when present', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.contact.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...dto, custContactId: 'other-org-contact' } as any, manager)).rejects.toThrow(BadRequestException);
    });
  });

  describe('installation workflow', () => {
    const delivered = { id: 'so-1', orgId: 'org-1', accountId: 'a-1', ownerId: 'u9', status: 'Delivered', installStatus: null };

    it('plans an installation with a date', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue(delivered);
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1' });
      await service.performAction('so-1', 'Plan installation', { date: '2026-11-10' }, manager);
      expect(prisma.salesOrder.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: { installStatus: 'Planned', installPlannedOn: new Date('2026-11-10') } });
      expect(prisma.orderMilestone.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'Installation: Planned' }) });
    });

    it('refuses to skip a step', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ ...delivered, installStatus: 'Planned' });
      await expect(service.performAction('so-1', 'Mark installed', undefined, manager)).rejects.toThrow(/Cannot Mark installed/);
    });

    it('refuses before the order is delivered', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ ...delivered, status: 'Production' });
      await expect(service.performAction('so-1', 'Plan installation', { date: '2026-11-10' }, manager)).rejects.toThrow(/Delivered/);
    });

    it('books a sign-off task for the owner when sign-off is requested', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ ...delivered, installStatus: 'Installed' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1' });
      await service.performAction('so-1', 'Request sign-off', undefined, manager);
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', ownerId: 'u9', priority: 'High' }) });
    });

    it('closes installation on customer sign-off and records who signed', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ ...delivered, installStatus: 'Pending sign-off' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1' });
      await expect(service.performAction('so-1', 'Customer sign-off', {}, manager)).rejects.toThrow(/'by'/);
      await service.performAction('so-1', 'Customer sign-off', { by: 'R. Kumar' }, manager);
      expect(prisma.salesOrder.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: expect.objectContaining({ installStatus: 'Closed', signOffBy: 'R. Kumar' }) });
    });

    it('builds the commissioning report scoped to the org', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue(delivered);
      prisma.account.findFirst.mockResolvedValue({ name: 'Kaveri' });
      prisma.installedAsset.findMany = jest.fn().mockResolvedValue([]);
      const { filename } = await service.buildCommissioningReport('so-1', manager);
      expect(filename).toBe('Commissioning-report-so-1.pdf');
      expect(prisma.installedAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }));
    });
  });

  describe('findOne payment summary', () => {
    it('reconciles total, received, outstanding and next due from the milestones', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', value: 1000 });
      prisma.paymentMilestone.findMany.mockResolvedValue([
        { status: 'Received', dueDate: new Date('2026-10-01'), receipts: [{ amount: 400 }] },
        { status: 'Partially received', dueDate: new Date('2026-11-01'), receipts: [{ amount: 100 }] },
      ]);
      const order = await service.findOne('so-1', manager);
      expect(order.paymentSummary).toBe('Total ₹1,000 · Received ₹500 · Outstanding ₹500 · Next due 1 Nov 2026');
      expect(prisma.paymentMilestone.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }));
    });
  });

  describe('findOne payment summary (restricted role)', () => {
    it('omits received/outstanding for a role restricted from Payment receipts', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', value: 1000 });
      prisma.paymentMilestone.findMany.mockResolvedValue([{ status: 'Not due', dueDate: new Date('2026-11-01'), receipts: [{ amount: 100 }] }]);
      prisma.fieldPermission.findFirst.mockResolvedValue({ id: 'fp-1' });
      const order = await service.findOne('so-1', manager);
      expect(order.paymentSummary).toBe('Total ₹1,000 · Next due 1 Nov 2026');
    });
  });

  describe('update', () => {
    it('rejects a purchaseOrderId from another org when present', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1' });
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(service.update('so-1', { purchaseOrderId: 'other-org-po' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('refuses to re-point the order at a different purchase order', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', purchaseOrderId: 'po-1' });
      await expect(service.update('so-1', { purchaseOrderId: 'po-2' } as any, manager)).rejects.toThrow(/can't be changed/);
      expect(prisma.salesOrder.update).not.toHaveBeenCalled();
    });

    it('rejects an accountId from another org when present', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.update('so-1', { accountId: 'other-org-account' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('converts committedDelivery when present', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1' });
      await service.update('so-1', { committedDelivery: '2026-12-01' } as any, manager);
      expect(prisma.salesOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ committedDelivery: new Date('2026-12-01') }) }),
      );
    });

    it('does not touch committedDelivery when absent', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1' });
      await service.update('so-1', { plant: 'Unit 2' } as any, manager);
      const data = prisma.salesOrder.update.mock.calls[0][0].data;
      expect(data.committedDelivery).toBeUndefined();
    });
  });

  describe('performAction — Acknowledge handover', () => {
    it('sets ackStatus to Acknowledged', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Order accepted', ackStatus: 'Pending' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', ackStatus: 'Acknowledged' });
      await service.performAction('so-1', 'Acknowledge handover', undefined, manager);
      expect(prisma.salesOrder.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: { ackStatus: 'Acknowledged' } });
    });

    it('stops the SLA-16 timer', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Order accepted', ackStatus: 'Pending' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', orgId: 'org-1', ackStatus: 'Acknowledged' });
      await service.performAction('so-1', 'Acknowledge handover', undefined, manager);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'sorders', 'SalesOrder', 'so-1', 'Handover acknowledged');
    });
  });

  describe('performAction — Advance status', () => {
    it('moves to the next stage in ORDER_FLOW and records an OrderMilestone', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Order accepted' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', status: 'Design' });
      await service.performAction('so-1', 'Advance status', undefined, manager);
      expect(prisma.salesOrder.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: { status: 'Design' } });
      expect(prisma.orderMilestone.create).toHaveBeenCalledWith({ data: { salesOrderId: 'so-1', status: 'Design', createdById: 'u2' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('stops the SLA-17 "Delivery commitment risk" timer when advancing into Dispatched', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Ready for dispatch' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Dispatched' });
      await service.performAction('so-1', 'Advance status', undefined, manager);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'sorders', 'SalesOrder', 'so-1', 'Dispatched');
    });

    it('blocks Dispatched while a Before dispatch payment is outstanding', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Ready for dispatch' });
      prisma.paymentMilestone.count.mockResolvedValue(1);
      await expect(service.performAction('so-1', 'Advance status', undefined, manager)).rejects.toThrow(/Before dispatch/);
      expect(prisma.salesOrder.update).not.toHaveBeenCalled();
    });

    it('sends a Quality check order back to Production with the reason logged', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Quality check' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', status: 'Production' });
      await service.performAction('so-1', 'Send back for rework', { reason: 'Weld defect' }, manager);
      expect(prisma.salesOrder.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: { status: 'Production' } });
      expect(prisma.orderMilestone.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'Production', note: 'Rework: Weld defect' }) });
    });

    it('rejects rework outside Quality check or without a reason', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Design' });
      await expect(service.performAction('so-1', 'Send back for rework', { reason: 'x' }, manager)).rejects.toThrow(BadRequestException);
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Quality check' });
      await expect(service.performAction('so-1', 'Send back for rework', {}, manager)).rejects.toThrow(BadRequestException);
    });

    it('does not stop the SLA-17 timer when advancing into a non-Dispatched stage', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Order accepted' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Design' });
      await service.performAction('so-1', 'Advance status', undefined, manager);
      expect(mockSlaEngine.stopTimer).not.toHaveBeenCalled();
    });

    it('rejects Advance status when already Closed', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Closed' });
      await expect(service.performAction('so-1', 'Advance status', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });

  describe('performAction — Advance status into Commissioned', () => {
    it('requires serial when advancing into Commissioned', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Installation' });
      await expect(service.performAction('so-1', 'Advance status', undefined, manager)).rejects.toThrow(BadRequestException);
      expect(prisma.installedAsset.create).not.toHaveBeenCalled();
    });

    it('creates exactly one InstalledAsset when advancing into Commissioned with a serial', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Installation', accountId: 'a-1', products: '2 × BG-50 baggers' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', status: 'Commissioned' });
      await service.performAction('so-1', 'Advance status', { serial: 'BG50-26-0099' }, manager);
      expect(prisma.installedAsset.create).toHaveBeenCalledTimes(1);
      expect(prisma.installedAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ serial: 'BG50-26-0099', accountId: 'a-1', salesOrderId: 'so-1', status: 'Under warranty' }) }),
      );
    });

    it('does not create an InstalledAsset when advancing into a non-Commissioned stage', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1', status: 'Ready for dispatch' });
      prisma.salesOrder.update.mockResolvedValue({ id: 'so-1', status: 'Dispatched' });
      await service.performAction('so-1', 'Advance status', undefined, manager);
      expect(prisma.installedAsset.create).not.toHaveBeenCalled();
    });
  });

  describe('performAction — Create dispatch', () => {
    it('throws NotImplementedException', async () => {
      await expect(service.performAction('so-1', 'Create dispatch', undefined, manager)).rejects.toThrow(NotImplementedException);
    });
  });

  describe('getMilestoneEvents', () => {
    it('resolves the parent through the org-scoped findOne before querying OrderMilestone', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', orgId: 'org-1' });
      prisma.orderMilestone.findMany.mockResolvedValue([{ id: 'om-1', status: 'Design', note: null, createdAt: new Date('2026-10-01') }]);
      const events = await service.getMilestoneEvents('so-1', manager);
      expect(prisma.salesOrder.findFirst).toHaveBeenCalled();
      expect(events).toEqual([{ id: 'om-1', at: new Date('2026-10-01').toISOString(), label: 'Design', description: undefined }]);
    });
  });
});
