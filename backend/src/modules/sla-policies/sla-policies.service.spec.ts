import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SlaPoliciesService } from './sla-policies.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('SlaPoliciesService', () => {
  let service: SlaPoliciesService;
  let prisma: any;
  const slaEngine = { tick: jest.fn(), runDateTriggeredSweep: jest.fn() };

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;
  const director: AuthUser = { id: 'u3', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;

  beforeEach(async () => {
    prisma = {
      slaPolicy: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [SlaPoliciesService, { provide: PrismaService, useValue: prisma }, { provide: SlaEngineService, useValue: slaEngine }],
    }).compile();
    service = module.get(SlaPoliciesService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.slaPolicy.findMany.mockResolvedValue([]);
      prisma.slaPolicy.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.slaPolicy.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });

    it('filters by search term on name', async () => {
      prisma.slaPolicy.findMany.mockResolvedValue([]);
      prisma.slaPolicy.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, search: 'first response' }, manager);
      const where = prisma.slaPolicy.findMany.mock.calls[0][0].where;
      expect(where.name).toEqual(expect.objectContaining({ contains: 'first response' }));
    });

    it('applies pagination defaults', async () => {
      prisma.slaPolicy.findMany.mockResolvedValue([]);
      prisma.slaPolicy.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, director);
      expect(prisma.slaPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
    });

    it('respects custom page and limit', async () => {
      prisma.slaPolicy.findMany.mockResolvedValue([]);
      prisma.slaPolicy.count.mockResolvedValue(100);
      await service.findAll({ page: 3, limit: 25 }, salesRep);
      expect(prisma.slaPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 25 }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for non-existent record', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(service.findOne('sp-999', manager)).rejects.toThrow(NotFoundException);
    });

    it('returns the record and scopes to orgId', async () => {
      const record = { id: 'sp-1', name: 'Lead first response', orgId: 'org-1' };
      prisma.slaPolicy.findFirst.mockResolvedValue(record);
      const result = await service.findOne('sp-1', manager);
      expect(result).toEqual(record);
      expect(prisma.slaPolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'sp-1', orgId: 'org-1' }),
      }));
    });
  });

  describe('create', () => {
    const dto = {
      moduleKey: 'leads', name: 'Lead first response', startEvent: 'Lead created', stopEvent: 'First call logged',
      calendarType: 'Business hours', targets: [{ condition: 'All leads', value: 2, unit: 'hours' }],
      escalationLevels: [{ atPercent: 75, recipientRole: 'Owner', channels: ['In-app'] }],
    };

    it('creates with orgId and isActive true', async () => {
      prisma.slaPolicy.create.mockResolvedValue({ id: 'sp-1' });
      await service.create(dto as any, manager);
      expect(prisma.slaPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            isActive: true,
            moduleKey: 'leads',
            name: 'Lead first response',
          }),
        }),
      );
    });

    it('passes targets/escalationLevels through as arrays, not stringified', async () => {
      prisma.slaPolicy.create.mockResolvedValue({ id: 'sp-1' });
      await service.create(dto as any, manager);
      const data = prisma.slaPolicy.create.mock.calls[0][0].data;
      expect(Array.isArray(data.targets)).toBe(true);
      expect(Array.isArray(data.escalationLevels)).toBe(true);
    });

    it('defaults pauseStatuses to empty array if not provided', async () => {
      prisma.slaPolicy.create.mockResolvedValue({ id: 'sp-1' });
      await service.create(dto as any, manager);
      const data = prisma.slaPolicy.create.mock.calls[0][0].data;
      expect(data.pauseStatuses).toEqual([]);
    });
  });

  describe('update', () => {
    it('throws NotFoundException if record not found', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(service.update('sp-999', { name: 'Updated' }, manager)).rejects.toThrow(NotFoundException);
    });

    it('updates the record', async () => {
      const existing = { id: 'sp-1', orgId: 'org-1', name: 'Old name' };
      prisma.slaPolicy.findFirst.mockResolvedValue(existing);
      prisma.slaPolicy.update.mockResolvedValue({ id: 'sp-1', name: 'New name' });
      await service.update('sp-1', { name: 'New name' }, manager);
      expect(prisma.slaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sp-1' }, data: { name: 'New name' } }),
      );
    });

    it('updates targets and escalationLevels when present', async () => {
      const existing = { id: 'sp-1', orgId: 'org-1', name: 'Lead first response' };
      prisma.slaPolicy.findFirst.mockResolvedValue(existing);
      const newTargets = [{ condition: 'All leads', value: 4, unit: 'hours' }];
      prisma.slaPolicy.update.mockResolvedValue({ id: 'sp-1', targets: newTargets });
      await service.update('sp-1', { targets: newTargets } as any, manager);
      const data = prisma.slaPolicy.update.mock.calls[0][0].data;
      expect(data.targets).toEqual(newTargets);
    });
  });

  describe('archive', () => {
    it('soft-deletes the record by setting isDeleted to true', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1', orgId: 'org-1' });
      prisma.slaPolicy.update.mockResolvedValue({ id: 'sp-1', isDeleted: true });
      await service.archive('sp-1', manager);
      expect(prisma.slaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sp-1' }, data: { isDeleted: true } }),
      );
    });
  });

  describe('performAction', () => {
    it('Deactivate succeeds when policy is active', async () => {
      const record = { id: 'sp-1', orgId: 'org-1', isActive: true };
      prisma.slaPolicy.findFirst.mockResolvedValue(record);
      prisma.slaPolicy.update.mockResolvedValue({ id: 'sp-1', isActive: false });
      await service.performAction('sp-1', 'Deactivate', undefined, manager);
      expect(prisma.slaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sp-1' }, data: { isActive: false } }),
      );
    });

    it('Deactivate rejects if policy is already inactive', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1', orgId: 'org-1', isActive: false });
      await expect(service.performAction('sp-1', 'Deactivate', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('Activate succeeds when policy is inactive', async () => {
      const record = { id: 'sp-1', orgId: 'org-1', isActive: false };
      prisma.slaPolicy.findFirst.mockResolvedValue(record);
      prisma.slaPolicy.update.mockResolvedValue({ id: 'sp-1', isActive: true });
      await service.performAction('sp-1', 'Activate', undefined, manager);
      expect(prisma.slaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sp-1' }, data: { isActive: true } }),
      );
    });

    it('Activate rejects if policy is already active', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('sp-1', 'Activate', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('Run checks now triggers the escalation check and date sweep for a director', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1', orgId: 'org-1' });
      await service.performAction('sp-1', 'Run checks now', undefined, director);
      expect(slaEngine.tick).toHaveBeenCalled();
      expect(slaEngine.runDateTriggeredSweep).toHaveBeenCalled();
    });

    it('Run checks now is refused for a non-admin', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1', orgId: 'org-1' });
      await expect(service.performAction('sp-1', 'Run checks now', undefined, manager)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for unknown action', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1', orgId: 'org-1' });
      await expect(service.performAction('sp-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
