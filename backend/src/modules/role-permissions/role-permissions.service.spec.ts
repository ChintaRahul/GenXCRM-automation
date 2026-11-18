import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolePermissionsService } from './role-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('RolePermissionsService', () => {
  let service: RolePermissionsService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      rolePermission: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [RolePermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(RolePermissionsService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([]);
      prisma.rolePermission.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.rolePermission.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with requireOrgId-derived orgId', async () => {
      prisma.rolePermission.create.mockResolvedValue({ id: 'rp-1' });
      await service.create({ role: 'Sales Manager', moduleKey: 'opps', canRead: true } as any, manager);
      expect(prisma.rolePermission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', role: 'Sales Manager' }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ id: 'rp-1', orgId: 'org-1' });
      prisma.rolePermission.update.mockResolvedValue({ id: 'rp-1' });
      await service.update('rp-1', { canDelete: true } as any, manager);
      expect(prisma.rolePermission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ canDelete: true }) }),
      );
    });
  });
});
