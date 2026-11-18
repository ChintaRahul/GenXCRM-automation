// Backfills campaign_id/adset_id (and the resulting Campaign/AdSet rows) for leads
// ingested via the Facebook leadgen webhook BEFORE the campaign_id lookup fix landed
// (see FacebookService.fetchAndStoreLead). Those leads captured sourceAd (Meta's ad_id)
// but never got a campaignId, so they never showed up in campaign performance reports.
//
// Resolves campaign_id/adset_id per distinct ad_id via the Facebook Graph API, using an
// ads-scoped token from a DIFFERENT org's connected ad account (BACKFILL_TOKEN_ORG_ID) —
// the target org (BACKFILL_ORG_ID) may not have an ad account connected itself (that's
// often exactly why its leads were never resolved live). This only works when the token
// org's ad account actually administers the same ads that ran on the target org's leads.
//
// Defaults to a dry run (prints what it would do, writes nothing). Pass DRY_RUN=false to
// apply. Idempotent — only touches leads where campaignId is still null, and re-running
// after a partial failure just picks up where it left off.
//
// Run with:
//   BACKFILL_ORG_ID=<org> BACKFILL_TOKEN_ORG_ID=<org> npm run backfill:campaigns
//   BACKFILL_ORG_ID=<org> BACKFILL_TOKEN_ORG_ID=<org> DRY_RUN=false npm run backfill:campaigns

import { PrismaClient, IntegrationProvider, LeadSource } from '@prisma/client';
import axios from 'axios';
import { decryptToken } from '../src/common/crypto.utils';
import { FB_GRAPH_VERSION } from '../src/common/constants/facebook.constants';

const prisma = new PrismaClient();

const TARGET_ORG_ID = process.env.BACKFILL_ORG_ID;
const TOKEN_ORG_ID = process.env.BACKFILL_TOKEN_ORG_ID;
const DRY_RUN = process.env.DRY_RUN !== 'false';

interface GraphAdResponse {
  campaign_id?: string;
  adset_id?: string;
}

// Mirrors CampaignsService.resolveHierarchy — keyed by externalId (not name), see that
// file's header comment for why.
async function resolveHierarchy(
  orgId: string,
  source: LeadSource,
  names: { campaign?: string; adSet?: string; ad?: string },
): Promise<{ campaignId?: string; adSetId?: string; adId?: string }> {
  if (!names.campaign?.trim()) return {};

  const campaignExternalId = names.campaign.trim();
  const campaign = await prisma.campaign.upsert({
    where: { orgId_externalId: { orgId, externalId: campaignExternalId } },
    update: {},
    create: { orgId, name: campaignExternalId, source, externalId: campaignExternalId },
  });

  let adSetId: string | undefined;
  if (names.adSet?.trim()) {
    const adSetExternalId = names.adSet.trim();
    const adSet = await prisma.adSet.upsert({
      where: { campaignId_externalId: { campaignId: campaign.id, externalId: adSetExternalId } },
      update: {},
      create: { campaignId: campaign.id, name: adSetExternalId, orgId, externalId: adSetExternalId },
    });
    adSetId = adSet.id;
  }

  let adId: string | undefined;
  if (names.ad?.trim() && adSetId) {
    const adExternalId = names.ad.trim();
    const ad = await prisma.ad.upsert({
      where: { adSetId_externalId: { adSetId, externalId: adExternalId } },
      update: {},
      create: { adSetId, name: adExternalId, orgId, externalId: adExternalId },
    });
    adId = ad.id;
  }

  return { campaignId: campaign.id, adSetId, adId };
}

async function main() {
  if (!TARGET_ORG_ID || !TOKEN_ORG_ID) {
    throw new Error('Set BACKFILL_ORG_ID (leads to fix) and BACKFILL_TOKEN_ORG_ID (org whose ad-account token to use).');
  }

  const integration = await prisma.orgIntegration.findUnique({
    where: { orgId_provider: { orgId: TOKEN_ORG_ID, provider: IntegrationProvider.FACEBOOK } },
  });
  if (!integration?.adAccountAccessToken) {
    throw new Error(`Org ${TOKEN_ORG_ID} has no connected ad-account token — cannot resolve campaign_id.`);
  }
  const adAccountAccessToken = decryptToken(integration.adAccountAccessToken);

  const leads = await prisma.lead.findMany({
    where: { orgId: TARGET_ORG_ID, campaignId: null, sourceAd: { not: null }, isDeleted: false },
    select: { id: true, sourceAd: true, source: true },
  });

  console.log(`Found ${leads.length} lead(s) in org ${TARGET_ORG_ID} with an ad_id but no campaignId.`);
  console.log(DRY_RUN ? 'DRY RUN — no writes will be made.\n' : 'LIVE RUN — writes will be applied.\n');

  const resolvedByAdId = new Map<string, GraphAdResponse | null>();
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const lead of leads) {
    const adId = lead.sourceAd!;

    if (!resolvedByAdId.has(adId)) {
      try {
        const { data } = await axios.get<GraphAdResponse>(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${adId}`, {
          params: { fields: 'campaign_id,adset_id', access_token: adAccountAccessToken },
        });
        resolvedByAdId.set(adId, data);
      } catch (err) {
        console.warn(`  ! Could not resolve ad_id=${adId}: ${err instanceof Error ? err.message : String(err)}`);
        resolvedByAdId.set(adId, null);
      }
    }

    const resolved = resolvedByAdId.get(adId);
    if (!resolved?.campaign_id) {
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  would update lead ${lead.id} (ad_id=${adId}) -> campaign_id=${resolved.campaign_id} adset_id=${resolved.adset_id ?? '(none)'}`);
      updated++;
      continue;
    }

    const { campaignId, adSetId } = await resolveHierarchy(TARGET_ORG_ID, lead.source, {
      campaign: resolved.campaign_id,
      adSet: resolved.adset_id,
      ad: adId,
    });
    if (!campaignId) {
      skipped++;
      continue;
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { campaignId, adSetId } });
    updated++;
    console.log(`  + updated lead ${lead.id} -> campaignId=${campaignId}`);
  }

  console.log(`\nDone. updated=${updated} failed=${failed} skipped=${skipped} total=${leads.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
