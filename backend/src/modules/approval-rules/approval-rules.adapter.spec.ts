import { ApprovalRulesAdapter } from './approval-rules.adapter';
import { ApprovalRulesService } from './approval-rules.service';

describe('ApprovalRulesAdapter', () => {
  it('registers under the approvalRules moduleKey', () => {
    const service = {} as ApprovalRulesService;
    const registry = { register: jest.fn() };
    new ApprovalRulesAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('approvalRules', expect.anything());
  });

  it('delegates list/create/update/archive/performAction to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), performAction: jest.fn(),
    } as any;
    const adapter = new ApprovalRulesAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.findOne('ar-1', {} as any);
    expect(service.findOne).toHaveBeenCalled();
    await adapter.create({ type: 'Discount', min: 0, max: 5, approverRole: 'Manager' }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('ar-1', { approverRole: 'Director' }, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('ar-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
    await adapter.performAction('ar-1', 'Deactivate', undefined, {} as any);
    expect(service.performAction).toHaveBeenCalled();
  });
});
