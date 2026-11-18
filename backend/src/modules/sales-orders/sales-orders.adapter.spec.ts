import { NotFoundException } from '@nestjs/common';
import { SalesOrdersAdapter } from './sales-orders.adapter';
import { SalesOrdersService } from './sales-orders.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentMilestonesService } from '../payment-milestones/payment-milestones.service';
import { InstalledAssetsService } from '../installed-assets/installed-assets.service';

describe('SalesOrdersAdapter', () => {
  let salesOrders: jest.Mocked<SalesOrdersService>;
  let dispatches: jest.Mocked<DispatchService>;
  let paymentMilestones: jest.Mocked<PaymentMilestonesService>;
  let installedAssets: jest.Mocked<InstalledAssetsService>;
  let adapter: SalesOrdersAdapter;

  beforeEach(() => {
    salesOrders = {
      findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(),
      archive: jest.fn(), performAction: jest.fn(), getMilestoneEvents: jest.fn(),
    } as any;
    dispatches = { findAll: jest.fn() } as any;
    paymentMilestones = { findAll: jest.fn() } as any;
    installedAssets = { findAll: jest.fn() } as any;
    adapter = new SalesOrdersAdapter(salesOrders, dispatches, paymentMilestones, installedAssets, { register: jest.fn() } as any);
  });

  it('registers under the sorders moduleKey', () => {
    const registry = { register: jest.fn() };
    new SalesOrdersAdapter(salesOrders, dispatches, paymentMilestones, installedAssets, registry as any);
    expect(registry.register).toHaveBeenCalledWith('sorders', expect.anything());
  });

  it('getEvents delegates to getMilestoneEvents for the milestones tab', async () => {
    salesOrders.getMilestoneEvents.mockResolvedValue([]);
    await adapter.getEvents('so-1', 'milestones', {} as any);
    expect(salesOrders.getMilestoneEvents).toHaveBeenCalledWith('so-1', {});
  });

  it('getRelated delegates to DispatchService.findAll with salesOrderId for the dispatch tab', async () => {
    dispatches.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    await adapter.getRelated('so-1', 'dispatch', { page: 1, limit: 20 }, {} as any);
    expect(dispatches.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, salesOrderId: 'so-1' }, {});
  });

  it('getRelated delegates to PaymentMilestonesService.findAll with salesOrderId for the payments tab', async () => {
    paymentMilestones.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    await adapter.getRelated('so-1', 'payments', { page: 1, limit: 20 }, {} as any);
    expect(paymentMilestones.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, salesOrderId: 'so-1' }, {});
  });

  it('getRelated delegates to InstalledAssetsService.findAll with salesOrderId for the assets tab', async () => {
    installedAssets.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    await adapter.getRelated('so-1', 'assets', { page: 1, limit: 20 }, {} as any);
    expect(installedAssets.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, salesOrderId: 'so-1' }, {});
  });

  it('getRelated throws NotFoundException for an unknown tab', async () => {
    await expect(adapter.getRelated('so-1', 'bogus', { page: 1, limit: 20 }, {} as any)).rejects.toThrow(NotFoundException);
  });
});
