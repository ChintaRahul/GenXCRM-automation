import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockAutomation = { fire: jest.fn().mockResolvedValue(undefined) };

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let prisma: any;
  const mockSlaEngine = {
    startTimer: jest.fn().mockResolvedValue(undefined),
    stopTimer: jest.fn().mockResolvedValue(undefined),
    getSlaState: jest.fn().mockResolvedValue(null),
  };

  const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      purchaseOrder: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      opportunity: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      quotation: { findFirst: jest.fn() },
      quotationLine: { findMany: jest.fn().mockResolvedValue([]) },
      approvalRule: { findMany: jest.fn().mockResolvedValue([]) },
      approval: { create: jest.fn().mockResolvedValue({ id: 'ap-1', orgId: 'org-1', currentApprover: 'Director' }) },
      account: { findFirst: jest.fn() },
      opportunityStageHistory: { create: jest.fn() },
      salesOrder: { create: jest.fn() },
      paymentMilestone: { create: jest.fn() },
      rolePermission: { findFirst: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: AutomationEngineService, useValue: mockAutomation },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(PurchaseOrdersService);
  });

  describe('findAll', () => {
    it('filters by opportunityId when passed (for the Opportunity detail page\'s PO/Orders tab)', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, opportunityId: 'OP-1' }, salesRep);
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ opportunityId: 'OP-1' }) }),
      );
    });

    it('scopes to ownerId for SALES_REP', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1' }) }),
      );
    });

    it('scopes to orgId only for MANAGER', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, manager);
      const where = prisma.purchaseOrder.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });

    it('scopes findAll to ownerId for an mfgRole with OWN record access', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, { ...manager, mfgRole: 'SALES_EXECUTIVE' });
      expect(prisma.rolePermission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'pos', isDeleted: false } }),
      );
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: 'u2' }) }),
      );
    });

    it('scopes findAll to the team for an mfgRole with TEAM record access', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'TEAM' });
      prisma.user.findMany.mockResolvedValue([{ id: 'u2' }, { id: 'u1' }]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, { ...manager, teamId: 'team-1', mfgRole: 'SALES_MANAGER' });
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ['u2', 'u1'] } }) }),
      );
    });

    it('does not scope findAll for an mfgRole with ALL record access', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, { ...salesRep, mfgRole: 'SALES_HEAD' });
      const where = prisma.purchaseOrder.findMany.mock.calls.at(-1)![0].where;
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = { poNo: 'PO-1', poDate: '2026-10-01', opportunityId: 'op-1', quotationId: 'q-1', accountId: 'a-1', value: 1000 };

    it('rejects an opportunity from another org', async () => {
      prisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects a quotation from another org', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1' });
      prisma.quotation.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an account from another org', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1' });
      prisma.quotation.findFirst.mockResolvedValue({ id: 'q-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('notifies sales managers and commercial estimation about the new PO', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1' });
      prisma.quotation.findFirst.mockResolvedValue({ id: 'q-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1', orgId: 'org-1', poNo: 'PO-1', value: 1000 });
      prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }]);
      await service.create(dto as any, manager);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', mfgRole: { in: ['SALES_MANAGER', 'COMMERCIAL_ESTIMATION'] } }) }));
      expect(mockNotifications.create).toHaveBeenCalledWith('org-1', 'mgr-1', 'Purchase order received', expect.stringContaining('PO-1'), '/pos/po-1');
    });

    it('creates with status Received and requireOrgId-derived orgId', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1' });
      prisma.quotation.findFirst.mockResolvedValue({ id: 'q-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1' });
      await service.create(dto as any, manager);
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Received', poDate: new Date('2026-10-01') }) }),
      );
    });

    it('starts the SLA-15 "PO verification" timer', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1' });
      prisma.quotation.findFirst.mockResolvedValue({ id: 'q-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1', orgId: 'org-1' });
      await service.create(dto as any, manager);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'pos', 'PurchaseOrder', 'po-1', 'PO received');
    });

    it('forces ownerId to caller.id for SALES_REP', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1' });
      prisma.quotation.findFirst.mockResolvedValue({ id: 'q-1' });
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1' });
      await service.create({ ...dto, ownerId: 'someone-else' } as any, salesRep);
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ownerId: 'u1' }) }),
      );
    });
  });

  describe('update', () => {
    it('rejects an opportunityId from another org when present in the dto', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(service.update('po-1', { opportunityId: 'other-org-op' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects a quotationId from another org when present in the dto', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.quotation.findFirst.mockResolvedValue(null);
      await expect(service.update('po-1', { quotationId: 'other-org-quote' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org when present in the dto', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.update('po-1', { accountId: 'other-org-account' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('converts deliveryDate when present', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });
      await service.update('po-1', { deliveryDate: '2026-11-01' } as any, manager);
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deliveryDate: new Date('2026-11-01') }) }),
      );
    });

    it('does not touch deliveryDate when absent', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });
      await service.update('po-1', { paymentTerms: '30 days' } as any, manager);
      const data = prisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.deliveryDate).toBeUndefined();
    });

    it('converts poDate when present', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });
      await service.update('po-1', { poDate: '2026-11-05' } as any, manager);
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ poDate: new Date('2026-11-05') }) }),
      );
    });

    it('does not touch poDate when absent', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });
      await service.update('po-1', { paymentTerms: '30 days' } as any, manager);
      const data = prisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.poDate).toBeUndefined();
    });
  });

  describe('performAction', () => {
    it('runs Start verification when status allows it', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', status: 'Under verification' });
      await service.performAction('po-1', 'Start verification', undefined, manager);
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'Under verification' } });
    });

    it('rejects Start verification when status forbids it', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Accepted' });
      await expect(service.performAction('po-1', 'Start verification', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('requires clar payload for Request clarification and stores it', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Under verification' });
      await expect(service.performAction('po-1', 'Request clarification', undefined, manager)).rejects.toThrow(BadRequestException);
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });
      await service.performAction('po-1', 'Request clarification', { clar: 'Please confirm qty' }, manager);
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: 'Clarification required', clarification: 'Please confirm qty' },
      });
    });

    it('requires rej payload for Reject and stores it', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Received' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });
      await service.performAction('po-1', 'Reject', { rej: 'Wrong pricing' }, manager);
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: 'Rejected / cancelled', rejectionReason: 'Wrong pricing' },
      });
    });
  });

  describe('parsePaymentTerms (via acceptPo)', () => {
    const poRecord = { id: 'po-1', orgId: 'org-1', status: 'Received', opportunityId: 'op-1', accountId: 'a-1', value: 1000000, poDate: new Date('2026-10-01'), ownerId: 'u9' };

    beforeEach(() => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', stage: 'PO received', product: 'Weighbridge' });
      prisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', orgId: 'org-1', status: 'Accepted' });
    });

    it('stops the SLA-15 "PO verification" timer on accept', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '100% advance' });
      await service.acceptPo('po-1', manager);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'pos', 'PurchaseOrder', 'po-1', 'Accepted / clarification');
    });

    it('refuses a concurrent second accept (double-click) without creating another sales order', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '100% advance' });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.acceptPo('po-1', manager)).rejects.toThrow(/Cannot accept a purchase order/);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    it('blocks accepting a PO whose value differs from the quotation', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, quotationId: 'q-1', value: 1 });
      prisma.quotationLine.findMany.mockResolvedValue([{ qty: 1, unitPrice: 1000000, discountPct: 0, amount: null }]);
      await expect(service.acceptPo('po-1', manager)).rejects.toThrow(/differs from the quotation/);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    it('accepts a PO from Clarification required once the value matches', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, status: 'Clarification required', quotationId: 'q-1' });
      prisma.quotationLine.findMany.mockResolvedValue([{ qty: 1, unitPrice: 1000000, discountPct: 0, amount: null }]);
      await expect(service.acceptPo('po-1', manager)).resolves.toBeDefined();
    });

    it('raises a CreditTerms approval when the credit days fall in a rule band', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '90 days credit' });
      prisma.approvalRule.findMany.mockResolvedValue([
        { id: 'r1', min: 45, max: 60, approverRole: 'Accounts' },
        { id: 'r2', min: 60, max: 120, approverRole: 'Director' },
      ]);
      await service.acceptPo('po-1', manager);
      expect(prisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'CreditTerms', entityType: 'PaymentTerms', entityId: 'po-1', matchedRule: 'r2', orgId: 'org-1' }) }),
      );
    });

    it.each(['Net 90', 'Net-90 days', '90 days'])('also reads "%s" as 90 days credit', async (paymentTerms) => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms });
      prisma.approvalRule.findMany.mockResolvedValue([{ id: 'r2', min: 60, max: 120, approverRole: 'Director' }]);
      await service.acceptPo('po-1', manager);
      expect(prisma.approval.create).toHaveBeenCalled();
    });

    it('raises no approval for short credit below the first rule', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '30 days credit' });
      prisma.approvalRule.findMany.mockResolvedValue([{ id: 'r1', min: 45, max: 60, approverRole: 'Accounts' }]);
      await service.acceptPo('po-1', manager);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('fires the PO accepted automation', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '100% advance' });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', orgId: 'org-1', poNo: 'PO-1', value: 1000000, status: 'Accepted' });
      await service.acceptPo('po-1', manager);
      expect(mockAutomation.fire).toHaveBeenCalledWith('org-1', 'PO accepted', expect.objectContaining({ link: '/purchase-orders/po-1', value: 1000000 }));
    });

    it('rejects accepting a PO not in Received/Under verification', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, status: 'Rejected / cancelled' });
      await expect(service.acceptPo('po-1', manager)).rejects.toThrow(BadRequestException);
    });

    it('parses a multi-clause percentage string into multiple milestones', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '30% advance, 60% before dispatch, 10% after installation' });
      await service.acceptPo('po-1', manager);
      expect(prisma.paymentMilestone.create).toHaveBeenCalledTimes(3);
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ milestone: 'Advance', amount: 300000 }) }));
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ milestone: 'Before dispatch', amount: 600000 }) }));
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ milestone: 'After installation', amount: 100000 }) }));
    });

    it('parses "N days credit" into a single 100% milestone due N days after poDate', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '60 days credit' });
      await service.acceptPo('po-1', manager);
      expect(prisma.paymentMilestone.create).toHaveBeenCalledTimes(1);
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pct: 100, amount: 1000000, dueDate: new Date('2026-11-30') }) }),
      );
    });

    it('falls back to a single Full payment milestone for an unrecognized string, never throwing', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: 'net 45, negotiable' });
      await expect(service.acceptPo('po-1', manager)).resolves.toBeDefined();
      expect(prisma.paymentMilestone.create).toHaveBeenCalledTimes(1);
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ milestone: 'Full payment', pct: 100, amount: 1000000 }) }),
      );
    });

    it('marks the Opportunity Won, writes stage history, creates one SalesOrder, and sets PO status Accepted', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '100% advance' });
      await service.acceptPo('po-1', manager);
      expect(prisma.opportunity.update).toHaveBeenCalledWith({ where: { id: 'op-1' }, data: { stage: 'Won' } });
      expect(prisma.opportunityStageHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ opportunityId: 'op-1', fromStage: 'PO received', toStage: 'Won' }) }),
      );
      expect(prisma.salesOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            purchaseOrderId: 'po-1',
            accountId: 'a-1',
            status: 'Order accepted',
            ackStatus: 'Pending',
            ownerId: 'u9',
            products: 'Weighbridge',
            paymentTerms: '100% advance',
          }),
        }),
      );
      expect(prisma.paymentMilestone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ownerId: 'u9' }) }),
      );
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'Accepted' } });
    });

    it('skips the Won transition and history write when the opportunity is already Won, but still completes the rest of the cascade', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', stage: 'Won', product: 'Weighbridge' });
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, paymentTerms: '100% advance' });
      await service.acceptPo('po-1', manager);
      expect(prisma.opportunity.update).not.toHaveBeenCalled();
      expect(prisma.opportunityStageHistory.create).not.toHaveBeenCalled();
      expect(prisma.salesOrder.create).toHaveBeenCalled();
      expect(prisma.paymentMilestone.create).toHaveBeenCalled();
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'Accepted' } });
    });
  });

  describe('getCompareTable', () => {
    const poRecord = {
      id: 'po-1', orgId: 'org-1', quotationId: 'q-1', value: 1000, paymentTerms: '30 days',
      deliveryDate: new Date('2026-11-01'),
    };
    const quotationRecord = {
      id: 'q-1', paymentTerms: '30 days', deliveryTime: '10 weeks',
      lines: [{ productId: 'p-1', qty: 2, unitPrice: 500, product: { sku: 'SKU-1' } }],
    };

    it('returns Match/Mismatch rows comparing PO fields against the quotation', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(poRecord);
      prisma.quotation.findFirst.mockResolvedValueOnce(quotationRecord);
      const table = await service.getCompareTable('po-1', manager);
      expect(table.columns.map((c) => c.key)).toEqual(['check', 'quotation', 'po', 'result']);
      const paymentRow = table.rows.find((r) => r.check === 'Payment terms');
      expect(paymentRow?.result).toBe('Match');
    });

    it('reports Value Match when PO value equals the sum of quotation line totals', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(poRecord);
      prisma.quotation.findFirst.mockResolvedValueOnce(quotationRecord);
      const table = await service.getCompareTable('po-1', manager);
      const valueRow = table.rows.find((r) => r.check === 'Value');
      expect(valueRow?.quotation).toBe(1000);
      expect(valueRow?.po).toBe(1000);
      expect(valueRow?.result).toBe('Match');
    });

    it('reports Value Mismatch when PO value differs from the sum of quotation line totals', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, value: 1200 });
      prisma.quotation.findFirst.mockResolvedValueOnce(quotationRecord);
      const table = await service.getCompareTable('po-1', manager);
      const valueRow = table.rows.find((r) => r.check === 'Value');
      expect(valueRow?.result).toBe('Mismatch');
    });

    it('compares ordered quantity and products when the PO records them', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ ...poRecord, qty: 3, products: 'sku-1' });
      prisma.quotation.findFirst.mockResolvedValueOnce(quotationRecord);
      const table = await service.getCompareTable('po-1', manager);
      expect(table.rows.find((r) => r.check === 'Quantity')?.result).toBe('Mismatch');
      expect(table.rows.find((r) => r.check === 'Products')?.result).toBe('Match');
    });

    it('reports Quantity and Products rows as n/a when the PO has not recorded them', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(poRecord);
      prisma.quotation.findFirst.mockResolvedValueOnce(quotationRecord);
      const table = await service.getCompareTable('po-1', manager);
      const qtyRow = table.rows.find((r) => r.check === 'Quantity');
      const productsRow = table.rows.find((r) => r.check === 'Products');
      expect(qtyRow?.result).toBe('n/a');
      expect(qtyRow?.po).toBe('—');
      expect(productsRow?.result).toBe('n/a');
      expect(productsRow?.po).toBe('—');
    });
  });
});
