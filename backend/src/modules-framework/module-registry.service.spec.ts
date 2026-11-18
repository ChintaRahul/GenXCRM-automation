import { NotFoundException } from '@nestjs/common';
import { ModuleRegistryService } from './module-registry.service';
import type { ModuleAdapter } from './module-adapter.interface';

describe('ModuleRegistryService', () => {
  let service: ModuleRegistryService;
  const fakeAdapter: ModuleAdapter = {
    list: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  };

  beforeEach(() => {
    service = new ModuleRegistryService();
  });

  it('resolves a registered adapter by moduleKey', () => {
    service.register('accounts', fakeAdapter);
    expect(service.resolve('accounts')).toBe(fakeAdapter);
  });

  it('throws NotFoundException for an unregistered moduleKey', () => {
    expect(() => service.resolve('rfqs')).toThrow(NotFoundException);
  });
});
