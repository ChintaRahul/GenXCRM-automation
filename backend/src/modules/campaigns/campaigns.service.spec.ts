import { Test } from '@nestjs/testing';
import { LeadSource, Role } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  campaign: { upsert: jest.fn(), findMany: jest.fn() },
  adSet: { upsert: jest.fn() },
  ad: { upsert: jest.fn() },
};

const directorUser: AuthUser = {
  id: 'dir-1',
  name: 'Director',
  email: 'dir@test.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

describe('CampaignsService', () => {
  let service: CampaignsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [CampaignsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CampaignsService);
  });

  describe('resolveHierarchy', () => {
    it('returns empty object when orgId or campaign name is missing', async () => {
      expect(await service.resolveHierarchy(undefined, LeadSource.FACEBOOK, { campaign: 'X' })).toEqual({});
      expect(await service.resolveHierarchy('org-1', LeadSource.FACEBOOK, {})).toEqual({});
    });

    it('upserts campaign only when adSet/ad are not provided, keyed by externalId', async () => {
      mockPrisma.campaign.upsert.mockResolvedValue({ id: 'camp-1' });
      const result = await service.resolveHierarchy('org-1', LeadSource.FACEBOOK, { campaign: '120250920581520561' });

      expect(mockPrisma.campaign.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_externalId: { orgId: 'org-1', externalId: '120250920581520561' } },
          update: {},
          create: expect.objectContaining({
            orgId: 'org-1',
            name: '120250920581520561',
            source: LeadSource.FACEBOOK,
            externalId: '120250920581520561',
          }),
        }),
      );
      expect(mockPrisma.adSet.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({ campaignId: 'camp-1', adSetId: undefined, adId: undefined });
    });

    it('upserts the full campaign -> adSet -> ad chain, keyed by externalId at each level', async () => {
      mockPrisma.campaign.upsert.mockResolvedValue({ id: 'camp-1' });
      mockPrisma.adSet.upsert.mockResolvedValue({ id: 'adset-1' });
      mockPrisma.ad.upsert.mockResolvedValue({ id: 'ad-1' });

      const result = await service.resolveHierarchy('org-1', LeadSource.GOOGLE_ADS, {
        campaign: 'Camp',
        adSet: 'Set',
        ad: 'Creative',
      });

      expect(mockPrisma.adSet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaignId_externalId: { campaignId: 'camp-1', externalId: 'Set' } },
          update: {},
          create: expect.objectContaining({ campaignId: 'camp-1', name: 'Set', orgId: 'org-1', externalId: 'Set' }),
        }),
      );
      expect(mockPrisma.ad.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { adSetId_externalId: { adSetId: 'adset-1', externalId: 'Creative' } },
          update: {},
          create: expect.objectContaining({
            adSetId: 'adset-1',
            name: 'Creative',
            orgId: 'org-1',
            externalId: 'Creative',
          }),
        }),
      );
      expect(result).toEqual({ campaignId: 'camp-1', adSetId: 'adset-1', adId: 'ad-1' });
    });

    it('finds the same campaign row on a repeat lead even after its name was corrected', async () => {
      // Simulates: lead 1 creates the row with name = raw ID, Insights sync later renames it,
      // lead 2 arrives with the same raw ID — the upsert must match by externalId, not name,
      // or it would create a second ID-named duplicate row.
      mockPrisma.campaign.upsert.mockResolvedValue({ id: 'camp-1', name: 'Summer Sale (renamed by Insights)' });
      await service.resolveHierarchy('org-1', LeadSource.FACEBOOK, { campaign: '120250920581520561' });

      const call = mockPrisma.campaign.upsert.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({ orgId_externalId: { orgId: 'org-1', externalId: '120250920581520561' } });
    });
  });

  describe('listCampaigns', () => {
    it('scopes by orgId', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      await service.listCampaigns(directorUser);
      expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });
});
