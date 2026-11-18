import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptToken } from '../../common/crypto.utils';
import { FB_GRAPH_VERSION } from '../../common/constants/facebook.constants';
import { isFacebookRateLimitError } from '../../common/utils/fb-rate-limit.util';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';

type InsightsLevel = 'campaign' | 'adset' | 'ad';

interface InsightsRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
}

interface InsightsResponse {
  data: InsightsRow[];
  paging?: { next?: string };
}

const LEVEL_ID_FIELD: Record<InsightsLevel, keyof InsightsRow> = {
  campaign: 'campaign_id',
  adset: 'adset_id',
  ad: 'ad_id',
};
// The Insights endpoint returns the real Facebook display name alongside each row's numeric
// ID — this is what corrects the placeholder "name = numeric ID" that CampaignsService.
// resolveHierarchy writes at lead-ingestion time (it never has a display name available).
const LEVEL_NAME_FIELD: Record<InsightsLevel, keyof InsightsRow> = {
  campaign: 'campaign_name',
  adset: 'adset_name',
  ad: 'ad_name',
};
// Plain list endpoints (not /insights) — return every entity in the ad account, independent
// of any date range, so they're used for name resolution rather than spend metrics.
const LEVEL_LIST_ENDPOINT: Record<InsightsLevel, string> = {
  campaign: 'campaigns',
  adset: 'adsets',
  ad: 'ads',
};

interface NamesRow {
  id: string;
  name?: string;
}

interface NamesResponse {
  data: NamesRow[];
  paging?: { next?: string };
}

// FB error code for an invalid/expired access token.
const INVALID_TOKEN_CODE = 190;

@Injectable()
export class FacebookInsightsService {
  private readonly logger = new Logger(FacebookInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('facebook-insights') private readonly queue: Queue,
  ) {}

  /** Enqueue a sync job for one org (on-demand refresh, ad-account connect, and the daily cron fan-out). */
  async enqueueSync(orgId: string): Promise<void> {
    await this.queue.add(
      'sync-org',
      { orgId },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  /** Enqueue one sync job per org with a connected + active ad account (daily cron target). */
  async enqueueSyncAllOrgs(): Promise<void> {
    const integrations = await this.prisma.orgIntegration.findMany({
      where: { provider: IntegrationProvider.FACEBOOK, status: IntegrationStatus.CONNECTED, adAccountId: { not: null } },
      select: { orgId: true },
    });
    await Promise.all(integrations.map((i) => this.enqueueSync(i.orgId)));
  }

  /** Pull Insights for one org's connected ad account and write spend/impressions/clicks onto Campaign/AdSet/Ad. */
  async syncOrg(orgId: string): Promise<void> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
    });
    if (!integration?.adAccountId || !integration.adAccountAccessToken) return;

    let accessToken: string;
    try {
      accessToken = decryptToken(integration.adAccountAccessToken);
    } catch {
      this.logger.error(`Failed to decrypt ad account token for orgId=${orgId}`);
      return;
    }

    // A rolling 30-day window, not just "yesterday + today": impressions/clicks are stored as
    // flat fields on Campaign/AdSet/Ad and read as-is by reports.service.ts#adPerformance (not
    // re-aggregated per report date range), so a 1-2 day window left them at 0 for any ad without
    // literal delivery in the last 24-48h at sync time — even ads with real spend/leads/CTR over
    // the past month. One Insights call already returns an aggregated total for the whole range
    // requested, so widening this costs no extra API calls.
    const timeRange = this.buildTimeRange(30);

    try {
      // Sequential, not Promise.all: firing all 6 calls at once against the same
      // ad account is what was tripping Meta's ad-account-level rate limit
      // (error 80004) and inflating the Marketing API error rate that the
      // App Review qualification gate checks.
      await this.syncLevel(orgId, integration.adAccountId, accessToken, 'campaign', timeRange);
      await this.syncLevel(orgId, integration.adAccountId, accessToken, 'adset', timeRange);
      await this.syncLevel(orgId, integration.adAccountId, accessToken, 'ad', timeRange);
      // Insights only returns rows for entities with delivery in `timeRange`, so a paused
      // or older campaign never gets its placeholder ID-as-name corrected that way. The
      // plain list endpoints return every campaign/ad set/ad in the account regardless of
      // recent spend, so name resolution runs as a separate, date-independent pass.
      await this.syncNames(orgId, integration.adAccountId, accessToken, 'campaign');
      await this.syncNames(orgId, integration.adAccountId, accessToken, 'adset');
      await this.syncNames(orgId, integration.adAccountId, accessToken, 'ad');

      await this.prisma.orgIntegration.update({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
        data: { lastSyncedAt: new Date(), status: IntegrationStatus.CONNECTED },
      });
    } catch (err) {
      if (this.isInvalidTokenError(err)) {
        this.logger.error(`Facebook ad account token invalid/expired for orgId=${orgId} — marking integration ERROR`);
        await this.prisma.orgIntegration.update({
          where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
          // Keep the earliest outage timestamp across repeated failures so a later
          // reconnect backfills the full gap, not just since the most recent retry.
          data: { status: IntegrationStatus.ERROR, disconnectedAt: integration.disconnectedAt ?? new Date() },
        });
        return;
      }
      throw err;
    }
  }

  private async syncLevel(
    orgId: string,
    adAccountId: string,
    accessToken: string,
    level: InsightsLevel,
    timeRange: { since: string; until: string },
  ): Promise<void> {
    const idField = LEVEL_ID_FIELD[level];
    const nameField = LEVEL_NAME_FIELD[level];
    let url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${adAccountId}/insights`;
    let params: Record<string, string> | undefined = {
      level,
      fields: `${idField},${nameField},spend,impressions,clicks`,
      time_range: JSON.stringify(timeRange),
      access_token: accessToken,
    };

    while (url) {
      const { data } = await this.getWithRateLimitRetry<InsightsResponse>(url, params);
      params = undefined; // paging.next already carries all query params

      for (const row of data.data ?? []) {
        await this.applyRow(orgId, level, row);
      }

      url = data.paging?.next ?? '';
    }
  }

  private async applyRow(orgId: string, level: InsightsLevel, row: InsightsRow): Promise<void> {
    const spend = row.spend ? parseFloat(row.spend) : 0;
    const impressions = row.impressions ? parseInt(row.impressions, 10) : 0;
    const clicks = row.clicks ? parseInt(row.clicks, 10) : 0;

    if (level === 'campaign' && row.campaign_id) {
      await this.prisma.campaign.updateMany({
        where: { orgId, externalId: row.campaign_id },
        data: { spend, impressions, clicks, ...(row.campaign_name ? { name: row.campaign_name } : {}) },
      });
    } else if (level === 'adset' && row.adset_id) {
      await this.prisma.adSet.updateMany({
        where: { orgId, externalId: row.adset_id },
        data: { spend, impressions, clicks, ...(row.adset_name ? { name: row.adset_name } : {}) },
      });
    } else if (level === 'ad' && row.ad_id) {
      await this.prisma.ad.updateMany({
        where: { orgId, externalId: row.ad_id },
        data: { spend, impressions, clicks, ...(row.ad_name ? { name: row.ad_name } : {}) },
      });
    }
  }

  private async syncNames(orgId: string, adAccountId: string, accessToken: string, level: InsightsLevel): Promise<void> {
    let url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${adAccountId}/${LEVEL_LIST_ENDPOINT[level]}`;
    let params: Record<string, string> | undefined = { fields: 'id,name', access_token: accessToken };

    while (url) {
      const { data } = await this.getWithRateLimitRetry<NamesResponse>(url, params);
      params = undefined; // paging.next already carries all query params

      for (const row of data.data ?? []) {
        await this.applyName(orgId, level, row);
      }

      url = data.paging?.next ?? '';
    }
  }

  private async applyName(orgId: string, level: InsightsLevel, row: NamesRow): Promise<void> {
    if (!row.name) return;

    if (level === 'campaign') {
      await this.prisma.campaign.updateMany({ where: { orgId, externalId: row.id }, data: { name: row.name } });
    } else if (level === 'adset') {
      await this.prisma.adSet.updateMany({ where: { orgId, externalId: row.id }, data: { name: row.name } });
    } else {
      await this.prisma.ad.updateMany({ where: { orgId, externalId: row.id }, data: { name: row.name } });
    }
  }

  private async getWithRateLimitRetry<T>(url: string, params?: Record<string, string>): Promise<{ data: T }> {
    try {
      return await axios.get<T>(url, params ? { params } : undefined);
    } catch (err) {
      if (isFacebookRateLimitError(err)) {
        this.logger.warn(`Facebook Insights rate-limited, retrying once after 5s: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return axios.get<T>(url, params ? { params } : undefined);
      }
      throw err;
    }
  }

  private buildTimeRange(days: number): { since: string; until: string } {
    const until = new Date();
    const since = new Date();
    since.setDate(since.getDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { since: fmt(since), until: fmt(until) };
  }

  private isInvalidTokenError(err: unknown): boolean {
    if (!axios.isAxiosError(err)) return false;
    const code = (err.response?.data as { error?: { code?: number } })?.error?.code;
    return code === INVALID_TOKEN_CODE;
  }
}
