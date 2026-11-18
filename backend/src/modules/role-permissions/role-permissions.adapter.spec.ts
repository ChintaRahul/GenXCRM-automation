import { RolePermissionsAdapter } from './role-permissions.adapter';
import { RolePermissionsService } from './role-permissions.service';

describe('RolePermissionsAdapter', () => {
  it('registers under the rolePermissions moduleKey', () => {
    const service = {} as RolePermissionsService;
    const registry = { register: jest.fn() };
    new RolePermissionsAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('rolePermissions', expect.anything());
  });

  it('delegates list/create/update/archive to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(),
    } as any;
    const adapter = new RolePermissionsAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.create({ role: 'Sales Manager', moduleKey: 'opps' }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('rp-1', {}, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('rp-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
  });
});
