import { Role } from '@prisma/client';
import { isModuleFullyRestricted, maskRestrictedFields, maskRestrictedFieldsMany } from './field-permission.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { PrismaService } from '../../prisma/prisma.service';

describe('field-permission.util', () => {
  const fieldPermissionFindMany = jest.fn();
  const fieldPermissionFindFirst = jest.fn();
  const mockPrisma = {
    fieldPermission: { findMany: fieldPermissionFindMany, findFirst: fieldPermissionFindFirst },
  } as unknown as PrismaService;

  beforeEach(() => jest.clearAllMocks());

  const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@test.com', role: Role.SALES_REP, teamId: null, orgId: 'org-1', mfgRole: 'SALES_EXECUTIVE' };

  describe('maskRestrictedFields', () => {
    it('returns the record unchanged when no restrictions match', async () => {
      fieldPermissionFindMany.mockResolvedValue([]);
      const record = { id: 'P-1', cost: 500, price: 900 };
      await expect(maskRestrictedFields(record, 'products', caller, mockPrisma)).resolves.toEqual(record);
    });

    it('removes the mapped field for a matching restriction', async () => {
      fieldPermissionFindMany.mockResolvedValue([{ fieldLabel: 'Standard cost' }]);
      const record = { id: 'P-1', cost: 500, price: 900 };
      const result = await maskRestrictedFields(record, 'products', caller, mockPrisma);
      expect(result).toEqual({ id: 'P-1', price: 900 });
      expect(fieldPermissionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: 'org-1', moduleKey: 'products', isDeleted: false, restrictedToRoles: { has: 'SALES_EXECUTIVE' } },
        }),
      );
    });

    it('falls back to caller.role when mfgRole is unset', async () => {
      fieldPermissionFindMany.mockResolvedValue([]);
      await maskRestrictedFields({ id: '1' }, 'products', { ...caller, mfgRole: null }, mockPrisma);
      expect(fieldPermissionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ restrictedToRoles: { has: Role.SALES_REP } }) }),
      );
    });

    it('masks both keys for a two-field restriction (Approval thresholds)', async () => {
      fieldPermissionFindMany.mockResolvedValue([{ fieldLabel: 'Approval thresholds' }]);
      const record = { id: 'AR-1', min: 5, max: 10, type: 'Discount' };
      const result = await maskRestrictedFields(record, 'admin-approval-rules', caller, mockPrisma);
      expect(result).toEqual({ id: 'AR-1', type: 'Discount' });
    });
  });

  describe('maskRestrictedFieldsMany', () => {
    it('masks every record in the array', async () => {
      fieldPermissionFindMany.mockResolvedValue([{ fieldLabel: 'Competitor pricing' }]);
      const records = [{ id: 'OP-1', competitor: 'Acme' }, { id: 'OP-2', competitor: 'Beta' }];
      const result = await maskRestrictedFieldsMany(records, 'opps', caller, mockPrisma);
      expect(result).toEqual([{ id: 'OP-1' }, { id: 'OP-2' }]);
    });

    it('returns an empty array without querying', async () => {
      const result = await maskRestrictedFieldsMany([], 'opps', caller, mockPrisma);
      expect(result).toEqual([]);
      expect(fieldPermissionFindMany).not.toHaveBeenCalled();
    });
  });

  describe('isModuleFullyRestricted', () => {
    it('returns true when a matching whole-record restriction exists', async () => {
      fieldPermissionFindFirst.mockResolvedValue({ id: 'FP-1' });
      await expect(isModuleFullyRestricted(mockPrisma, caller, 'costing', 'Costing & margin')).resolves.toBe(true);
      expect(fieldPermissionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: 'org-1', moduleKey: 'costing', fieldLabel: 'Costing & margin', isDeleted: false, restrictedToRoles: { has: 'SALES_EXECUTIVE' } },
        }),
      );
    });

    it('returns false when no restriction exists', async () => {
      fieldPermissionFindFirst.mockResolvedValue(null);
      await expect(isModuleFullyRestricted(mockPrisma, caller, 'costing', 'Costing & margin')).resolves.toBe(false);
    });

    it('returns false when caller has no orgId', async () => {
      await expect(isModuleFullyRestricted(mockPrisma, { ...caller, orgId: null }, 'costing', 'Costing & margin')).resolves.toBe(false);
      expect(fieldPermissionFindFirst).not.toHaveBeenCalled();
    });
  });
});
