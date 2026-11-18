import { NotFoundException } from '@nestjs/common';
import { PaymentMilestonesAdapter } from './payment-milestones.adapter';
import { PaymentMilestonesService } from './payment-milestones.service';

describe('PaymentMilestonesAdapter', () => {
  let service: jest.Mocked<PaymentMilestonesService>;

  beforeEach(() => {
    service = {
      findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(),
      archive: jest.fn(), performAction: jest.fn(), getEscalationEvents: jest.fn(), getReceipts: jest.fn(),
    } as any;
  });

  it('registers under the payments moduleKey', () => {
    const registry = { register: jest.fn() };
    new PaymentMilestonesAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('payments', expect.anything());
  });

  it('getEvents delegates to getEscalationEvents for the esc tab', async () => {
    const adapter = new PaymentMilestonesAdapter(service, { register: jest.fn() } as any);
    service.getEscalationEvents.mockResolvedValue([]);
    await adapter.getEvents('pm-1', 'esc', {} as any);
    expect(service.getEscalationEvents).toHaveBeenCalledWith('pm-1', {});
  });

  it('getEvents throws NotFoundException for an unknown tab', async () => {
    const adapter = new PaymentMilestonesAdapter(service, { register: jest.fn() } as any);
    await expect(adapter.getEvents('pm-1', 'bogus', {} as any)).rejects.toThrow(NotFoundException);
  });

  it('getRelated delegates to getReceipts for the receipts tab', async () => {
    const adapter = new PaymentMilestonesAdapter(service, { register: jest.fn() } as any);
    service.getReceipts.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    await adapter.getRelated('pm-1', 'receipts', { page: 1, limit: 20 }, {} as any);
    expect(service.getReceipts).toHaveBeenCalledWith('pm-1', { page: 1, limit: 20 }, {});
  });

  it('getRelated throws NotFoundException for an unknown tab', async () => {
    const adapter = new PaymentMilestonesAdapter(service, { register: jest.fn() } as any);
    await expect(adapter.getRelated('pm-1', 'bogus', { page: 1, limit: 20 }, {} as any)).rejects.toThrow(NotFoundException);
  });
});
