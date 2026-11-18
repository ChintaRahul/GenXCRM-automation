import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  product: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  productAttribute: { deleteMany: jest.fn(), createMany: jest.fn() },
  fieldPermission: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn().mockResolvedValue([]),
};

const directorUser: AuthUser = { id: 'u1', name: 'Director', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ProductsService);
  });

  describe('findAll', () => {
    it('scopes findAll to orgId', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 20 }, directorUser);

      expect(mockPrisma.product.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }),
        }),
      );
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('findOne throws NotFoundException outside the org', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findOne('prod-1', directorUser)).rejects.toThrow(NotFoundException);
    });

    it('returns product when found in org', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', status: 'Active', isDeleted: false };
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct as any);

      const result = await service.findOne('prod-1', directorUser);

      expect(result).toEqual(mockProduct);
    });

    it('masks cost/minPrice for a caller restricted from Standard cost / Minimum selling price', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', cost: 500, minPrice: 900, status: 'Active' };
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct as any);
      mockPrisma.fieldPermission.findMany.mockResolvedValueOnce([{ fieldLabel: 'Standard cost' }, { fieldLabel: 'Minimum selling price' }]);

      const salesExec: AuthUser = { ...directorUser, mfgRole: 'SALES_EXECUTIVE' as never };
      const result = await service.findOne('prod-1', salesExec);

      expect(result).toMatchObject({ id: 'prod-1', model: 'Model X' });
      expect(result).not.toHaveProperty('cost');
      expect(result).not.toHaveProperty('minPrice');
    });
  });

  describe('create', () => {
    it('create scopes the new record to the caller org and defaults status to Active', async () => {
      const dto = { category: 'Weighbridges', family: 'F1', model: 'M1', sku: 'S1', price: 100 };
      const mockCreated = { id: 'prod-1', orgId: 'org-1', status: 'Active', ...dto };
      mockPrisma.product.create.mockResolvedValue(mockCreated as any);

      const result = await service.create(dto, directorUser);

      expect(mockPrisma.product.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: 'org-1',
          status: 'Active',
          category: 'Weighbridges',
          family: 'F1',
          model: 'M1',
          sku: 'S1',
          price: 100,
        }),
      });
      expect(result).toEqual(mockCreated);
    });
  });

  describe('update', () => {
    it('update writes the given fields to the record', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', status: 'Active', isDeleted: false };
      const dto = { price: 200 };
      const mockUpdated = { ...mockProduct, price: 200 };

      mockPrisma.product.findFirst.mockResolvedValueOnce(mockProduct as any).mockResolvedValueOnce(mockUpdated as any);

      const result = await service.update('prod-1', dto, directorUser);

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: dto,
      });
      expect(mockPrisma.productAttribute.deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual(mockUpdated);
    });

    it('update replaces all attrs (delete then recreate) when attrs is provided', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', status: 'Active', isDeleted: false };
      const dto = { attrs: [{ name: 'Capacity', value: '50T' }] };

      mockPrisma.product.findFirst.mockResolvedValue(mockProduct as any);

      await service.update('prod-1', dto, directorUser);

      expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'prod-1' }, data: {} });
      expect(mockPrisma.productAttribute.deleteMany).toHaveBeenCalledWith({ where: { productId: 'prod-1' } });
      expect(mockPrisma.productAttribute.createMany).toHaveBeenCalledWith({
        data: [{ name: 'Capacity', value: '50T', productId: 'prod-1' }],
      });
    });
  });

  describe('archive', () => {
    it('archive sets isDeleted true', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', status: 'Active', isDeleted: false };
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct as any);
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, isDeleted: true } as any);

      await service.archive('prod-1', directorUser);

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { isDeleted: true },
      });
    });
  });

  describe('performAction', () => {
    it('performAction "Deactivate" transitions Active -> Inactive', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', status: 'Active', isDeleted: false };
      const mockUpdated = { ...mockProduct, status: 'Inactive' };

      mockPrisma.product.findFirst.mockResolvedValue(mockProduct as any);
      mockPrisma.product.update.mockResolvedValue(mockUpdated as any);

      const result = await service.performAction('prod-1', 'Deactivate', undefined, directorUser);

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { status: 'Inactive' },
      });
      expect(result).toEqual(mockUpdated);
    });

    it('performAction "Activate" rejects from Active', async () => {
      const mockProduct = { id: 'prod-1', orgId: 'org-1', model: 'Model X', status: 'Active', isDeleted: false };
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct as any);

      await expect(service.performAction('prod-1', 'Activate', undefined, directorUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
