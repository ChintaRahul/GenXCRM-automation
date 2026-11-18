import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockPrisma = {
  approval: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  quotation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  costingSheet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
};

const directorUser: AuthUser = {
  id: 'u1',
  name: 'Director',
  email: 'dir@test.com',
  role: 'Director' as any,
  teamId: null,
  orgId: 'org-1',
};

describe('ApprovalsService', () => {
  let service: ApprovalsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
      ],
    }).compile();
    service = module.get(ApprovalsService);
  });

  describe('findAll', () => {
    it('scopes findAll to org only (no ownerId tier — Approval has no owner concept)', async () => {
      mockPrisma.approval.count.mockResolvedValue(0);
      mockPrisma.approval.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 20 }, directorUser);

      expect(mockPrisma.approval.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }),
        }),
      );
      expect(mockPrisma.approval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }),
        }),
      );
    });

    it('filters findAll by entityType and entityId when passed', async () => {
      mockPrisma.approval.count.mockResolvedValue(0);
      mockPrisma.approval.findMany.mockResolvedValue([]);

      await service.findAll(
        { page: 1, limit: 20, entityType: 'Quotation', entityId: 'quot-1' },
        directorUser,
      );

      expect(mockPrisma.approval.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            isDeleted: false,
            entityType: 'Quotation',
            entityId: 'quot-1',
          }),
        }),
      );
      expect(mockPrisma.approval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            isDeleted: false,
            entityType: 'Quotation',
            entityId: 'quot-1',
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('findOne throws NotFoundException outside the org', async () => {
      mockPrisma.approval.findFirst.mockResolvedValue(null);

      await expect(service.findOne('app-1', directorUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('create defaults status to Requested', async () => {
      const dto = {
        title: 'Test Approval',
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
      };
      const mockCreated = {
        id: 'app-1',
        orgId: 'org-1',
        status: 'Requested',
        ...dto,
        requestedAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
        createdAt: new Date(),
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };
      mockPrisma.approval.create.mockResolvedValue(mockCreated as any);

      const result = await service.create(dto, directorUser);

      expect(mockPrisma.approval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: 'org-1',
          status: 'Requested',
          title: 'Test Approval',
          entityType: 'Quotation',
          entityId: 'quot-1',
          type: 'Discount',
        }),
      });
      expect(result).toEqual(mockCreated);
    });

    it('sets requestedById to the caller id, ignoring any client-supplied value', async () => {
      const dto = {
        title: 'Test Approval',
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: 'someone-else',
      };
      mockPrisma.approval.create.mockResolvedValue({ id: 'app-1' } as any);

      await service.create(dto as never, directorUser);

      expect(mockPrisma.approval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ requestedById: directorUser.id }),
      });
    });

    it('starts the SLA-14 "Approval turnaround" timer, with the approver level as context', async () => {
      mockPrisma.approval.create.mockResolvedValue({ id: 'app-1', orgId: 'org-1', currentApprover: 'Sales Manager' });
      await service.create({ title: 'Test Approval', entityType: 'Quotation', entityId: 'quot-1', type: 'Discount' }, directorUser);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'approvals', 'Approval', 'app-1', 'Approval requested', 'Sales Manager');
    });
  });

  describe('update', () => {
    it('update writes the given fields to the record (e.g. an updated approverComments)', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Requested',
        isDeleted: false,
        requestedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };
      const dto = { approverComments: 'Review pending' };
      const mockUpdated = { ...mockApproval, approverComments: 'Review pending' };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);
      mockPrisma.approval.update.mockResolvedValue(mockUpdated as any);

      const result = await service.update('app-1', dto, directorUser);

      expect(mockPrisma.approval.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: dto,
      });
      expect(result).toEqual(mockUpdated);
    });
  });

  describe('performAction', () => {
    it('performAction "Approve" transitions Pending -> Approved', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Pending',
        isDeleted: false,
        requestedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };
      const mockUpdated = { ...mockApproval, status: 'Approved' };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);
      mockPrisma.approval.update.mockResolvedValue(mockUpdated as any);

      const result = await service.performAction('app-1', 'Approve', undefined, directorUser);

      expect(mockPrisma.approval.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: 'Approved' },
      });
      expect(result).toEqual(mockUpdated);
    });

    it('approving a quotation approval moves the pending quotation to Approved, scoped to the org', async () => {
      mockPrisma.approval.findFirst.mockResolvedValue({ id: 'app-1', orgId: 'org-1', status: 'Requested', entityType: 'Quotation', entityId: 'quot-1' });
      mockPrisma.approval.update.mockResolvedValue({ id: 'app-1', orgId: 'org-1', status: 'Approved', entityType: 'Quotation', entityId: 'quot-1' });
      await service.performAction('app-1', 'Approve', undefined, directorUser);
      expect(mockPrisma.quotation.updateMany).toHaveBeenCalledWith({
        where: { id: 'quot-1', orgId: 'org-1', status: 'Approval pending' },
        data: { status: 'Approved' },
      });
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'quot-1', 'Costing approved');
    });

    it('rejecting a quotation approval sends the quotation back to Draft', async () => {
      mockPrisma.approval.findFirst.mockResolvedValue({ id: 'app-1', orgId: 'org-1', status: 'Requested', entityType: 'Quotation', entityId: 'quot-1' });
      mockPrisma.approval.update.mockResolvedValue({ id: 'app-1', orgId: 'org-1', status: 'Rejected', entityType: 'Quotation', entityId: 'quot-1' });
      await service.performAction('app-1', 'Reject', { comments: 'Too low' }, directorUser);
      expect(mockPrisma.quotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'Draft' } }));
      expect(mockSlaEngine.startTimer).not.toHaveBeenCalled();
    });

    it('approving a costing approval moves the pending costing sheet to Approved', async () => {
      mockPrisma.approval.findFirst.mockResolvedValue({ id: 'app-2', orgId: 'org-1', status: 'Requested', entityType: 'Costing', entityId: 'cs-1' });
      mockPrisma.approval.update.mockResolvedValue({ id: 'app-2', orgId: 'org-1', status: 'Approved', entityType: 'Costing', entityId: 'cs-1' });
      await service.performAction('app-2', 'Approve', undefined, directorUser);
      expect(mockPrisma.costingSheet.updateMany).toHaveBeenCalledWith({
        where: { id: 'cs-1', orgId: 'org-1', status: 'Approval pending' },
        data: { status: 'Approved' },
      });
    });

    it('performAction "Approve" stops the SLA-14 timer', async () => {
      mockPrisma.approval.findFirst.mockResolvedValue({ id: 'app-1', orgId: 'org-1', status: 'Pending' });
      mockPrisma.approval.update.mockResolvedValue({ id: 'app-1', orgId: 'org-1', status: 'Approved' });
      await service.performAction('app-1', 'Approve', undefined, directorUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'approvals', 'Approval', 'app-1', 'Approved / rejected / returned');
    });

    it('performAction "Approve" rejects from Rejected', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Rejected',
        isDeleted: false,
        requestedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);

      await expect(service.performAction('app-1', 'Approve', undefined, directorUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('performAction "Return for revision" requires the comments payload key', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Pending',
        isDeleted: false,
        requestedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);

      await expect(service.performAction('app-1', 'Return for revision', {}, directorUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('performAction "Reject" requires the comments payload key', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Pending',
        isDeleted: false,
        requestedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);

      await expect(service.performAction('app-1', 'Reject', {}, directorUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('archive', () => {
    it('archive sets isDeleted true', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Requested',
        isDeleted: false,
        requestedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };
      const mockArchived = { ...mockApproval, isDeleted: true };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);
      mockPrisma.approval.update.mockResolvedValue(mockArchived as any);

      await service.archive('app-1', directorUser);

      expect(mockPrisma.approval.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { isDeleted: true },
      });
    });
  });

  describe('getChainEvents', () => {
    it('getChainEvents returns a single "Requested" event for a Pending approval', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Pending',
        isDeleted: false,
        requestedAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T10:00:00Z'),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);

      const result = await service.getChainEvents('app-1', directorUser);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'app-1-requested',
        at: '2026-01-01T10:00:00.000Z',
        label: 'Requested',
      });
    });

    it('getChainEvents returns two events (Requested + final status) for an Approved/Rejected approval', async () => {
      const mockApproval = {
        id: 'app-1',
        orgId: 'org-1',
        title: 'Test',
        status: 'Approved',
        isDeleted: false,
        requestedAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T11:00:00Z'),
        createdAt: new Date(),
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: null,
        currentApprover: null,
        level: null,
        matchedRule: null,
        reason: null,
        approverComments: null,
      };

      mockPrisma.approval.findFirst.mockResolvedValue(mockApproval as any);

      const result = await service.getChainEvents('app-1', directorUser);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'app-1-requested',
        at: '2026-01-01T10:00:00.000Z',
        label: 'Requested',
      });
      expect(result[1]).toEqual({
        id: 'app-1-Approved',
        at: '2026-01-01T11:00:00.000Z',
        label: 'Approved',
      });
    });
  });
});
