import { SlaTimersAdapter } from './sla-timers.adapter';
import { SlaTimersService } from './sla-timers.service';

describe('SlaTimersAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers under the slaTimers moduleKey', () => {
    const service = {} as SlaTimersService;
    const registry = { register: jest.fn() };
    new SlaTimersAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('slaTimers', expect.anything());
  });

  it('delegates list/create/update/archive/performAction to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn().mockResolvedValue({ id: 'st-1' }),
      create: jest.fn().mockResolvedValue({ id: 'st-1' }),
      update: jest.fn().mockResolvedValue({ id: 'st-1' }),
      archive: jest.fn().mockResolvedValue(undefined),
      performAction: jest.fn().mockResolvedValue({ id: 'st-1' }),
    } as any;
    const adapter = new SlaTimersAdapter(service, { register: jest.fn() } as any);

    const createPayload = { slaPolicyId: 'sp-1', entityType: 'Opportunity', entityId: 'op-1' };

    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();

    await adapter.findOne('st-1', {} as any);
    expect(service.findOne).toHaveBeenCalled();

    await adapter.create(createPayload, {} as any);
    expect(service.create).toHaveBeenCalled();

    await adapter.update('st-1', { entityId: 'op-2' }, {} as any);
    expect(service.update).toHaveBeenCalled();

    await adapter.archive('st-1', {} as any);
    expect(service.archive).toHaveBeenCalled();

    await adapter.performAction('st-1', 'Start', undefined, {} as any);
    expect(service.performAction).toHaveBeenCalled();
  });
});
