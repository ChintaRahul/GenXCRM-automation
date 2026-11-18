import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { EvaluationsService } from './evaluations.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockPrisma = {
  evaluation: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  account: {
    findFirst: jest.fn(),
  },
  opportunity: {
    findFirst: jest.fn(),
  },
  mfgActivity: { create: jest.fn() },
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('EvaluationsService', () => {
  let service: EvaluationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        EvaluationsService,
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

    service = module.get(EvaluationsService);
  });

  describe('findAll', () => {
    it('filters by opportunityId and accountId when passed (for the Opportunity detail page\'s Demos tab)', async () => {
      mockPrisma.evaluation.count.mockResolvedValue(0);
      mockPrisma.evaluation.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, opportunityId: 'OP-1', accountId: 'A-1' }, repUser);
      expect(mockPrisma.evaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ opportunityId: 'OP-1', accountId: 'A-1' }),
        }),
      );
    });

    it('scopes findAll to ownerId for SALES_REP', async () => {
      mockPrisma.evaluation.count.mockResolvedValue(0);
      mockPrisma.evaluation.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, repUser);
      expect(mockPrisma.evaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'rep-1', orgId: 'org-1' }),
        }),
      );
    });

    it('does not scope findAll to ownerId for MANAGER', async () => {
      mockPrisma.evaluation.count.mockResolvedValue(0);
      mockPrisma.evaluation.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, managerUser);
      expect(mockPrisma.evaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.evaluation.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('does not scope findAll to ownerId for DIRECTOR', async () => {
      mockPrisma.evaluation.count.mockResolvedValue(0);
      mockPrisma.evaluation.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, directorUser);
      expect(mockPrisma.evaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.evaluation.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('owner query param is ignored for SALES_REP', async () => {
      mockPrisma.evaluation.count.mockResolvedValue(0);
      mockPrisma.evaluation.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, ownerId: ['other-id'] }, repUser);
      const call = mockPrisma.evaluation.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toEqual('rep-1');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a record outside the org', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue(null);
      await expect(service.findOne('eval-1', repUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', orgId: 'org-1' });
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1', orgId: 'org-1' });
    });

    it('rejects create with an opportunityId belonging to another org', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { title: 'Eval 1', type: 'Demo', opportunityId: 'other-org-opp', accountId: 'acc-1', plannedDate: '2026-01-01' },
          repUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.evaluation.create).not.toHaveBeenCalled();
    });

    it('rejects create with an accountId belonging to another org', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { title: 'Eval 1', type: 'Demo', opportunityId: 'opp-1', accountId: 'other-org-acc', plannedDate: '2026-01-01' },
          repUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.evaluation.create).not.toHaveBeenCalled();
    });

    it('defaults ownerId to the SALES_REP caller when omitted', async () => {
      mockPrisma.evaluation.create.mockResolvedValue({ id: 'eval-1', ownerId: 'rep-1' });
      await service.create(
        { title: 'Eval 1', type: 'Demo', opportunityId: 'opp-1', accountId: 'acc-1', plannedDate: '2026-01-01' },
        repUser,
      );
      expect(mockPrisma.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'rep-1' }),
        }),
      );
    });

    it('converts plannedDate to a Date instance', async () => {
      mockPrisma.evaluation.create.mockResolvedValue({ id: 'eval-1' });
      await service.create(
        { title: 'Eval 1', type: 'Demo', opportunityId: 'opp-1', accountId: 'acc-1', plannedDate: '2026-01-01' },
        repUser,
      );
      const call = mockPrisma.evaluation.create.mock.calls[0];
      expect((call[0].data as Record<string, unknown>).plannedDate).toEqual(new Date('2026-01-01'));
    });
  });

  describe('update', () => {
    it('converts actualDate to a Date instance when present', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1' });
      mockPrisma.evaluation.update.mockResolvedValue({});
      await service.update('eval-1', { actualDate: '2026-11-01' } as never, directorUser);
      expect(mockPrisma.evaluation.update).toHaveBeenCalledWith({
        where: { id: 'eval-1' },
        data: expect.objectContaining({ actualDate: new Date('2026-11-01') }),
      });
    });

    it('does not touch date fields that are absent from the update payload', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1' });
      mockPrisma.evaluation.update.mockResolvedValue({});
      await service.update('eval-1', { result: 'Passed' } as never, directorUser);
      const data = mockPrisma.evaluation.update.mock.calls[0][0].data;
      expect(data.actualDate).toBeUndefined();
      expect(data.sampleDispatched).toBeUndefined();
    });

    it('rejects update with an opportunityId belonging to another org', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1' });
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.update('eval-1', { opportunityId: 'other-org-opp' } as never, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.evaluation.update).not.toHaveBeenCalled();
    });

    it('rejects update with an accountId belonging to another org', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1' });
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.update('eval-1', { accountId: 'other-org-acc' } as never, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.evaluation.update).not.toHaveBeenCalled();
    });
  });

  describe('performAction', () => {
    it('performAction "Schedule" transitions Requested -> Scheduled', async () => {
      const record = { id: 'eval-1', status: 'Requested' };
      mockPrisma.evaluation.findFirst.mockResolvedValue(record);
      mockPrisma.evaluation.update.mockResolvedValue({ ...record, status: 'Scheduled' });
      await service.performAction('eval-1', 'Schedule', undefined, repUser);
      expect(mockPrisma.evaluation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'Scheduled' }),
        }),
      );
    });

    it('performAction "Mark failed" requires the result payload key', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', status: 'In progress' });
      await expect(service.performAction('eval-1', 'Mark failed', {}, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "Mark failed" rejects from Requested', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', status: 'Requested' });
      await expect(service.performAction('eval-1', 'Mark failed', { result: 'Failed test' }, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "Mark failed" persists the result payload value onto the record', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', status: 'In progress' });
      mockPrisma.evaluation.update.mockResolvedValue({});
      await service.performAction('eval-1', 'Mark failed', { result: 'It broke' }, repUser);
      expect(mockPrisma.evaluation.update).toHaveBeenCalledWith({
        where: { id: 'eval-1' },
        data: { status: 'Failed', result: 'It broke' },
      });
    });

    it('performAction "Customer rejected" transitions Successful -> Customer rejected', async () => {
      const record = { id: 'eval-1', status: 'Successful' };
      mockPrisma.evaluation.findFirst.mockResolvedValue(record);
      mockPrisma.evaluation.update.mockResolvedValue({ ...record, status: 'Customer rejected' });
      await service.performAction('eval-1', 'Customer rejected', undefined, repUser);
      expect(mockPrisma.evaluation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'Customer rejected' }),
        }),
      );
    });

    it('starts the SLA-09 "Evaluation result" timer on "Start", with the evaluation type as context', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1', status: 'Scheduled', type: 'Trial' });
      mockPrisma.evaluation.update.mockResolvedValue({ id: 'eval-1', orgId: 'org-1' });
      await service.performAction('eval-1', 'Start', undefined, repUser);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'demos', 'Evaluation', 'eval-1', 'Trial started', 'Trial');
    });

    it('stops the SLA-09 "Evaluation result" timer on "Mark successful" and "Mark failed"', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1', status: 'In progress' });
      mockPrisma.evaluation.update.mockResolvedValue({ id: 'eval-1', orgId: 'org-1' });
      await service.performAction('eval-1', 'Mark successful', undefined, repUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'demos', 'Evaluation', 'eval-1', 'Result recorded');
    });
  });

  describe('successful trial prompt', () => {
    it('books a Solution proposed task when the opportunity is still at Demo / trial', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1', status: 'In progress' });
      mockPrisma.evaluation.update.mockResolvedValue({ id: 'eval-1', orgId: 'org-1', opportunityId: 'op-1', accountId: 'a-1', ownerId: 'rep-1' });
      mockPrisma.opportunity.findFirst.mockResolvedValue({ stage: 'Demo / trial' });
      await service.performAction('eval-1', 'Mark successful', undefined, repUser);
      expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', opportunityId: 'op-1', ownerId: 'rep-1', priority: 'High' }) });
    });

    it('stays quiet when the opportunity has already moved on', async () => {
      mockPrisma.mfgActivity.create.mockClear();
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1', orgId: 'org-1', status: 'In progress' });
      mockPrisma.evaluation.update.mockResolvedValue({ id: 'eval-1', orgId: 'org-1', opportunityId: 'op-1' });
      mockPrisma.opportunity.findFirst.mockResolvedValue({ stage: 'Costing' });
      await service.performAction('eval-1', 'Mark successful', undefined, repUser);
      expect(mockPrisma.mfgActivity.create).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('sets isDeleted true', async () => {
      mockPrisma.evaluation.findFirst.mockResolvedValue({ id: 'eval-1' });
      mockPrisma.evaluation.update.mockResolvedValue({ id: 'eval-1', isDeleted: true });
      await service.archive('eval-1', repUser);
      expect(mockPrisma.evaluation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isDeleted: true } }));
    });
  });
});
