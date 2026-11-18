import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AutomationRulesService } from './automation-rules.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('AutomationRulesService', () => {
  let service: AutomationRulesService;
  let prisma: any;

  const director: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      automationRule: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      automationRun: {
        findMany: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [AutomationRulesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AutomationRulesService);
  });

  describe('findAll', () => {
    it('scopes to orgId and excludes soft-deleted records', async () => {
      prisma.automationRule.findMany.mockResolvedValue([]);
      prisma.automationRule.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, director);
      const where = prisma.automationRule.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1', isDeleted: false }));
    });

    it('includes search filter on trigger field when provided', async () => {
      prisma.automationRule.findMany.mockResolvedValue([]);
      prisma.automationRule.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, search: 'created' }, director);
      const where = prisma.automationRule.findMany.mock.calls[0][0].where;
      expect(where.trigger).toEqual({ contains: 'created', mode: 'insensitive' });
    });

    it('applies pagination with skip and take', async () => {
      prisma.automationRule.findMany.mockResolvedValue([]);
      prisma.automationRule.count.mockResolvedValue(0);
      await service.findAll({ page: 2, limit: 10 }, director);
      const call = prisma.automationRule.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(10);
    });

    it('sorts by createdAt descending by default', async () => {
      prisma.automationRule.findMany.mockResolvedValue([]);
      prisma.automationRule.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, director);
      const call = prisma.automationRule.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('returns paginated response with correct shape', async () => {
      prisma.automationRule.count.mockResolvedValue(50);
      prisma.automationRule.findMany.mockResolvedValue([
        { id: 'au-1', trigger: 'Lead created', condition: 'Any source', action: 'Assign', isActive: true, isDeleted: false, orgId: 'org-1', createdAt: new Date(), updatedAt: new Date() },
      ]);
      const result = await service.findAll({ page: 1, limit: 20 }, director);
      expect(result).toEqual(expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ id: 'au-1' })]),
        total: 50,
        page: 1,
        limit: 20,
        pages: 3,
      }));
    });
  });

  describe('findOne', () => {
    it('returns a single record', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1' });
      const record = await service.findOne('au-1', director);
      expect(record.id).toBe('au-1');
    });

    it('scopes to orgId and excludes soft-deleted records', async () => {
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.findOne('au-1', director)).rejects.toThrow(NotFoundException);
      const where = prisma.automationRule.findFirst.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ id: 'au-1', orgId: 'org-1', isDeleted: false }));
    });

    it('throws NotFoundException when record not found', async () => {
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.findOne('au-999', director)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with record id in message', async () => {
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.findOne('au-1', director)).rejects.toThrow("Automation rule 'au-1' not found.");
    });

    it('throws when orgId is missing (tenant isolation)', async () => {
      const noOrgCaller = { id: 'u1', role: Role.DIRECTOR, orgId: null } as any;
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.findOne('au-1', noOrgCaller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with isActive true and orgId-derived from caller', async () => {
      prisma.automationRule.create.mockResolvedValue({ id: 'au-1' });
      await service.create({ trigger: 'Lead created', condition: 'Any source', action: 'Assign by territory' } as any, director);
      expect(prisma.automationRule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', isActive: true }) }),
      );
    });

    it('includes dto fields in the data payload', async () => {
      prisma.automationRule.create.mockResolvedValue({ id: 'au-1' });
      await service.create({ trigger: 'Lead created', condition: 'Any source', action: 'Assign by territory' } as any, director);
      expect(prisma.automationRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trigger: 'Lead created',
            condition: 'Any source',
            action: 'Assign by territory',
          }),
        }),
      );
    });

    it('throws when orgId is not present', async () => {
      const noOrgCaller = { id: 'u1', role: Role.DIRECTOR, orgId: null } as any;
      await expect(
        service.create({ trigger: 'Lead created', condition: 'Any source', action: 'Assign by territory' } as any, noOrgCaller),
      ).rejects.toThrow();
    });

    it('returns the created record', async () => {
      prisma.automationRule.create.mockResolvedValue({ id: 'au-1', isActive: true, orgId: 'org-1' });
      const result = await service.create({ trigger: 'Lead created', condition: 'Any source', action: 'Assign by territory' } as any, director);
      expect(result.isActive).toBe(true);
      expect(result.orgId).toBe('org-1');
    });

    it('passes all three required fields', async () => {
      prisma.automationRule.create.mockResolvedValue({ id: 'au-1' });
      await service.create({ trigger: 'Lead updated', condition: 'Hot lead', action: 'Route to manager' } as any, director);
      const data = prisma.automationRule.create.mock.calls[0][0].data;
      expect(data).toHaveProperty('trigger', 'Lead updated');
      expect(data).toHaveProperty('condition', 'Hot lead');
      expect(data).toHaveProperty('action', 'Route to manager');
    });
  });

  describe('update', () => {
    it('updates an existing record', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1', trigger: 'Updated' });
      const result = await service.update('au-1', { trigger: 'Updated' } as any, director);
      expect(result.trigger).toBe('Updated');
    });

    it('calls findOne to enforce scoping and existence', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1' });
      await service.update('au-1', {} as any, director);
      expect(prisma.automationRule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('throws NotFoundException if record not found', async () => {
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.update('au-999', {} as any, director)).rejects.toThrow(NotFoundException);
    });

    it('passes only the dto fields to update', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1' });
      await service.update('au-1', { trigger: 'Updated' } as any, director);
      expect(prisma.automationRule.update).toHaveBeenCalledWith({
        where: { id: 'au-1' },
        data: { trigger: 'Updated' },
      });
    });

    it('supports partial updates with any subset of fields', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1' });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1' });
      await service.update('au-1', { condition: 'New condition' } as any, director);
      const data = prisma.automationRule.update.mock.calls[0][0].data;
      expect(data).toEqual({ condition: 'New condition' });
    });
  });

  describe('performAction', () => {
    it('Deactivate succeeds when currently active', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1', isActive: false });
      await service.performAction('au-1', 'Deactivate', undefined, director);
      expect(prisma.automationRule.update).toHaveBeenCalledWith({ where: { id: 'au-1' }, data: { isActive: false } });
    });

    it('Deactivate rejects when already inactive', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: false });
      await expect(service.performAction('au-1', 'Deactivate', undefined, director)).rejects.toThrow(BadRequestException);
    });

    it('Activate succeeds when currently inactive', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: false });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1', isActive: true });
      await service.performAction('au-1', 'Activate', undefined, director);
      expect(prisma.automationRule.update).toHaveBeenCalledWith({ where: { id: 'au-1' }, data: { isActive: true } });
    });

    it('Activate rejects when already active', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('au-1', 'Activate', undefined, director)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('au-1', 'Bogus', undefined, director)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getRunEvents', () => {
    it('returns an empty array when no AutomationRun rows exist yet', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1' });
      prisma.automationRun.findMany.mockResolvedValue([]);
      const events = await service.getRunEvents('au-1', manager);
      expect(events).toEqual([]);
    });

    it('maps existing AutomationRun rows to ModuleEventItem shape', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1' });
      prisma.automationRun.findMany.mockResolvedValue([
        { id: 'run-1', status: 'OK', runAt: new Date('2026-09-29'), details: null },
      ]);
      const events = await service.getRunEvents('au-1', manager);
      expect(events).toEqual([{ id: 'run-1', at: new Date('2026-09-29').toISOString(), label: 'OK', description: undefined }]);
    });

    it('throws NotFoundException and never queries AutomationRun when the parent rule is not found', async () => {
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.getRunEvents('au-1', manager)).rejects.toThrow(NotFoundException);
      expect(prisma.automationRun.findMany).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('soft-deletes a record by setting isDeleted', async () => {
      prisma.automationRule.findFirst.mockResolvedValue({ id: 'au-1', orgId: 'org-1', isActive: true });
      prisma.automationRule.update.mockResolvedValue({ id: 'au-1', isDeleted: true });
      await service.archive('au-1', director);
      expect(prisma.automationRule.update).toHaveBeenCalledWith({
        where: { id: 'au-1' },
        data: { isDeleted: true },
      });
    });
  });
});
