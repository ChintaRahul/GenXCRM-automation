import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FieldPermissionsService } from './field-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('FieldPermissionsService', () => {
  let service: FieldPermissionsService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      fieldPermission: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [FieldPermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(FieldPermissionsService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.fieldPermission.findMany.mockResolvedValue([]);
      prisma.fieldPermission.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.fieldPermission.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.fieldPermission.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with requireOrgId-derived orgId', async () => {
      prisma.fieldPermission.create.mockResolvedValue({ id: 'fp-1' });
      await service.create({ moduleKey: 'products', fieldLabel: 'Standard cost', restrictedToRoles: ['Sales Executive'] } as any, manager);
      expect(prisma.fieldPermission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', moduleKey: 'products' }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields', async () => {
      prisma.fieldPermission.findFirst.mockResolvedValue({ id: 'fp-1', orgId: 'org-1' });
      prisma.fieldPermission.update.mockResolvedValue({ id: 'fp-1' });
      await service.update('fp-1', { restrictedToRoles: ['Sales Executive', 'Application Engineer'] } as any, manager);
      expect(prisma.fieldPermission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ restrictedToRoles: ['Sales Executive', 'Application Engineer'] }) }),
      );
    });
  });
});
