import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { FacebookInsightsService } from './facebook-insights.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';

jest.mock('axios');
jest.mock('../../common/crypto.utils', () => ({
  decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')),
}));

const mockPrisma = {
  orgIntegration: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  campaign: { updateMany: jest.fn() },
  adSet: { updateMany: jest.fn() },
  ad: { updateMany: jest.fn() },
};

const mockQueue = { add: jest.fn() };

describe('FacebookInsightsService', () => {
  let service: FacebookInsightsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        FacebookInsightsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('facebook-insights'), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(FacebookInsightsService);
  });

  describe('syncOrg', () => {
    it('no-ops when the org has no connected ad account', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ adAccountId: null });
      await service.syncOrg('org-1');
      const mockedAxios = jest.requireMock('axios');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('writes spend/impressions/clicks scoped to orgId + externalId for each level', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockImplementation((url: string, opts: { params?: { level?: string } }) => {
        const level = opts?.params?.level;
        if (level === 'campaign') {
          return Promise.resolve({
            data: { data: [{ campaign_id: 'c1', spend: '10.5', impressions: '100', clicks: '5' }] },
          });
        }
        if (level === 'adset') {
          return Promise.resolve({
            data: { data: [{ adset_id: 'as1', spend: '4', impressions: '40', clicks: '2' }] },
          });
        }
        if (level === 'ad') {
          return Promise.resolve({
            data: { data: [{ ad_id: 'ad1', spend: '2', impressions: '20', clicks: '1' }] },
          });
        }
        return Promise.resolve({ data: { data: [] } });
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'c1' },
        data: { spend: 10.5, impressions: 100, clicks: 5 },
      });
      expect(mockPrisma.adSet.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'as1' },
        data: { spend: 4, impressions: 40, clicks: 2 },
      });
      expect(mockPrisma.ad.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'ad1' },
        data: { spend: 2, impressions: 20, clicks: 1 },
      });
      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.FACEBOOK } },
          data: expect.objectContaining({ status: IntegrationStatus.CONNECTED }),
        }),
      );
    });

    it('corrects the placeholder name (set to the raw FB ID at lead ingestion) to the real display name', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockImplementation((url: string, opts: { params?: { level?: string } }) => {
        const level = opts?.params?.level;
        if (level === 'campaign') {
          return Promise.resolve({
            data: {
              data: [{ campaign_id: 'c1', campaign_name: 'Summer Sale', spend: '10', impressions: '100', clicks: '5' }],
            },
          });
        }
        if (level === 'adset') {
          return Promise.resolve({
            data: { data: [{ adset_id: 'as1', adset_name: 'Age 25-34', spend: '4', impressions: '40', clicks: '2' }] },
          });
        }
        if (level === 'ad') {
          return Promise.resolve({
            data: { data: [{ ad_id: 'ad1', ad_name: 'Video Ad A', spend: '2', impressions: '20', clicks: '1' }] },
          });
        }
        return Promise.resolve({ data: { data: [] } });
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'c1' },
        data: { spend: 10, impressions: 100, clicks: 5, name: 'Summer Sale' },
      });
      expect(mockPrisma.adSet.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'as1' },
        data: { spend: 4, impressions: 40, clicks: 2, name: 'Age 25-34' },
      });
      expect(mockPrisma.ad.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'ad1' },
        data: { spend: 2, impressions: 20, clicks: 1, name: 'Video Ad A' },
      });
    });

    it('leaves name untouched when Facebook does not return one for a row', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockImplementation((url: string, opts: { params?: { level?: string } }) => {
        if (opts?.params?.level === 'campaign') {
          return Promise.resolve({ data: { data: [{ campaign_id: 'c1', spend: '10', impressions: '100', clicks: '5' }] } });
        }
        return Promise.resolve({ data: { data: [] } });
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'c1' },
        data: { spend: 10, impressions: 100, clicks: 5 },
      });
    });

    it('corrects a placeholder name via the list endpoints even when Insights has no row for it (no recent spend)', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      // Insights (level-based) calls all return empty — nothing spent in the 1-day window.
      // The name-list endpoints (no `level` param) return every entity regardless.
      mockedAxios.get = jest.fn().mockImplementation((url: string, opts?: { params?: { level?: string; fields?: string } }) => {
        if (opts?.params?.level) return Promise.resolve({ data: { data: [] } });
        if (url.endsWith('/campaigns')) {
          return Promise.resolve({ data: { data: [{ id: 'c1', name: 'Summer Sale' }] } });
        }
        if (url.endsWith('/adsets')) {
          return Promise.resolve({ data: { data: [{ id: 'as1', name: 'Age 25-34' }] } });
        }
        if (url.endsWith('/ads')) {
          return Promise.resolve({ data: { data: [{ id: 'ad1', name: 'Video Ad A' }] } });
        }
        return Promise.resolve({ data: { data: [] } });
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'c1' },
        data: { name: 'Summer Sale' },
      });
      expect(mockPrisma.adSet.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'as1' },
        data: { name: 'Age 25-34' },
      });
      expect(mockPrisma.ad.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', externalId: 'ad1' },
        data: { name: 'Video Ad A' },
      });
    });

    it('never writes rows for a different org (tenant isolation)', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { data: [{ campaign_id: 'c1', spend: '10', impressions: '1', clicks: '1' }] },
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      for (const call of mockPrisma.campaign.updateMany.mock.calls) {
        expect(call[0].where.orgId).toBe('org-1');
      }
    });

    it('marks the integration ERROR on an invalid/expired token (FB error code 190) without throwing', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      const axiosError = { response: { data: { error: { code: 190 } } } };
      mockedAxios.get = jest.fn().mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await expect(service.syncOrg('org-1')).resolves.toBeUndefined();

      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: IntegrationStatus.ERROR, disconnectedAt: expect.any(Date) },
        }),
      );
    });

    it('keeps the earliest disconnectedAt across repeated ERROR writes', async () => {
      const firstOutage = new Date('2026-08-01T00:00:00Z');
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
        disconnectedAt: firstOutage,
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockRejectedValue({ response: { data: { error: { code: 190 } } } });
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: IntegrationStatus.ERROR, disconnectedAt: firstOutage } }),
      );
    });

    it('retries once on a rate-limit error (FB error code 4) before succeeding', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      const rateLimitError = { response: { data: { error: { code: 4 } } } };
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockedAxios.get = jest
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue({ data: { data: [] } });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      // 6 tasks in total (3 insights levels + 3 name-list levels); one of them is retried once.
      expect(mockedAxios.get).toHaveBeenCalledTimes(7);
    }, 10000);

    it('follows paging.next cursors', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountId: 'act_1',
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockImplementation((url: string, opts?: { params?: { level?: string } }) => {
        if (url.includes('next-page')) {
          return Promise.resolve({ data: { data: [{ campaign_id: 'c2', spend: '2', impressions: '2', clicks: '2' }] } });
        }
        if (opts?.params?.level === 'campaign') {
          return Promise.resolve({
            data: {
              data: [{ campaign_id: 'c1', spend: '1', impressions: '1', clicks: '1' }],
              paging: { next: 'https://graph.facebook.com/next-page' },
            },
          });
        }
        return Promise.resolve({ data: { data: [] } });
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      await service.syncOrg('org-1');

      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', externalId: 'c1' } }),
      );
      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', externalId: 'c2' } }),
      );
    });
  });

  describe('enqueueSync / enqueueSyncAllOrgs', () => {
    it('enqueues a sync-org job with attempts + exponential backoff', async () => {
      await service.enqueueSync('org-1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'sync-org',
        { orgId: 'org-1' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    });

    it('enqueues one job per connected org with an active ad account', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([{ orgId: 'org-1' }, { orgId: 'org-2' }]);
      await service.enqueueSyncAllOrgs();
      expect(mockPrisma.orgIntegration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: IntegrationProvider.FACEBOOK,
            status: IntegrationStatus.CONNECTED,
            adAccountId: { not: null },
          }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });
  });
});
