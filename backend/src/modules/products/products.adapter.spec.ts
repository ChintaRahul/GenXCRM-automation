import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { ProductsAdapter } from './products.adapter';
import { ProductsService } from './products.service';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const directorUser: AuthUser = { id: 'u1', name: 'Director', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('ProductsAdapter', () => {
  let adapter: ProductsAdapter;
  let service: jest.Mocked<ProductsService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ProductsAdapter,
        {
          provide: ProductsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            archive: jest.fn(),
            performAction: jest.fn(),
          },
        },
        {
          provide: ModuleRegistryService,
          useValue: { register: jest.fn() },
        },
      ],
    }).compile();

    adapter = module.get(ProductsAdapter);
    service = module.get(ProductsService);
  });

  describe('create', () => {
    it('rejects invalid DTO', async () => {
      const invalidDto = { category: 'InvalidCategory', family: 'F1', model: 'M1', sku: 'S1', price: 100 };

      await expect(adapter.create(invalidDto, directorUser)).rejects.toThrow();
    });

    it('creates product with valid DTO', async () => {
      const validDto = { category: 'Weighbridges', family: 'F1', model: 'M1', sku: 'S1', price: 100 };
      const mockCreated = { id: 'prod-1', orgId: 'org-1', ...validDto, status: 'Active' };

      service.create.mockResolvedValue(mockCreated as any);

      const result = await adapter.create(validDto, directorUser);

      expect(service.create).toHaveBeenCalled();
      expect(result).toEqual(mockCreated);
    });
  });

  describe('update', () => {
    it('passes attrs through to the service for the Specification attributes tab', async () => {
      const dto = { attrs: [{ name: 'Capacity', value: '50T' }] };
      service.update.mockResolvedValue({ id: 'prod-1', ...dto } as any);

      await adapter.update('prod-1', dto, directorUser);

      expect(service.update).toHaveBeenCalledWith(
        'prod-1',
        expect.objectContaining({ attrs: [{ name: 'Capacity', value: '50T' }] }),
        directorUser,
      );
    });
  });
});
