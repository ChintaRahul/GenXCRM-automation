import { Test } from '@nestjs/testing';
import { WorkspaceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HubsService } from '../../integrations/hubs/hubs.service';
import { TradeIndiaSyncService } from './tradeindia-sync.service';
import { fetchTradeIndiaEnquiries } from './tradeindia.client';
import { encryptToken } from '../../common/crypto.utils';

jest.mock('./tradeindia.client');

describe('TradeIndiaSyncService', () => {
  let service: TradeIndiaSyncService;
  const prisma = { orgIntegration: { findMany: jest.fn(), update: jest.fn() } };
  const hubs = { ingest: jest.fn() };
  const row = (orgId: string) => ({
    id: `i-${orgId}`,
    orgId,
    accessToken: encryptToken(`https://www.tradeindia.com/api?key=${orgId}`),
    lastSyncedAt: null,
    org: { workspaceType: WorkspaceType.MANUFACTURING },
  });

  beforeEach(async () => {
    process.env.INTEGRATION_SECRET_KEY = 'a'.repeat(64);
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [TradeIndiaSyncService, { provide: PrismaService, useValue: prisma }, { provide: HubsService, useValue: hubs }],
    }).compile();
    service = module.get(TradeIndiaSyncService);
  });

  it('ingests each org under its own orgId and marks it connected', async () => {
    prisma.orgIntegration.findMany.mockResolvedValue([row('org-1')]);
    jest.mocked(fetchTradeIndiaEnquiries).mockResolvedValue([{ id: 1 }]);
    await service.syncAll();
    expect(hubs.ingest).toHaveBeenCalledWith('tradeindia', [{ id: 1 }], 'org-1', WorkspaceType.MANUFACTURING);
    expect(prisma.orgIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONNECTED' }) }),
    );
  });

  it('marks a failing org as ERROR and still syncs the next one', async () => {
    prisma.orgIntegration.findMany.mockResolvedValue([row('org-1'), row('org-2')]);
    jest.mocked(fetchTradeIndiaEnquiries).mockRejectedValueOnce(new Error('401')).mockResolvedValueOnce([]);
    await service.syncAll();
    expect(prisma.orgIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i-org-1' }, data: { status: 'ERROR' } }));
    expect(hubs.ingest).toHaveBeenCalledWith('tradeindia', [], 'org-2', WorkspaceType.MANUFACTURING);
  });
});
