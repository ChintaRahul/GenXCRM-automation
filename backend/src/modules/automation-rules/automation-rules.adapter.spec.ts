import { NotFoundException } from '@nestjs/common';
import { AutomationRulesAdapter } from './automation-rules.adapter';
import { AutomationRulesService } from './automation-rules.service';

describe('AutomationRulesAdapter', () => {
  let service: jest.Mocked<AutomationRulesService>;

  beforeEach(() => {
    service = {
      findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(),
      archive: jest.fn(), performAction: jest.fn(), getRunEvents: jest.fn(),
    } as any;
  });

  it('registers under the automationRules moduleKey', () => {
    const registry = { register: jest.fn() };
    new AutomationRulesAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('automationRules', expect.anything());
  });

  it('getEvents delegates to getRunEvents for the runs tab', async () => {
    const adapter = new AutomationRulesAdapter(service, { register: jest.fn() } as any);
    service.getRunEvents.mockResolvedValue([]);
    await adapter.getEvents('au-1', 'runs', {} as any);
    expect(service.getRunEvents).toHaveBeenCalledWith('au-1', {});
  });

  it('getEvents throws NotFoundException for an unknown tab', async () => {
    const adapter = new AutomationRulesAdapter(service, { register: jest.fn() } as any);
    await expect(adapter.getEvents('au-1', 'bogus', {} as any)).rejects.toThrow(NotFoundException);
  });
});
