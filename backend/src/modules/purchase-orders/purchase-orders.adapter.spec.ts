import { NotFoundException } from '@nestjs/common';
import { PurchaseOrdersAdapter } from './purchase-orders.adapter';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersAdapter', () => {
  let adapter: PurchaseOrdersAdapter;
  let service: jest.Mocked<PurchaseOrdersService>;

  beforeEach(() => {
    service = {
      findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(),
      archive: jest.fn(), performAction: jest.fn(), getCompareTable: jest.fn(),
    } as any;
    adapter = new PurchaseOrdersAdapter(service, { register: jest.fn() } as any);
  });

  it('registers under the pos moduleKey', () => {
    const registry = { register: jest.fn() };
    new PurchaseOrdersAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('pos', expect.anything());
  });

  it('getTable delegates to getCompareTable for the compare tab', async () => {
    service.getCompareTable.mockResolvedValue({ columns: [], rows: [] });
    await adapter.getTable('po-1', 'compare', {} as any);
    expect(service.getCompareTable).toHaveBeenCalledWith('po-1', {});
  });

  it('getTable throws NotFoundException for an unknown tab', async () => {
    await expect(adapter.getTable('po-1', 'bogus', {} as any)).rejects.toThrow(NotFoundException);
  });
});
