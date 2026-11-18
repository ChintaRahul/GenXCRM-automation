import { ServiceTicketsAdapter } from './service-tickets.adapter';
import { ServiceTicketsService } from './service-tickets.service';

describe('ServiceTicketsAdapter', () => {
  it('registers under the service moduleKey', () => {
    const service = {} as ServiceTicketsService;
    const registry = { register: jest.fn() };
    new ServiceTicketsAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('service', expect.anything());
  });

  it('delegates list/create/update/archive/performAction to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'st-1' }),
      update: jest.fn().mockResolvedValue({ id: 'st-1' }),
      archive: jest.fn().mockResolvedValue(undefined),
      performAction: jest.fn().mockResolvedValue({ id: 'st-1', status: 'Assigned' }),
    } as any;
    const adapter = new ServiceTicketsAdapter(service, { register: jest.fn() } as any);
    const caller = {} as any;

    await adapter.list({ page: 1, limit: 20 } as any, caller);
    expect(service.findAll).toHaveBeenCalled();

    await adapter.create({ description: 'x', accountId: 'a-1', complaintType: 'Breakdown', priority: 'Critical' }, caller);
    expect(service.create).toHaveBeenCalled();

    await adapter.update('st-1', { plant: 'Unit 2' }, caller);
    expect(service.update).toHaveBeenCalled();

    await adapter.archive('st-1', caller);
    expect(service.archive).toHaveBeenCalledWith('st-1', caller);

    await adapter.performAction('st-1', 'Assign engineer', { engineer: 'eng-1' }, caller);
    expect(service.performAction).toHaveBeenCalledWith('st-1', 'Assign engineer', { engineer: 'eng-1' }, caller);
  });
});
