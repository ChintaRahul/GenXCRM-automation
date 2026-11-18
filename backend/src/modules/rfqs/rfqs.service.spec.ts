import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { RfqsService } from './rfqs.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };

const mockPrisma = {
  rfq: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  rfqRevision: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  account: {
    findFirst: jest.fn(),
  },
  opportunity: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('RfqsService', () => {
  let service: RfqsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        RfqsService,
        {
          provide: 'PrismaService',
          useValue: mockPrisma,
        },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    })
      .useMocker((token) => {
        if (token?.toString().includes('PrismaService')) return mockPrisma;
        return {};
      })
      .compile();

    service = module.get(RfqsService);
  });

  describe('findAll', () => {
    it('scopes findAll to ownerId for SALES_REP', async () => {
      mockPrisma.rfq.count.mockResolvedValue(0);
      mockPrisma.rfq.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, repUser);
      expect(mockPrisma.rfq.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'rep-1', orgId: 'org-1' }),
        }),
      );
    });

    it('filters by opportunityId and accountId when passed (for the Opportunity detail page\'s RFQs tab)', async () => {
      mockPrisma.rfq.count.mockResolvedValue(0);
      mockPrisma.rfq.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, opportunityId: 'OP-1', accountId: 'A-1' }, managerUser);
      expect(mockPrisma.rfq.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ opportunityId: 'OP-1', accountId: 'A-1' }),
        }),
      );
    });

    it('does not scope findAll to ownerId for MANAGER', async () => {
      mockPrisma.rfq.count.mockResolvedValue(0);
      mockPrisma.rfq.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, managerUser);
      expect(mockPrisma.rfq.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.rfq.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('does not scope findAll to ownerId for DIRECTOR', async () => {
      mockPrisma.rfq.count.mockResolvedValue(0);
      mockPrisma.rfq.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, directorUser);
      expect(mockPrisma.rfq.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.rfq.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('owner query param is ignored for SALES_REP', async () => {
      mockPrisma.rfq.count.mockResolvedValue(0);
      mockPrisma.rfq.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, ownerId: ['other-id'] }, repUser);
      const call = mockPrisma.rfq.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toEqual('rep-1');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a record outside the org', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue(null);
      await expect(service.findOne('rfq-1', repUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', orgId: 'org-1' });
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1', orgId: 'org-1' });
    });

    it('defaults ownerId to the SALES_REP caller when omitted', async () => {
      mockPrisma.rfq.create.mockResolvedValue({ id: 'rfq-1', ownerId: 'rep-1' });
      await service.create(
        { custNo: 'C1', opportunityId: 'opp-1', accountId: 'acc-1', receivedOn: '2026-01-01', application: 'Test', product: 'Weighbridge' },
        repUser,
      );
      expect(mockPrisma.rfq.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'rep-1' }),
        }),
      );
    });

    it('converts receivedOn to a Date instance', async () => {
      mockPrisma.rfq.create.mockResolvedValue({ id: 'rfq-1' });
      await service.create(
        { custNo: 'C1', opportunityId: 'opp-1', accountId: 'acc-1', receivedOn: '2026-01-01', application: 'Test', product: 'Weighbridge' },
        repUser,
      );
      const call = mockPrisma.rfq.create.mock.calls[0];
      expect((call[0].data as Record<string, unknown>).receivedOn).toEqual(new Date('2026-01-01'));
    });

    it('rejects create with an accountId belonging to another org', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { custNo: 'C1', opportunityId: 'opp-1', accountId: 'other-org-acc', receivedOn: '2026-01-01', application: 'Test', product: 'Weighbridge' },
          repUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.rfq.create).not.toHaveBeenCalled();
    });

    it('rejects create with an opportunityId belonging to another org', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { custNo: 'C1', opportunityId: 'other-org-opp', accountId: 'acc-1', receivedOn: '2026-01-01', application: 'Test', product: 'Weighbridge' },
          repUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.rfq.create).not.toHaveBeenCalled();
    });

    it('starts the SLA-07 "Technical feasibility response" timer', async () => {
      mockPrisma.rfq.create.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1' });
      await service.create(
        { custNo: 'C1', opportunityId: 'opp-1', accountId: 'acc-1', receivedOn: '2026-01-01', application: 'Test', product: 'Weighbridge' },
        repUser,
      );
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'rfqs', 'Rfq', 'rfq-1', 'RFQ received');
    });
  });

  describe('update', () => {
    it('update writes the given fields to the record', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'RFQ-1', orgId: 'org-1' });
      mockPrisma.rfq.update.mockResolvedValue({});
      await service.update('RFQ-1', { application: 'Updated application' } as never, directorUser);
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'RFQ-1' }, data: expect.objectContaining({ application: 'Updated application' }) }),
      );
    });

    it('update converts receivedOn to a Date instance when present', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'RFQ-1', orgId: 'org-1' });
      mockPrisma.rfq.update.mockResolvedValue({});
      await service.update('RFQ-1', { receivedOn: '2026-11-01' } as never, directorUser);
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ receivedOn: new Date('2026-11-01') }) }),
      );
    });

    it('rejects update with an accountId belonging to another org', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'RFQ-1', orgId: 'org-1' });
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.update('RFQ-1', { accountId: 'other-org-acc' } as never, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.rfq.update).not.toHaveBeenCalled();
    });
  });

  describe('performAction', () => {
    it('transitions "Mark feasible" from Received -> Technically feasible', async () => {
      const record = { id: 'rfq-1', status: 'Received' };
      mockPrisma.rfq.findFirst.mockResolvedValue(record);
      mockPrisma.rfq.update.mockResolvedValue({ ...record, status: 'Technically feasible' });
      await service.performAction('rfq-1', 'Mark feasible', undefined, repUser);
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'Technically feasible' }),
        }),
      );
    });

    it('rejects "Mark feasible" from Not feasible', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', status: 'Not feasible' });
      await expect(service.performAction('rfq-1', 'Mark feasible', undefined, repUser)).rejects.toThrow(BadRequestException);
    });

    it('requires the clarification payload key for "Request clarification"', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', status: 'Received' });
      await expect(service.performAction('rfq-1', 'Request clarification', {}, repUser)).rejects.toThrow(BadRequestException);
    });

    it('requires the nf payload key for "Not feasible"', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', status: 'Received' });
      await expect(service.performAction('rfq-1', 'Not feasible', {}, repUser)).rejects.toThrow(BadRequestException);
    });

    it('"New revision" bumps the revision counter, logs an RfqRevision, and resets status to Received', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Technically feasible', revision: 1 });
      mockPrisma.rfq.update.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', revision: 2, status: 'Received' });
      const result = await service.performAction('rfq-1', 'New revision', { note: 'Updated capacity requirement' }, repUser);
      expect(mockPrisma.rfqRevision.create).toHaveBeenCalledWith({
        data: { rfqId: 'rfq-1', revisionNumber: 2, note: 'Updated capacity requirement', createdById: 'rep-1' },
      });
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith({ where: { id: 'rfq-1' }, data: { revision: 2, status: 'Received' } });
      expect(result).toEqual({ id: 'rfq-1', orgId: 'org-1', revision: 2, status: 'Received' });
    });

    it('"New revision" restarts the SLA-07 timer', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Received', revision: 0 });
      mockPrisma.rfq.update.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', revision: 1, status: 'Received' });
      await service.performAction('rfq-1', 'New revision', undefined, repUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'rfqs', 'Rfq', 'rfq-1', 'Feasible / Not feasible / Clarification');
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'rfqs', 'Rfq', 'rfq-1', 'RFQ received');
    });

    it('stops the SLA-07 timer on "Mark feasible", "Not feasible", and "Request clarification"', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Received' });
      mockPrisma.rfq.update.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Technically feasible' });
      await service.performAction('rfq-1', 'Mark feasible', undefined, repUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'rfqs', 'Rfq', 'rfq-1', 'Feasible / Not feasible / Clarification');
    });
  });

  describe('archive', () => {
    it('sets isDeleted true', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1' });
      mockPrisma.rfq.update.mockResolvedValue({ id: 'rfq-1', isDeleted: true });
      await service.archive('rfq-1', repUser);
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isDeleted: true } }));
    });
  });

  describe('getRevisionEvents', () => {
    it('returns RfqRevision rows mapped to ModuleEventItem shape', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1' });
      mockPrisma.rfqRevision.findMany.mockResolvedValue([
        { id: 'rev-1', rfqId: 'rfq-1', revisionNumber: 1, note: 'Test note', createdAt: new Date('2026-01-01'), createdBy: { name: 'User 1' } },
      ]);
      const result = await service.getRevisionEvents('rfq-1', repUser);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'rev-1',
        label: 'Revision 1',
        description: 'Test note',
        actor: 'User 1',
      });
    });
  });

  describe('decision notes, revision and notifications', () => {
    const rfq = (status: string) => ({ id: 'rfq-1', orgId: 'org-1', custNo: 'C-9', opportunityId: 'opp-1', status, revision: 1 });

    it('create starts at revision 1', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1' });
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.rfq.create.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1' });
      await service.create({ custNo: 'C-1', opportunityId: 'opp-1', accountId: 'acc-1', receivedOn: '2026-10-01', application: 'x', product: 'Weighbridge' } as never, directorUser);
      expect(mockPrisma.rfq.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'Received', revision: 1 }) });
    });

    it('stores the trimmed clarification note and tells the opportunity owner', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue(rfq('Received'));
      mockPrisma.rfq.update.mockResolvedValue(rfq('Clarification required'));
      mockPrisma.opportunity.findFirst.mockResolvedValue({ ownerId: 'sales-1' });
      await service.performAction('rfq-1', 'Request clarification', { clarification: '  Which software?  ' }, directorUser);
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith({ where: { id: 'rfq-1' }, data: { status: 'Clarification required', clarificationNote: 'Which software?' } });
      expect(mockNotifications.create).toHaveBeenCalledWith('org-1', 'sales-1', 'RFQ needs clarification', expect.stringContaining('Which software?'), '/rfqs/rfq-1');
    });

    it('treats a note of only spaces as missing', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue(rfq('Received'));
      await expect(service.performAction('rfq-1', 'Request clarification', { clarification: '   ' }, directorUser)).rejects.toThrow(/'clarification' is required/);
      await expect(service.performAction('rfq-1', 'Not feasible', { nf: ' ' }, directorUser)).rejects.toThrow(/'nf' is required/);
      expect(mockPrisma.rfq.update).not.toHaveBeenCalled();
    });

    it('stores the not-feasible reason without notifying anyone', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue(rfq('Received'));
      mockPrisma.rfq.update.mockResolvedValue(rfq('Not feasible'));
      await service.performAction('rfq-1', 'Not feasible', { nf: 'Accuracy too tight' }, directorUser);
      expect(mockPrisma.rfq.update).toHaveBeenCalledWith({ where: { id: 'rfq-1' }, data: { status: 'Not feasible', notFeasibleReason: 'Accuracy too tight' } });
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('tells the opportunity owner when the clarification is answered (Mark feasible from Clarification required)', async () => {
      mockPrisma.rfq.findFirst.mockResolvedValue(rfq('Clarification required'));
      mockPrisma.rfq.update.mockResolvedValue(rfq('Technically feasible'));
      mockPrisma.opportunity.findFirst.mockResolvedValue({ ownerId: 'sales-1' });
      await service.performAction('rfq-1', 'Mark feasible', {}, directorUser);
      expect(mockNotifications.create).toHaveBeenCalledWith('org-1', 'sales-1', 'RFQ clarification completed', expect.any(String), '/rfqs/rfq-1');
    });
  });
});
