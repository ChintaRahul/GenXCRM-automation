import { SlaPoliciesAdapter } from './sla-policies.adapter';
import { SlaPoliciesService } from './sla-policies.service';

describe('SlaPoliciesAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers under the slaPolicies moduleKey', () => {
    const service = {} as SlaPoliciesService;
    const registry = { register: jest.fn() };
    new SlaPoliciesAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('slaPolicies', expect.anything());
  });

  it('delegates list/create/update/archive/performAction to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn().mockResolvedValue({ id: 'sp-1' }),
      create: jest.fn().mockResolvedValue({ id: 'sp-1' }),
      update: jest.fn().mockResolvedValue({ id: 'sp-1' }),
      archive: jest.fn().mockResolvedValue(undefined),
      performAction: jest.fn().mockResolvedValue({ id: 'sp-1' }),
    } as any;
    const adapter = new SlaPoliciesAdapter(service, { register: jest.fn() } as any);

    // Note: pauseStatuses is intentionally omitted here — it is optional, and omitting it
    // is a regression check for the CreateSlaPolicyDto @IsOptional() fix.
    const createPayload = { moduleKey: 'leads', name: 'Lead first response', startEvent: 'Lead created', stopEvent: 'First call logged', calendarType: 'Business hours', targets: [], escalationLevels: [] };

    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();

    await adapter.findOne('sp-1', {} as any);
    expect(service.findOne).toHaveBeenCalled();

    await adapter.create(createPayload, {} as any);
    expect(service.create).toHaveBeenCalled();

    await adapter.update('sp-1', { name: 'Updated' }, {} as any);
    expect(service.update).toHaveBeenCalled();

    await adapter.archive('sp-1', {} as any);
    expect(service.archive).toHaveBeenCalled();

    await adapter.performAction('sp-1', 'Deactivate', undefined, {} as any);
    expect(service.performAction).toHaveBeenCalled();
  });
});
