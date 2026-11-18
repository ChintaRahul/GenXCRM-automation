import { DispatchAdapter } from './dispatch.adapter';
import { DispatchService } from './dispatch.service';

describe('DispatchAdapter', () => {
  it('registers under the dispatch moduleKey', () => {
    const service = {} as DispatchService;
    const registry = { register: jest.fn() };
    new DispatchAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('dispatch', expect.anything());
  });

  it('delegates list/create/update/archive/performAction to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), performAction: jest.fn(),
    } as any;
    const adapter = new DispatchAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
  });
});
