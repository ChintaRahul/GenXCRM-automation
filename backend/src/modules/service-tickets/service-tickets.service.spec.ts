import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ServiceTicketsService } from './service-tickets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockAutomation = { fire: jest.fn().mockResolvedValue(undefined) };

describe('ServiceTicketsService', () => {
  let service: ServiceTicketsService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;
  const director: AuthUser = { id: 'u3', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;

  beforeEach(async () => {
    prisma = {
      mfgActivity: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      serviceTicket: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      account: { findFirst: jest.fn() },
      installedAsset: { findFirst: jest.fn() },
      rolePermission: { findFirst: jest.fn() },
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ServiceTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: AutomationEngineService, useValue: mockAutomation },
      ],
    }).compile();
    service = module.get(ServiceTicketsService);
  });

  describe('findAll', () => {
    it('filters by accountId when passed (for the Account detail page\'s Service tab)', async () => {
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, accountId: 'A-1' }, salesRep);
      expect(prisma.serviceTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountId: 'A-1' }) }),
      );
    });

    it('scopes to engineerId for SALES_REP', async () => {
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      expect(prisma.serviceTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', engineerId: 'u1' }) }),
      );
    });

    it('scopes to orgId only for MANAGER', async () => {
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, manager);
      const where = prisma.serviceTicket.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.engineerId).toBeUndefined();
    });

    it('filters by assetId when provided (used by InstalledAssetsAdapter.getRelated)', async () => {
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, assetId: 'as-1' } as any, manager);
      expect(prisma.serviceTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assetId: 'as-1' }) }),
      );
    });

    it('scopes to orgId only for DIRECTOR', async () => {
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, director);
      const where = prisma.serviceTicket.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.engineerId).toBeUndefined();
    });
  });

  describe('record access by Manufacturing role', () => {
    const serviceManager = { id: 'u7', orgId: 'org-1', role: Role.SALES_REP, mfgRole: 'SERVICE_MANAGER' } as unknown as AuthUser;
    const serviceEngineer = { id: 'u8', orgId: 'org-1', role: Role.SALES_REP, mfgRole: 'SERVICE_ENGINEER' } as unknown as AuthUser;

    it('lets a Service Manager (access: all) see tickets nobody is assigned to yet', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, serviceManager);
      const where = prisma.serviceTicket.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ orgId: 'org-1' });
      expect(where).not.toHaveProperty('engineerId');
    });

    it('limits a Service Engineer (access: own) to the tickets assigned to them', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
      prisma.serviceTicket.findMany.mockResolvedValue([]);
      prisma.serviceTicket.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, serviceEngineer);
      expect(prisma.serviceTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', engineerId: 'u8' }) }),
      );
    });

    it('lets a Service Manager open a ticket she just created (findOne is not limited to her own)', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 't1', orgId: 'org-1' });
      await service.findOne('t1', serviceManager);
      const where = prisma.serviceTicket.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({ id: 't1', orgId: 'org-1', isDeleted: false });
      expect(where).not.toHaveProperty('engineerId');
    });
  });

  describe('create', () => {
    const dto = { description: 'Unstable readings', accountId: 'a-1', complaintType: 'Breakdown', priority: 'Critical' };

    it('rejects an accountId from another org', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an assetId from another org when present', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...dto, assetId: 'other-org-asset' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('books a review task for the account owner when an asset reaches 3 tickets in 180 days', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1', ownerId: 'u-owner' });
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1' });
      prisma.serviceTicket.create.mockResolvedValue({ id: 'st-3', orgId: 'org-1', assetId: 'as-1', accountId: 'a-1', priority: 'High' });
      prisma.serviceTicket.count.mockResolvedValue(3);
      await service.create({ ...dto, assetId: 'as-1' } as any, manager);
      expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', accountId: 'a-1', ownerId: 'u-owner', subject: 'Review repeat failures on asset' }) });
    });

    it('does not flag an asset with fewer than 3 recent tickets', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1' });
      prisma.serviceTicket.create.mockResolvedValue({ id: 'st-2', orgId: 'org-1', assetId: 'as-1', accountId: 'a-1' });
      prisma.serviceTicket.count.mockResolvedValue(2);
      await service.create({ ...dto, assetId: 'as-1' } as any, manager);
      expect(prisma.mfgActivity.create).not.toHaveBeenCalled();
    });

    it.each([
      ['Under warranty', 'In warranty', false],
      ['Under AMC', 'Under AMC', false],
      ['Out of coverage', 'Chargeable', true],
    ])('derives coverage from a %s asset', async (assetStatus, coverage, chargeable) => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', status: assetStatus });
      prisma.serviceTicket.create.mockResolvedValue({ id: 'st-9', orgId: 'org-1' });
      await service.create({ ...dto, assetId: 'as-1' } as any, manager);
      expect(prisma.serviceTicket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coverage, chargeable }) });
    });

    it('creates with status Open', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.serviceTicket.create.mockResolvedValue({ id: 'st-1' });
      await service.create(dto as any, manager);
      expect(prisma.serviceTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Open' }) }),
      );
    });

    it('starts the SLA-19/SLA-20 timers with priority as context', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.serviceTicket.create.mockResolvedValue({ id: 'st-1', orgId: 'org-1', priority: 'Critical' });
      await service.create({ ...dto, priority: 'Critical' } as any, manager);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'service', 'ServiceTicket', 'st-1', 'Ticket created', 'Critical');
    });
  });

  describe('update', () => {
    it('rejects an accountId from another org when present', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.update('st-1', { accountId: 'other-org-acc' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects an assetId from another org when present', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      prisma.installedAsset.findFirst.mockResolvedValue(null);
      await expect(service.update('st-1', { assetId: 'other-org-asset' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('merges plain fields', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.update('st-1', { plant: 'Unit 2' } as any, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plant: 'Unit 2' }) }),
      );
    });

    it('passes through the manually settable fields (responseDue, diagnosis, action, customerConfirmation, chargeable)', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.update('st-1', { chargeable: true } as any, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ chargeable: true }) }),
      );
    });
  });

  describe('performAction', () => {
    it('Assign engineer: requires engineer payload, writes engineerId, when Open', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Assign engineer', undefined, manager)).rejects.toThrow(BadRequestException);
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1', orgId: 'org-1' });
      await service.performAction('st-1', 'Assign engineer', { engineer: 'eng-1' }, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { status: 'Assigned', engineerId: 'eng-1' },
      });
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'service', 'ServiceTicket', 'st-1', 'Engineer assigned + customer contacted');
    });

    it('Assign engineer rejects from a non-Open status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Closed' });
      await expect(service.performAction('st-1', 'Assign engineer', { engineer: 'eng-1' }, manager)).rejects.toThrow(BadRequestException);
    });

    it('Schedule visit: requires visitDate payload, converts it, when Assigned', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Assigned' });
      await expect(service.performAction('st-1', 'Schedule visit', undefined, manager)).rejects.toThrow(BadRequestException);
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Schedule visit', { visitDate: '2026-10-15' }, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { status: 'Visit scheduled', visitDate: new Date('2026-10-15') },
      });
    });

    it('Schedule visit rejects from a non-Assigned status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Schedule visit', { visitDate: '2026-10-15' }, manager)).rejects.toThrow(BadRequestException);
    });

    it('Start work succeeds from Visit scheduled', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Visit scheduled' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Start work', undefined, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'In progress' } });
    });

    it('Start work succeeds from Assigned', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Assigned' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Start work', undefined, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'In progress' } });
    });

    it('Start work succeeds from Parts required', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Parts required' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Start work', undefined, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'In progress' } });
    });

    it('Start work rejects from a non-eligible status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Start work', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('Parts required: requires parts payload, writes partsRequired', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'In progress' });
      await expect(service.performAction('st-1', 'Parts required', undefined, manager)).rejects.toThrow(BadRequestException);
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Parts required', { parts: 'Load cell' }, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { status: 'Parts required', partsRequired: 'Load cell' },
      });
    });

    it('Parts required rejects from a non-In progress status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Parts required', { parts: 'Load cell' }, manager)).rejects.toThrow(BadRequestException);
    });

    it('Resolve: requires resolution payload, writes resolution', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'In progress' });
      await expect(service.performAction('st-1', 'Resolve', undefined, manager)).rejects.toThrow(BadRequestException);
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1', orgId: 'org-1' });
      await service.performAction('st-1', 'Resolve', { resolution: 'Replaced load cell' }, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { status: 'Resolved', resolution: 'Replaced load cell' },
      });
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'service', 'ServiceTicket', 'st-1', 'Resolved');
    });

    it('Resolve rejects from a non-In progress status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Resolve', { resolution: 'x' }, manager)).rejects.toThrow(BadRequestException);
    });

    it('Request confirmation succeeds from Resolved', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Resolved' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Request confirmation', undefined, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'Customer confirmation' } });
    });

    it('Request confirmation rejects from a non-Resolved status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Request confirmation', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('Close succeeds from Customer confirmation', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Customer confirmation' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Close', undefined, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'Closed' } });
    });

    it('Close succeeds from Resolved', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Resolved' });
      prisma.serviceTicket.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Close', undefined, manager);
      expect(prisma.serviceTicket.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'Closed' } });
    });

    it('Close rejects from a non-eligible status', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Close', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.serviceTicket.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Open' });
      await expect(service.performAction('st-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
