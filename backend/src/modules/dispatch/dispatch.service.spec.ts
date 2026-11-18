import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

describe('DispatchService', () => {
  let service: DispatchService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      dispatch: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      salesOrder: { findFirst: jest.fn() },
      account: { findFirst: jest.fn() },
      paymentMilestone: { findMany: jest.fn().mockResolvedValue([]) },
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: SlaEngineService, useValue: mockSlaEngine },
      ],
    }).compile();
    service = module.get(DispatchService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for SALES_REP (Dispatch has no ownerId)', async () => {
      prisma.dispatch.findMany.mockResolvedValue([]);
      prisma.dispatch.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.dispatch.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });

    it('filters by salesOrderId when provided (used by SalesOrdersAdapter.getRelated)', async () => {
      prisma.dispatch.findMany.mockResolvedValue([]);
      prisma.dispatch.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, salesOrderId: 'so-1' } as any, manager);
      expect(prisma.dispatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ salesOrderId: 'so-1' }) }),
      );
    });
  });

  describe('create', () => {
    const dto = { salesOrderId: 'so-1', accountId: 'a-1', dispatchDate: '2026-10-05' };

    it('rejects a salesOrderId from another org', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('blocks a dispatch while a Before dispatch payment is outstanding', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.paymentMilestone.findMany.mockResolvedValue([{ id: 'pm-abc123', status: 'Partially received', amount: 600000 }]);
      await expect(service.create(dto as any, manager)).rejects.toThrow(/Before dispatch.*ABC123 \(Partially received/);
      expect(prisma.dispatch.create).not.toHaveBeenCalled();
    });

    it('notifies the sales order owner', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', ownerId: 'u-owner' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.dispatch.create.mockResolvedValue({ id: 'ds-1', orgId: 'org-1', salesOrderId: 'so-1' });
      await service.create(dto as any, manager);
      expect(mockNotifications.create).toHaveBeenCalledWith('org-1', 'u-owner', 'Dispatch created', expect.any(String), '/dispatch/ds-1');
    });

    it('creates with status Planned', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.dispatch.create.mockResolvedValue({ id: 'ds-1' });
      await service.create(dto as any, manager);
      expect(prisma.dispatch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Planned', dispatchDate: new Date('2026-10-05') }) }),
      );
    });

    it('converts invoiceDate when present', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.dispatch.create.mockResolvedValue({ id: 'ds-1' });
      await service.create({ ...dto, invoiceDate: '2026-10-06' } as any, manager);
      expect(prisma.dispatch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ invoiceDate: new Date('2026-10-06') }) }),
      );
    });
  });

  describe('update', () => {
    it('converts expectedDelivery when present', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1' });
      prisma.dispatch.update.mockResolvedValue({ id: 'ds-1' });
      await service.update('ds-1', { expectedDelivery: '2026-10-20' } as any, manager);
      expect(prisma.dispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ expectedDelivery: new Date('2026-10-20') }) }),
      );
    });

    it('does not touch expectedDelivery when absent', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1' });
      prisma.dispatch.update.mockResolvedValue({ id: 'ds-1' });
      await service.update('ds-1', { transporter: 'BlueDart' } as any, manager);
      const data = prisma.dispatch.update.mock.calls[0][0].data;
      expect(data.expectedDelivery).toBeUndefined();
    });

    it('rejects a salesOrderId from another org when present', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1' });
      prisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.update('ds-1', { salesOrderId: 'other-org-so' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org when present', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.update('ds-1', { accountId: 'other-org-account' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('converts invoiceDate when present', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1' });
      prisma.dispatch.update.mockResolvedValue({ id: 'ds-1' });
      await service.update('ds-1', { invoiceDate: '2026-10-21' } as any, manager);
      expect(prisma.dispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ invoiceDate: new Date('2026-10-21') }) }),
      );
    });
  });

  describe('performAction', () => {
    it('runs Mark dispatched when status allows it', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1', status: 'Planned' });
      prisma.dispatch.update.mockResolvedValue({ id: 'ds-1', orgId: 'org-1', status: 'Dispatched' });
      await service.performAction('ds-1', 'Mark dispatched', undefined, manager);
      expect(prisma.dispatch.update).toHaveBeenCalledWith({ where: { id: 'ds-1' }, data: { status: 'Dispatched' } });
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'dispatch', 'Dispatch', 'ds-1', 'Dispatched');
    });

    it('rejects Mark dispatched when status forbids it', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1', status: 'Delivered' });
      await expect(service.performAction('ds-1', 'Mark dispatched', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('requires actual payload for Mark delivered and stores it as actualDelivery', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1', status: 'In transit' });
      await expect(service.performAction('ds-1', 'Mark delivered', undefined, manager)).rejects.toThrow(BadRequestException);
      prisma.dispatch.update.mockResolvedValue({ id: 'ds-1', orgId: 'org-1' });
      await service.performAction('ds-1', 'Mark delivered', { actual: '2026-10-22' }, manager);
      expect(prisma.dispatch.update).toHaveBeenCalledWith({
        where: { id: 'ds-1' },
        data: { status: 'Delivered', actualDelivery: new Date('2026-10-22') },
      });
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'dispatch', 'Dispatch', 'ds-1', 'Delivered');
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'ds-1', orgId: 'org-1', status: 'Planned' });
      await expect(service.performAction('ds-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
