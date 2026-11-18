import { BusinessCalendarsAdapter } from './business-calendars.adapter';
import { BusinessCalendarsService } from './business-calendars.service';

describe('BusinessCalendarsAdapter', () => {
  it('registers under the businessCalendar moduleKey', () => {
    const service = {} as BusinessCalendarsService;
    const registry = { register: jest.fn() };
    new BusinessCalendarsAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('businessCalendar', expect.anything());
  });

  it('delegates list/create/update/archive to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(),
    } as any;
    const adapter = new BusinessCalendarsAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.create({ days: [] }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('bc-1', {}, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('bc-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
  });
});
