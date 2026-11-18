import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptToken } from '../../common/crypto.utils';
import { FB_GRAPH_VERSION } from '../../common/constants/facebook.constants';
import { isFacebookRateLimitError } from '../../common/utils/fb-rate-limit.util';
import { IntegrationProvider } from '@prisma/client';
import { FacebookService } from '../../integrations/facebook/facebook.service';

interface GraphIdRow {
  id: string;
}
interface GraphListResponse<T> {
  data: T[];
  paging?: { next?: string };
}
interface GraphLeadFieldData {
  name: string;
  values: string[];
}
interface GraphLeadRow {
  id: string;
  created_time?: string;
  field_data?: GraphLeadFieldData[];
}

export interface BackfillJobData {
  orgId: string;
  pageId: string;
  since: string; // ISO string — Date doesn't survive Redis serialization
}

@Injectable()
export class FacebookLeadBackfillService {
  private readonly logger = new Logger(FacebookLeadBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facebook: FacebookService,
    @InjectQueue('facebook-lead-backfill') private readonly queue: Queue,
  ) {}

  /** Enqueue a backfill for leads Meta generated while this org's Page was disconnected. */
  async enqueueBackfill(orgId: string, pageId: string, since: Date): Promise<void> {
    await this.queue.add(
      'backfill',
      { orgId, pageId, since: since.toISOString() } satisfies BackfillJobData,
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  /**
   * Pull every lead submitted on this Page's forms since `since` via the Leads Retrieval
   * API and ingest each one through the same dedup-safe path as the webhook. Leads already
   * ingested (e.g. a webhook that arrived just before the outage was detected) are silently
   * merged by `ingestLead`'s dedup, so it's safe to re-process the whole window.
   */
  async runBackfill(orgId: string, pageId: string, since: Date): Promise<{ leadsProcessed: number }> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
    });
    if (!integration?.accessToken) {
      throw new Error(`No Facebook access token on file for orgId=${orgId} — cannot backfill`);
    }
    const accessToken = decryptToken(integration.accessToken);

    const formIds = await this.listLeadForms(pageId, accessToken);
    let leadsProcessed = 0;
    for (const formId of formIds) {
      leadsProcessed += await this.backfillForm(formId, accessToken, since, orgId);
    }

    const metadata = (integration.metadata as Record<string, unknown> | null) ?? {};
    await this.prisma.orgIntegration.update({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
      data: {
        disconnectedAt: null,
        metadata: {
          ...metadata,
          lastBackfill: { at: new Date().toISOString(), since: since.toISOString(), leadsProcessed },
        },
      },
    });

    this.logger.log(`Facebook backfill for orgId=${orgId} processed ${leadsProcessed} lead(s) since ${since.toISOString()}`);
    return { leadsProcessed };
  }

  private async listLeadForms(pageId: string, accessToken: string): Promise<string[]> {
    const ids: string[] = [];
    let url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/leadgen_forms`;
    let params: Record<string, string> | undefined = { fields: 'id', access_token: accessToken };

    while (url) {
      try {
        const { data } = await this.getWithRateLimitRetry<GraphListResponse<GraphIdRow>>(url, params);
        params = undefined; // paging.next already carries all query params
        ids.push(...(data.data ?? []).map((f) => f.id));
        url = data.paging?.next ?? '';
      } catch (err) {
        throw new Error(`Failed to list leadgen_forms for pageId=${pageId}: ${this.graphErrorDetail(err)}`);
      }
    }
    return ids;
  }

  /** Extracts Facebook's actual error message/code from an axios error, for logging. */
  private graphErrorDetail(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const fbError = (err.response?.data as { error?: { message?: string; code?: number; type?: string } })?.error;
      if (fbError) return `FB error code=${fbError.code} type=${fbError.type}: ${fbError.message}`;
      return err.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  private async getWithRateLimitRetry<T>(url: string, params?: Record<string, string>): Promise<{ data: T }> {
    try {
      return await axios.get<T>(url, params ? { params } : undefined);
    } catch (err) {
      if (isFacebookRateLimitError(err)) {
        this.logger.warn(`Facebook lead backfill rate-limited, retrying once after 5s: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return axios.get<T>(url, params ? { params } : undefined);
      }
      throw err;
    }
  }

  /** Leads are returned newest-first; stop paginating a form once we pass `since`. */
  private async backfillForm(formId: string, accessToken: string, since: Date, orgId: string): Promise<number> {
    let processed = 0;
    let url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${formId}/leads`;
    let params: Record<string, string> | undefined = {
      fields: 'id,created_time,field_data',
      access_token: accessToken,
    };

    while (url) {
      let data: GraphListResponse<GraphLeadRow>;
      try {
        ({ data } = await this.getWithRateLimitRetry<GraphListResponse<GraphLeadRow>>(url, params));
      } catch (err) {
        throw new Error(`Failed to fetch leads for formId=${formId}: ${this.graphErrorDetail(err)}`);
      }
      params = undefined;

      for (const row of data.data ?? []) {
        const createdTime = row.created_time ? new Date(row.created_time) : null;
        if (createdTime && createdTime < since) {
          return processed; // reached leads from before the outage — this form is done
        }

        const fields = row.field_data ?? [];
        const get = (name: string) => fields.find((f) => f.name === name)?.values?.[0] ?? '';
        const name = get('full_name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ') || 'Unknown';
        const phone = get('phone_number') || get('mobile') || get('phone');
        const email = get('email');

        if (!phone) continue;

        await this.facebook.ingestLead({ name, email: email || undefined, phone, formId, platform: 'facebook' }, orgId);
        processed += 1;
      }

      url = data.paging?.next ?? '';
    }
    return processed;
  }
}
