import { HolidaysAdapter } from './holidays.adapter';
import { HolidaysService } from './holidays.service';

describe('HolidaysAdapter', () => {
  it('registers under the holidays moduleKey', () => {
    const service = {} as HolidaysService;
    const registry = { register: jest.fn() };
    new HolidaysAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('holidays', expect.anything());
  });

  it('delegates list/create/update/archive to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(),
    } as any;
    const adapter = new HolidaysAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.create({ date: '2026-10-02', name: 'Test' }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('h-1', {}, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('h-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
  });
});
