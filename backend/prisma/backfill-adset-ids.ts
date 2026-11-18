// Backfills AdSet rows whose `externalId` was wrongly set equal to a sibling Ad's
// `externalId` — the FacebookService.fetchAndStoreLead bug where Meta's webhook
// `adgroup_id` field was present but wrong (equal to `ad_id`) for some campaigns, and
// wasn't re-resolved via the Graph API because that fallback only ran when `campaign_id`
// was ALSO missing (fixed in FacebookService — see git history for this file's sibling).
//
// A corrupted AdSet never gets its placeholder name fixed by FacebookInsightsService no
// matter how many times it's re-synced, because its externalId doesn't correspond to any
// real Facebook ad set — /adsets never returns a matching row.
//
// For each corrupted AdSet: fetches the ad's real adset_id from the Graph API (using the
// SAME org's own connected ad-account token — this bug only manifests for orgs that
// already have one), then re-points every Ad and Lead referencing the bad AdSet row onto
// a correct one (creating it if needed) and deletes the now-empty bad row.
//
// Defaults to a dry run (prints what it would do, writes nothing). Pass DRY_RUN=false to
// apply. Idempotent — a corrected AdSet no longer matches the corruption signature, so
// re-running after a partial failure just picks up where it left off.
//
// Run with:
//   BACKFILL_ORG_ID=<org> npm run backfill:adsets
//   BACKFILL_ORG_ID=<org> DRY_RUN=false npm run backfill:adsets

import { PrismaClient, IntegrationProvider } from '@prisma/client';
import axios from 'axios';
import { decryptToken } from '../src/common/crypto.utils';
import { FB_GRAPH_VERSION } from '../src/common/constants/facebook.constants';

const prisma = new PrismaClient();

const TARGET_ORG_ID = process.env.BACKFILL_ORG_ID;
const DRY_RUN = process.env.DRY_RUN !== 'false';

interface GraphAdResponse {
  adset_id?: string;
}

async function main() {
  if (!TARGET_ORG_ID) {
    throw new Error('Set BACKFILL_ORG_ID (org whose AdSet rows to check/fix).');
  }

  const integration = await prisma.orgIntegration.findUnique({
    where: { orgId_provider: { orgId: TARGET_ORG_ID, provider: IntegrationProvider.FACEBOOK } },
  });
  if (!integration?.adAccountAccessToken) {
    throw new Error(`Org ${TARGET_ORG_ID} has no connected ad-account token — cannot resolve adset_id.`);
  }
  const adAccountAccessToken = decryptToken(integration.adAccountAccessToken);

  const adSets = await prisma.adSet.findMany({
    where: { orgId: TARGET_ORG_ID },
    include: { ads: true },
  });

  const corrupted = adSets.filter((as) => as.externalId && as.ads.some((ad) => ad.externalId === as.externalId));

  console.log(`Found ${corrupted.length} corrupted AdSet row(s) (externalId collides with a sibling Ad's externalId).`);
  console.log(DRY_RUN ? 'DRY RUN — no writes will be made.\n' : 'LIVE RUN — writes will be applied.\n');

  let fixed = 0;
  let failed = 0;

  for (const badAdSet of corrupted) {
    // The ad whose externalId caused the corruption is the one to query — its real
    // adset_id is what the bad AdSet row's externalId should have been.
    const culpritAd = badAdSet.ads.find((ad) => ad.externalId === badAdSet.externalId)!;

    let realAdSetId: string | undefined;
    try {
      const { data } = await axios.get<GraphAdResponse>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/${culpritAd.externalId}`,
        { params: { fields: 'adset_id', access_token: adAccountAccessToken } },
      );
      realAdSetId = data.adset_id;
    } catch (err) {
      console.warn(`  ! Could not resolve adset_id for ad_id=${culpritAd.externalId}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }

    if (!realAdSetId) {
      console.warn(`  ! Graph API returned no adset_id for ad_id=${culpritAd.externalId} — skipping`);
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `  would fix AdSet ${badAdSet.id} (bad externalId=${badAdSet.externalId}) -> real adset_id=${realAdSetId}, moving ${badAdSet.ads.length} ad(s)`,
      );
      fixed++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const correctAdSet = await tx.adSet.upsert({
        where: { campaignId_externalId: { campaignId: badAdSet.campaignId, externalId: realAdSetId! } },
        update: {},
        create: { campaignId: badAdSet.campaignId, name: realAdSetId!, orgId: TARGET_ORG_ID, externalId: realAdSetId! },
      });

      await tx.ad.updateMany({ where: { adSetId: badAdSet.id }, data: { adSetId: correctAdSet.id } });
      await tx.lead.updateMany({ where: { adSetId: badAdSet.id }, data: { adSetId: correctAdSet.id } });
      await tx.adSet.delete({ where: { id: badAdSet.id } });
    });

    console.log(`  + fixed AdSet ${badAdSet.id} -> ${realAdSetId} (moved ${badAdSet.ads.length} ad(s))`);
    fixed++;
  }

  console.log(`\nDone. fixed=${fixed} failed=${failed} total=${corrupted.length}`);
  if (!DRY_RUN && fixed > 0) {
    console.log('Re-run the Facebook Insights sync (POST /facebook-insights/sync) to pick up the real ad set name.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
