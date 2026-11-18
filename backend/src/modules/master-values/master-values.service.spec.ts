import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MasterValuesService } from './master-values.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('MasterValuesService', () => {
  let service: MasterValuesService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      masterValue: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [MasterValuesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MasterValuesService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role, including SALES_REP (no ownerId on this model)', async () => {
      prisma.masterValue.findMany.mockResolvedValue([]);
      prisma.masterValue.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.masterValue.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });
    it('search matches category, label or value, still scoped to orgId', async () => {
      prisma.masterValue.findMany.mockResolvedValue([]);
      prisma.masterValue.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, search: 'Negotiation' }, manager);
      const where = prisma.masterValue.findMany.mock.calls[0][0].where;
      expect(where.orgId).toBe('org-1');
      expect(where.OR).toEqual([
        { category: { contains: 'Negotiation', mode: 'insensitive' } },
        { label: { contains: 'Negotiation', mode: 'insensitive' } },
        { value: { contains: 'Negotiation', mode: 'insensitive' } },
      ]);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.masterValue.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with status isActive true and requireOrgId-derived orgId', async () => {
      prisma.masterValue.create.mockResolvedValue({ id: 'mv-1' });
      await service.create({ category: 'sources', value: 'indiamart', label: 'IndiaMART' } as any, manager);
      expect(prisma.masterValue.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', isActive: true }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields', async () => {
      prisma.masterValue.findFirst.mockResolvedValue({ id: 'mv-1', orgId: 'org-1', isActive: true });
      prisma.masterValue.update.mockResolvedValue({ id: 'mv-1' });
      await service.update('mv-1', { label: 'Updated' } as any, manager);
      expect(prisma.masterValue.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ label: 'Updated' }) }),
      );
    });
  });

  describe('performAction', () => {
    it('Deactivate succeeds when currently active', async () => {
      prisma.masterValue.findFirst.mockResolvedValue({ id: 'mv-1', orgId: 'org-1', isActive: true });
      prisma.masterValue.update.mockResolvedValue({ id: 'mv-1', isActive: false });
      await service.performAction('mv-1', 'Deactivate', undefined, manager);
      expect(prisma.masterValue.update).toHaveBeenCalledWith({ where: { id: 'mv-1' }, data: { isActive: false } });
    });

    it('Deactivate rejects when already inactive', async () => {
      prisma.masterValue.findFirst.mockResolvedValue({ id: 'mv-1', orgId: 'org-1', isActive: false });
      await expect(service.performAction('mv-1', 'Deactivate', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('Activate succeeds when currently inactive', async () => {
      prisma.masterValue.findFirst.mockResolvedValue({ id: 'mv-1', orgId: 'org-1', isActive: false });
      prisma.masterValue.update.mockResolvedValue({ id: 'mv-1', isActive: true });
      await service.performAction('mv-1', 'Activate', undefined, manager);
      expect(prisma.masterValue.update).toHaveBeenCalledWith({ where: { id: 'mv-1' }, data: { isActive: true } });
    });

    it('Activate rejects when already active', async () => {
      prisma.masterValue.findFirst.mockResolvedValue({ id: 'mv-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('mv-1', 'Activate', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.masterValue.findFirst.mockResolvedValue({ id: 'mv-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('mv-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
