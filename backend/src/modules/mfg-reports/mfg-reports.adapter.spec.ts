import { NotFoundException } from '@nestjs/common';
import { MfgReportsAdapter } from './mfg-reports.adapter';
import { MfgReportsService } from './mfg-reports.service';

describe('MfgReportsAdapter', () => {
  let service: jest.Mocked<MfgReportsService>;
  let adapter: MfgReportsAdapter;

  beforeEach(() => {
    service = {
      findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(),
      archive: jest.fn(), performAction: jest.fn(), getDataTable: jest.fn(), getScheduleEvents: jest.fn(),
    } as any;
    adapter = new MfgReportsAdapter(service, { register: jest.fn() } as any);
  });

  it('registers under the reports moduleKey', () => {
    const registry = { register: jest.fn() };
    new MfgReportsAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('reports', expect.anything());
  });

  it('getTable delegates to getDataTable for the data tab', async () => {
    service.getDataTable.mockResolvedValue({ columns: [], rows: [] });
    await adapter.getTable('r-1', 'data', {} as any);
    expect(service.getDataTable).toHaveBeenCalledWith('r-1', {});
  });

  it('getTable throws NotFoundException for an unknown tab', async () => {
    await expect(adapter.getTable('r-1', 'bogus', {} as any)).rejects.toThrow(NotFoundException);
  });

  it('getEvents delegates to getScheduleEvents for the schedule tab', async () => {
    service.getScheduleEvents.mockResolvedValue([]);
    await adapter.getEvents('r-1', 'schedule', {} as any);
    expect(service.getScheduleEvents).toHaveBeenCalledWith('r-1', {});
  });

  it('getEvents throws NotFoundException for an unknown tab', async () => {
    await expect(adapter.getEvents('r-1', 'bogus', {} as any)).rejects.toThrow(NotFoundException);
  });
});
