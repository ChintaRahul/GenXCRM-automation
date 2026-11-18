import { NotFoundException } from '@nestjs/common';
import { InstalledAssetsAdapter } from './installed-assets.adapter';
import { InstalledAssetsService } from './installed-assets.service';
import { CoverageService } from '../coverage/coverage.service';
import { ServiceTicketsService } from '../service-tickets/service-tickets.service';

describe('InstalledAssetsAdapter', () => {
  let assets: jest.Mocked<InstalledAssetsService>;
  let coverage: jest.Mocked<CoverageService>;
  let serviceTickets: jest.Mocked<ServiceTicketsService>;
  let adapter: InstalledAssetsAdapter;

  beforeEach(() => {
    assets = {
      findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(),
      archive: jest.fn(), performAction: jest.fn(),
    } as any;
    coverage = { findAll: jest.fn() } as any;
    serviceTickets = { findAll: jest.fn() } as any;
    adapter = new InstalledAssetsAdapter(assets, coverage, serviceTickets, { register: jest.fn() } as any);
  });

  it('registers under the assets moduleKey', () => {
    const registry = { register: jest.fn() };
    new InstalledAssetsAdapter(assets, coverage, serviceTickets, registry as any);
    expect(registry.register).toHaveBeenCalledWith('assets', expect.anything());
  });

  it('getRelated delegates to CoverageService.findAll with assetId for the coverage tab', async () => {
    coverage.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    await adapter.getRelated('as-1', 'coverage', { page: 1, limit: 20 }, {} as any);
    expect(coverage.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, assetId: 'as-1' }, {});
  });

  it('getRelated delegates to ServiceTicketsService.findAll with assetId for the service tab', async () => {
    serviceTickets.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    await adapter.getRelated('as-1', 'service', { page: 1, limit: 20 }, {} as any);
    expect(serviceTickets.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, assetId: 'as-1' }, {});
  });

  it('getRelated throws NotFoundException for an unknown tab', async () => {
    await expect(adapter.getRelated('as-1', 'bogus', { page: 1, limit: 20 }, {} as any)).rejects.toThrow(NotFoundException);
  });
});
