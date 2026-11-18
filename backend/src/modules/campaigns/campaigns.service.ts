import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadSource } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

// Names as captured on the Lead (free-text sourceCampaign/sourceAdSet/sourceAd) — upserted
// into real Campaign/AdSet/Ad rows, keyed by (orgId, externalId) so lead-source and
// campaign-performance reporting can join on a stable FK instead of a string match.
//
// The Facebook leadgen webhook only ever supplies numeric IDs (campaign_id/adgroup_id/ad_id),
// not display names, so the value passed in here is that numeric ID string — it's used as
// the initial `name` on create (a readable name beats no name at all) AND as `externalId`,
// the field this upsert actually keys on. FacebookInsightsService later corrects `name` to
// the real Facebook display name once its own sync runs, matching by that same externalId.
//
// Keying the upsert on externalId (not name) is what makes that correction durable: once a
// row's name has been fixed, this method must still find that SAME row on the next lead for
// the same campaign — matching by name would instead create a second, ID-named duplicate.
export interface CampaignHierarchyNames {
  campaign?: string;
  adSet?: string;
  ad?: string;
}

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveHierarchy(
    orgId: string | null | undefined,
    source: LeadSource,
    names: CampaignHierarchyNames,
  ): Promise<{ campaignId?: string; adSetId?: string; adId?: string }> {
    if (!orgId || !names.campaign?.trim()) return {};

    const campaignExternalId = names.campaign.trim();
    const campaign = await this.prisma.campaign.upsert({
      where: { orgId_externalId: { orgId, externalId: campaignExternalId } },
      update: {},
      create: { orgId, name: campaignExternalId, source, externalId: campaignExternalId },
    });

    let adSetId: string | undefined;
    if (names.adSet?.trim()) {
      const adSetExternalId = names.adSet.trim();
      const adSet = await this.prisma.adSet.upsert({
        where: { campaignId_externalId: { campaignId: campaign.id, externalId: adSetExternalId } },
        update: {},
        create: { campaignId: campaign.id, name: adSetExternalId, orgId, externalId: adSetExternalId },
      });
      adSetId = adSet.id;
    }

    let adId: string | undefined;
    if (names.ad?.trim() && adSetId) {
      const adExternalId = names.ad.trim();
      const ad = await this.prisma.ad.upsert({
        where: { adSetId_externalId: { adSetId, externalId: adExternalId } },
        update: {},
        create: { adSetId, name: adExternalId, orgId, externalId: adExternalId },
      });
      adId = ad.id;
    }

    return { campaignId: campaign.id, adSetId, adId };
  }

  async listCampaigns(caller: AuthUser) {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return this.prisma.campaign.findMany({
      where: orgFilter,
      include: { adSets: { include: { ads: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
