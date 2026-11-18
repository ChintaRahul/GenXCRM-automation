import { FieldPermissionsAdapter } from './field-permissions.adapter';
import { FieldPermissionsService } from './field-permissions.service';

describe('FieldPermissionsAdapter', () => {
  it('registers under the fieldPermissions moduleKey', () => {
    const service = {} as FieldPermissionsService;
    const registry = { register: jest.fn() };
    new FieldPermissionsAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('fieldPermissions', expect.anything());
  });

  it('delegates list/create/update/archive to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(),
    } as any;
    const adapter = new FieldPermissionsAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.create({ moduleKey: 'products', fieldLabel: 'Standard cost' }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('fp-1', {}, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('fp-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
  });
});
