import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { assertModuleAccess, canActAcrossOwners, getModuleRights, getReadableModuleKeys, resolveOwnerScope } from './record-access.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { PrismaService } from '../../prisma/prisma.service';

describe('record-access.util', () => {
  const rolePermissionFindFirst = jest.fn();
  const rolePermissionFindMany = jest.fn();
  const userFindMany = jest.fn();
  const teamFindMany = jest.fn();
  const mockPrisma = {
    rolePermission: { findFirst: rolePermissionFindFirst, findMany: rolePermissionFindMany },
    user: { findMany: userFindMany },
    team: { findMany: teamFindMany },
  } as unknown as PrismaService;

  beforeEach(() => { jest.clearAllMocks(); teamFindMany.mockResolvedValue([]); });

  const baseCaller: AuthUser = { id: 'u1', name: 'U', email: 'u@test.com', role: Role.MANAGER, teamId: 't1', orgId: 'org-1' };

  describe('resolveOwnerScope', () => {
    it('returns empty scope when caller has no orgId', async () => {
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, orgId: null }, 'opps');
      expect(result).toEqual({});
      expect(rolePermissionFindFirst).not.toHaveBeenCalled();
    });

    it('falls back to legacy SALES_REP-only-own behavior when mfgRole is unset', async () => {
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, role: Role.SALES_REP, mfgRole: null }, 'opps');
      expect(result).toEqual({ ownerId: 'u1' });
      expect(rolePermissionFindFirst).not.toHaveBeenCalled();
    });

    it('falls back to legacy org-wide behavior for non-SALES_REP when mfgRole is unset', async () => {
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, role: Role.MANAGER, mfgRole: null }, 'opps');
      expect(result).toEqual({});
    });

    it('looks up RolePermission scoped to orgId, mfgRole and moduleKey', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'ALL' } as never);
      await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_MANAGER' }, 'opps');
      expect(rolePermissionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_MANAGER', moduleKey: 'opps', isDeleted: false } }),
      );
    });

    it('returns empty scope (org-wide) for ALL', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'ALL' } as never);
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_HEAD' }, 'opps');
      expect(result).toEqual({});
    });

    it('returns ownerId in team-member list for TEAM', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'TEAM' } as never);
      userFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }] as never);
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_MANAGER' }, 'opps');
      expect(userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', teamId: { in: ['t1'] } } }),
      );
      expect(result).toEqual({ ownerId: { in: ['u1', 'u2'] } });
    });

    it('TEAM includes a team the caller manages but does not belong to, plus own records', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'TEAM' } as never);
      teamFindMany.mockResolvedValue([{ id: 't9' }] as never);
      userFindMany.mockResolvedValue([{ id: 'u7' }] as never);
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_MANAGER', teamId: null }, 'opps');
      expect(teamFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-1', managerId: 'u1' } }));
      expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-1', teamId: { in: ['t9'] } } }));
      expect(result).toEqual({ ownerId: { in: ['u1', 'u7'] } });
    });

    it('TEAM falls back to own-only when caller has no teamId', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'TEAM' } as never);
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_MANAGER', teamId: null }, 'opps');
      expect(result).toEqual({ ownerId: 'u1' });
      expect(userFindMany).not.toHaveBeenCalled();
    });

    it('returns ownerId: caller.id for OWN', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'OWN' } as never);
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' }, 'opps');
      expect(result).toEqual({ ownerId: 'u1' });
    });

    it('defaults to OWN when no matching RolePermission row exists', async () => {
      rolePermissionFindFirst.mockResolvedValue(null);
      const result = await resolveOwnerScope(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' }, 'opps');
      expect(result).toEqual({ ownerId: 'u1' });
    });
  });

  describe('canActAcrossOwners', () => {
    it('mirrors legacy Role check when mfgRole is unset', async () => {
      await expect(canActAcrossOwners(mockPrisma, { ...baseCaller, role: Role.SALES_REP, mfgRole: null }, 'opps')).resolves.toBe(false);
      await expect(canActAcrossOwners(mockPrisma, { ...baseCaller, role: Role.MANAGER, mfgRole: null }, 'opps')).resolves.toBe(true);
    });

    it('returns false only for OWN scope when mfgRole is set', async () => {
      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'OWN' } as never);
      await expect(canActAcrossOwners(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' }, 'opps')).resolves.toBe(false);

      rolePermissionFindFirst.mockResolvedValue({ recordAccess: 'TEAM' } as never);
      await expect(canActAcrossOwners(mockPrisma, { ...baseCaller, mfgRole: 'SALES_MANAGER' }, 'opps')).resolves.toBe(true);
    });
  });

  describe('getReadableModuleKeys', () => {
    it('returns null (unrestricted) when mfgRole is unset', async () => {
      await expect(getReadableModuleKeys(mockPrisma, { ...baseCaller, mfgRole: null })).resolves.toBeNull();
      expect(rolePermissionFindMany).not.toHaveBeenCalled();
    });

    it('returns the org-scoped module keys the role can read', async () => {
      rolePermissionFindMany.mockResolvedValue([{ moduleKey: 'leads' }, { moduleKey: 'opps' }]);
      await expect(getReadableModuleKeys(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' })).resolves.toEqual(['leads', 'opps']);
      expect(rolePermissionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', role: 'SALES_EXECUTIVE', canRead: true }) }),
      );
    });
  });

  describe('getModuleRights', () => {
    it('returns null (unrestricted) when mfgRole is unset', async () => {
      await expect(getModuleRights(mockPrisma, { ...baseCaller, mfgRole: null })).resolves.toBeNull();
      expect(rolePermissionFindMany).not.toHaveBeenCalled();
    });

    it('maps each module to what the role may create / read / update / delete (org-scoped)', async () => {
      rolePermissionFindMany.mockResolvedValue([
        { moduleKey: 'leads', canCreate: false, canRead: true, canUpdate: true, canDelete: false },
        { moduleKey: 'opps', canCreate: true, canRead: true, canUpdate: false, canDelete: false },
      ]);
      await expect(getModuleRights(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' })).resolves.toEqual({
        leads: { create: false, read: true, update: true, delete: false },
        opps: { create: true, read: true, update: false, delete: false },
      });
      expect(rolePermissionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', role: 'SALES_EXECUTIVE' }) }),
      );
    });
  });

  describe('admin config modules', () => {
    const admin = (role: Role): AuthUser => ({ ...baseCaller, role, mfgRole: 'SALES_EXECUTIVE' });

    it.each(['create', 'read', 'update', 'delete'] as const)('lets a DIRECTOR %s approvalRules without a RolePermission row', async (op) => {
      await expect(assertModuleAccess(mockPrisma, admin(Role.DIRECTOR), 'approvalRules', op)).resolves.toBeUndefined();
      expect(rolePermissionFindFirst).not.toHaveBeenCalled();
    });

    it('lets a MANAGER read but not write config modules', async () => {
      await expect(assertModuleAccess(mockPrisma, admin(Role.MANAGER), 'masters', 'read')).resolves.toBeUndefined();
      await expect(assertModuleAccess(mockPrisma, admin(Role.MANAGER), 'masters', 'update')).rejects.toThrow(ForbiddenException);
      await expect(assertModuleAccess(mockPrisma, admin(Role.MANAGER), 'masters', 'create')).rejects.toThrow(ForbiddenException);
    });

    it('denies a SALES_REP every operation on config modules, even with a permissive matrix row', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: true, canDelete: true });
      await expect(assertModuleAccess(mockPrisma, admin(Role.SALES_REP), 'rolePermissions', 'read')).rejects.toThrow(ForbiddenException);
      await expect(assertModuleAccess(mockPrisma, admin(Role.SALES_REP), 'holidays', 'update')).rejects.toThrow(ForbiddenException);
    });

    it('still applies the matrix to domain modules for a DIRECTOR (no blanket bypass)', async () => {
      rolePermissionFindFirst.mockResolvedValue(null);
      await expect(assertModuleAccess(mockPrisma, admin(Role.DIRECTOR), 'costing', 'read')).rejects.toThrow(ForbiddenException);
    });

    it('does not scope config records to an owner, and lets admins act across owners', async () => {
      expect(await resolveOwnerScope(mockPrisma, admin(Role.MANAGER), 'masters')).toEqual({});
      expect(await canActAcrossOwners(mockPrisma, admin(Role.DIRECTOR), 'masters')).toBe(true);
      expect(rolePermissionFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertModuleAccess', () => {
    it('is a no-op (unrestricted) when mfgRole is unset', async () => {
      await expect(assertModuleAccess(mockPrisma, { ...baseCaller, mfgRole: null }, 'costing', 'delete')).resolves.toBeUndefined();
      expect(rolePermissionFindFirst).not.toHaveBeenCalled();
    });

    it('resolves when the matching RolePermission row grants the operation', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: false, canDelete: false });
      await expect(assertModuleAccess(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' }, 'opps', 'create')).resolves.toBeUndefined();
      expect(rolePermissionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'opps', isDeleted: false } }),
      );
    });

    it('throws ForbiddenException when the matching row denies the operation', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: false, canDelete: false });
      await expect(assertModuleAccess(mockPrisma, { ...baseCaller, mfgRole: 'SERVICE_ENGINEER' }, 'costing', 'update')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException (fails closed) when mfgRole is set but no RolePermission row exists', async () => {
      rolePermissionFindFirst.mockResolvedValue(null);
      await expect(assertModuleAccess(mockPrisma, { ...baseCaller, mfgRole: 'SERVICE_ENGINEER' }, 'costing', 'read')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('checks canDelete for the delete op', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: true, canDelete: false });
      await expect(assertModuleAccess(mockPrisma, { ...baseCaller, mfgRole: 'SALES_EXECUTIVE' }, 'opps', 'delete')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
