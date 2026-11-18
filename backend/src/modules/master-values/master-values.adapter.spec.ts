import { MasterValuesAdapter } from './master-values.adapter';
import { MasterValuesService } from './master-values.service';

describe('MasterValuesAdapter', () => {
  it('registers under the masters moduleKey', () => {
    const service = {} as MasterValuesService;
    const registry = { register: jest.fn() };
    new MasterValuesAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('masters', expect.anything());
  });

  it('delegates list/create/update/archive/performAction to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), performAction: jest.fn(),
    } as any;
    const adapter = new MasterValuesAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.findOne('mv-1', {} as any);
    expect(service.findOne).toHaveBeenCalled();
    await adapter.create({ category: 'test', value: 'test', label: 'Test' }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('mv-1', { label: 'Updated' }, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('mv-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
    await adapter.performAction('mv-1', 'Deactivate', undefined, {} as any);
    expect(service.performAction).toHaveBeenCalled();
  });
});
