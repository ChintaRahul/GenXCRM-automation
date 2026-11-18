import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { CostingSheetsService } from './costing-sheets.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockPrisma = {
  costingSheet: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  opportunity: {
    findFirst: jest.fn(),
  },
  rfq: { findMany: jest.fn() },
  account: {
    findFirst: jest.fn(),
  },
  approvalRule: {
    findMany: jest.fn(),
  },
  approval: {
    create: jest.fn(),
  },
  rolePermission: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  fieldPermission: { findFirst: jest.fn().mockResolvedValue(null) },
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('CostingSheetsService', () => {
  let service: CostingSheetsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CostingSheetsService,
        {
          provide: 'PrismaService',
          useValue: mockPrisma,
        },
        { provide: SlaEngineService, useValue: mockSlaEngine },
      ],
    })
      .useMocker((token) => {
        if (token?.toString().includes('PrismaService')) return mockPrisma;
        return {};
      })
      .compile();

    service = module.get(CostingSheetsService);
  });

  describe('access restriction (Costing & margin field security)', () => {
    it('rejects findAll with ForbiddenException for a role restricted from Costing & margin', async () => {
      mockPrisma.fieldPermission.findFirst.mockResolvedValueOnce({ id: 'fp-1' });
      await expect(service.findAll({ page: 1, limit: 20 }, { ...repUser, mfgRole: 'SALES_EXECUTIVE' as never })).rejects.toThrow(
        'Costing is restricted.',
      );
      expect(mockPrisma.costingSheet.findMany).not.toHaveBeenCalled();
    });

    it('rejects findOne with ForbiddenException for a role restricted from Costing & margin', async () => {
      mockPrisma.fieldPermission.findFirst.mockResolvedValueOnce({ id: 'fp-1' });
      await expect(service.findOne('CS-1', { ...repUser, mfgRole: 'SALES_EXECUTIVE' as never })).rejects.toThrow('Costing is restricted.');
      expect(mockPrisma.costingSheet.findFirst).not.toHaveBeenCalled();
    });

    it('allows findAll through for a role not restricted from Costing & margin', async () => {
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await expect(service.findAll({ page: 1, limit: 20 }, { ...directorUser, mfgRole: 'DIRECTOR' as never })).resolves.toBeDefined();
    });
  });

  describe('findAll', () => {
    it('filters by opportunityId and accountId when passed (for the Opportunity detail page\'s Costing tab)', async () => {
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, opportunityId: 'OP-1', accountId: 'A-1' }, repUser);
      expect(mockPrisma.costingSheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ opportunityId: 'OP-1', accountId: 'A-1' }),
        }),
      );
    });

    it('scopes findAll to ownerId for SALES_REP', async () => {
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, repUser);
      expect(mockPrisma.costingSheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'rep-1', orgId: 'org-1' }),
        }),
      );
    });

    it('scopes findAll to ownerId for an mfgRole with OWN record access', async () => {
      mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, { ...directorUser, mfgRole: 'SALES_EXECUTIVE' });
      expect(mockPrisma.rolePermission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'costing', isDeleted: false } }),
      );
      expect(mockPrisma.costingSheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: 'dir-1' }) }),
      );
    });

    it('scopes findAll to the team for an mfgRole with TEAM record access', async () => {
      mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'TEAM' });
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }, { id: 'rep-1' }]);
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, { ...managerUser, mfgRole: 'SALES_MANAGER' });
      expect(mockPrisma.costingSheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ['mgr-1', 'rep-1'] } }) }),
      );
    });

    it('does not scope findAll for an mfgRole with ALL record access', async () => {
      mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, { ...repUser, mfgRole: 'SALES_HEAD' });
      const call = mockPrisma.costingSheet.findMany.mock.calls.at(-1)!;
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('does not scope findAll to ownerId for MANAGER', async () => {
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, managerUser);
      expect(mockPrisma.costingSheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.costingSheet.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('does not scope findAll to ownerId for DIRECTOR', async () => {
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, directorUser);
      expect(mockPrisma.costingSheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.costingSheet.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('owner query param is ignored for SALES_REP', async () => {
      mockPrisma.costingSheet.count.mockResolvedValue(0);
      mockPrisma.costingSheet.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, ownerId: ['other-id'] }, repUser);
      const call = mockPrisma.costingSheet.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toEqual('rep-1');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a record outside the org', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue(null);
      await expect(service.findOne('cs-1', repUser)).rejects.toThrow(NotFoundException);
    });

    it('returns total cost, gross margin and margin % on a Draft sheet', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', status: 'Draft', material: 700000, sellingPrice: 1000000 });
      const sheet = await service.findOne('cs-1', repUser);
      expect(sheet).toMatchObject({ total: 700000, gm: 300000, gmPct: 30 });
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', orgId: 'org-1' });
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1', orgId: 'org-1' });
      mockPrisma.rfq.findMany.mockResolvedValue([]);
    });

    it('is held until the opportunity RFQ is Approved for costing, but a deal with no RFQ is not', async () => {
      mockPrisma.rfq.findMany.mockResolvedValue([{ status: 'Technically feasible' }]);
      await expect(service.create({ opportunityId: 'opp-1', sellingPrice: 1000 } as never, directorUser)).rejects.toThrow(/Approved for costing/);
      expect(mockPrisma.costingSheet.create).not.toHaveBeenCalled();
      mockPrisma.rfq.findMany.mockResolvedValue([{ status: 'Technically feasible' }, { status: 'Approved for costing' }]);
      mockPrisma.costingSheet.create.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', sellingPrice: 1000 });
      await service.create({ opportunityId: 'opp-1', sellingPrice: 1000 } as never, directorUser);
      expect(mockPrisma.costingSheet.create).toHaveBeenCalled();
    });

    it('defaults ownerId to the SALES_REP caller when omitted, and defaults status to Draft', async () => {
      mockPrisma.costingSheet.create.mockResolvedValue({ id: 'cs-1', ownerId: 'rep-1', status: 'Draft' });
      await service.create(
        { opportunityId: 'opp-1', sellingPrice: 50000 },
        repUser,
      );
      expect(mockPrisma.costingSheet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'rep-1', status: 'Draft' }),
        }),
      );
    });

    it('rejects create with an opportunityId belonging to another org', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ opportunityId: 'other-org-opp', sellingPrice: 50000 }, repUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.costingSheet.create).not.toHaveBeenCalled();
    });

    it('rejects create with an accountId belonging to another org', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ opportunityId: 'opp-1', accountId: 'other-org-acc', sellingPrice: 50000 }, repUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.costingSheet.create).not.toHaveBeenCalled();
    });

    it('starts the SLA-10 "Costing preparation" timer, with sellingPrice driving its "Value ≥ ₹1 Cr" target', async () => {
      mockPrisma.costingSheet.create.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', sellingPrice: 50000 });
      await service.create({ opportunityId: 'opp-1', sellingPrice: 50000 }, repUser);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'costing', 'CostingSheet', 'cs-1', 'Approved for costing', undefined, 50000);
    });
  });

  describe('update', () => {
    it('update writes the given fields to the record (e.g. an updated sellingPrice or cost component)', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', sellingPrice: 50000 });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', sellingPrice: 60000 });
      await service.update('cs-1', { sellingPrice: 60000 }, repUser);
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sellingPrice: 60000 }),
        }),
      );
    });

    it('rejects update with an accountId belonging to another org', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', orgId: 'org-1' });
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.update('cs-1', { accountId: 'other-org-acc' } as never, repUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.costingSheet.update).not.toHaveBeenCalled();
    });
  });

  describe('performAction', () => {
    it('performAction "Approve" transitions Approval pending -> Approved', async () => {
      const record = { id: 'cs-1', status: 'Approval pending' };
      mockPrisma.costingSheet.findFirst.mockResolvedValue(record);
      mockPrisma.costingSheet.update.mockResolvedValue({ ...record, status: 'Approved' });
      await service.performAction('cs-1', 'Approve', undefined, repUser);
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'Approved' }),
        }),
      );
    });

    it('performAction "Approve" sets approvedById to the caller id, ignoring any client-supplied value', async () => {
      const record = { id: 'cs-1', status: 'Approval pending' };
      mockPrisma.costingSheet.findFirst.mockResolvedValue(record);
      mockPrisma.costingSheet.update.mockResolvedValue({ ...record, status: 'Approved', approvedById: repUser.id });
      await service.performAction('cs-1', 'Approve', { approvedById: 'someone-else' }, repUser);
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith({
        where: { id: 'cs-1' },
        data: { status: 'Approved', approvedById: 'rep-1' },
      });
    });

    it('performAction "Approve" rejects from Rejected', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', status: 'Rejected' });
      await expect(service.performAction('cs-1', 'Approve', undefined, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "Reject" requires the rej payload key', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', status: 'Approval pending' });
      await expect(service.performAction('cs-1', 'Reject', {}, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "New revision" bumps the revision counter and resets status to Draft', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', status: 'Approved', revision: 0 });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', revision: 1, status: 'Draft' });
      const result = await service.performAction('cs-1', 'New revision', undefined, repUser);
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith({ where: { id: 'cs-1' }, data: { revision: 1, status: 'Draft' } });
      expect(result).toEqual({ id: 'cs-1', orgId: 'org-1', revision: 1, status: 'Draft' });
    });

    it('performAction "New revision" rejects a sheet already in Draft', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', status: 'Draft' });
      await expect(service.performAction('cs-1', 'New revision', undefined, repUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.costingSheet.update).not.toHaveBeenCalled();
    });

    it('performAction "New revision" restarts the SLA-10 timer', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', status: 'Rejected', revision: 1 });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', orgId: 'org-1', revision: 2, status: 'Draft', sellingPrice: 800000 });
      await service.performAction('cs-1', 'New revision', undefined, repUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'costing', 'CostingSheet', 'cs-1', 'Costing submitted');
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'costing', 'CostingSheet', 'cs-1', 'Approved for costing', undefined, 800000);
    });
  });

  describe('submit', () => {
    const draftRecord = {
      id: 'cs-1', orgId: 'org-1', status: 'Draft', sellingPrice: 1000000,
      material: 300000, boughtOut: 100000, fabrication: 50000, electrical: 20000, software: 0,
      labor: 30000, installation: 20000, freight: 10000, packing: 5000, travel: 5000,
      overhead: 20000, contingency: 10000, other: 0,
    };
    // total = 570000, gm = 430000, gmPct = 43%

    it('rejects submitting a non-Draft costing sheet', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, status: 'Approved' });
      await expect(service.submit('cs-1', managerUser)).rejects.toThrow(BadRequestException);
    });

    it('allows re-submitting a Rejected costing sheet', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, status: 'Rejected' });
      mockPrisma.approvalRule.findMany.mockResolvedValue([]);
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approved' });
      await expect(service.submit('cs-1', managerUser)).resolves.toBeDefined();
    });

    it('stops the SLA-10 "Costing preparation" timer', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue(draftRecord);
      mockPrisma.approvalRule.findMany.mockResolvedValue([]);
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approved' });
      await service.submit('cs-1', managerUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'costing', 'CostingSheet', 'cs-1', 'Costing submitted');
    });

    it('auto-approves when no ApprovalRule matches the computed GM%', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue(draftRecord);
      mockPrisma.approvalRule.findMany.mockResolvedValue([]);
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approved' });
      const result = await service.submit('cs-1', managerUser);
      expect(mockPrisma.approval.create).not.toHaveBeenCalled();
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith({ where: { id: 'cs-1' }, data: { status: 'Approved' } });
      expect(result.gmPct).toBeCloseTo(43, 5);
    });

    it('creates an Approval and sets Approval pending when a matching ApprovalRule exists', async () => {
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-1', min: 15, max: 20, approverRole: 'Sales Head' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approval pending' });
      // Adjust sellingPrice so gmPct falls in [15,20): total 570000, gm ~104286 gives 18.25% at 570000 cost
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, sellingPrice: 700000 });
      await service.submit('cs-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityType: 'Costing', entityId: 'cs-1', type: 'Margin', matchedRule: 'ar-1' }) }),
      );
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith({ where: { id: 'cs-1' }, data: { status: 'Approval pending' } });
    });

    it('starts the SLA-14 "Approval turnaround" timer for the auto-created approval', async () => {
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-1', min: 15, max: 20, approverRole: 'Sales Head' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1', orgId: 'org-1', currentApprover: 'Sales Head' });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approval pending' });
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, sellingPrice: 700000 });
      await service.submit('cs-1', managerUser);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'approvals', 'Approval', 'ap-1', 'Approval requested', 'Sales Head');
    });

    it('picks the tightest matching bracket when a value sits exactly on a boundary', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, sellingPrice: 1000000, material: 570000, boughtOut: 0, fabrication: 0, electrical: 0, software: 0, labor: 0, installation: 0, freight: 0, packing: 0, travel: 0, overhead: 0, contingency: 0, other: 0 });
      // total = 570000, gm = 430000, gmPct = 43% — use two adjacent rules to prove [min,max) boundary handling
      mockPrisma.approvalRule.findMany.mockResolvedValue([
        { id: 'ar-low', min: 0, max: 43, approverRole: 'Sales Manager' },
        { id: 'ar-high', min: 43, max: 100, approverRole: 'Director' },
      ]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approval pending' });
      await service.submit('cs-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchedRule: 'ar-high', currentApprover: 'Director' }) }),
      );
    });

    it('routes a GM% below the lowest configured bracket to the lowest rule instead of auto-approving', async () => {
      // total 570000, sellingPrice 600000 -> gm 30000 -> gmPct 5%, below the lowest rule's min of 10
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, sellingPrice: 600000 });
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-low', min: 10, max: 20, approverRole: 'Sales Manager' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approval pending' });
      await service.submit('cs-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchedRule: 'ar-low' }) }),
      );
    });

    it('routes a GM% at/above the highest configured bracket to the highest rule instead of auto-approving', async () => {
      // total 570000, sellingPrice 5000000 -> gmPct ~88.6%, above the highest rule's max of 50
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ ...draftRecord, sellingPrice: 5000000 });
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-high', min: 20, max: 50, approverRole: 'Director' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', status: 'Approval pending' });
      await service.submit('cs-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchedRule: 'ar-high' }) }),
      );
    });
  });

  describe('archive', () => {
    it('archive sets isDeleted true', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({ id: 'cs-1' });
      mockPrisma.costingSheet.update.mockResolvedValue({ id: 'cs-1', isDeleted: true });
      await service.archive('cs-1', repUser);
      expect(mockPrisma.costingSheet.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isDeleted: true } }));
    });
  });

  describe('getBreakdownTable', () => {
    it('getBreakdownTable returns the 13 raw cost-component rows with no computed total', async () => {
      mockPrisma.costingSheet.findFirst.mockResolvedValue({
        id: 'cs-1',
        material: 1000,
        boughtOut: 2000,
        fabrication: 3000,
        electrical: 4000,
        software: 5000,
        labor: 6000,
        installation: 7000,
        freight: 8000,
        packing: 9000,
        travel: 10000,
        overhead: 11000,
        contingency: 12000,
        other: 13000,
      });
      const result = await service.getBreakdownTable('cs-1', repUser);
      expect(result.columns).toHaveLength(2);
      expect(result.rows).toHaveLength(13);
      expect(result.rows[0]).toEqual({ component: 'Material', value: 1000 });
      expect(result.rows[12]).toEqual({ component: 'Other', value: 13000 });
      expect(result.totals).toBeUndefined();
    });
  });
});
