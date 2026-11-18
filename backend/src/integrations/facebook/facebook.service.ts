import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadSource, IntegrationProvider, IntegrationStatus, Prisma } from '@prisma/client';
import { AssignmentsService } from '../../modules/assignments/assignments.service';
import { NurturingService } from '../../modules/nurturing/nurturing.service';
import { CampaignsService } from '../../modules/campaigns/campaigns.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { decryptToken } from '../../common/crypto.utils';
import { resolveOrgFields } from '../../common/utils/field-mapping.util';
import { isFacebookRateLimitError } from '../../common/utils/fb-rate-limit.util';
import * as crypto from 'crypto';
import axios from 'axios';
import { FB_GRAPH_VERSION } from '../../common/constants/facebook.constants';
import { RESUBMITTED_ACTIVITY_TYPE } from '../../common/constants/lead.constants';
import { WhatsappWebhookService, type WhatsAppWebhookPayload } from '../whatsapp/whatsapp-webhook.service';
import { IngestionAlertsService } from '../../modules/ingestion-alerts/ingestion-alerts.service';

type MetaPlatform ='facebook' | 'instagram' | 'messenger' | 'audience_network';

interface MetaLeadgenValue {
  leadgen_id: string;
  form_id: string;
  page_id: string;
  ad_id?: string;
  adgroup_id?: string;
  campaign_id?: string;
  created_time?: number;
}

interface MetaWebhookChange {
  field: string;
  value: MetaLeadgenValue;
}

interface MetaWebhookEntry {
  id?: string;
  changes?: MetaWebhookChange[];
}

export interface FacebookWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

interface GraphLeadFieldData {
  name: string;
  values: string[];
}

interface GraphLeadResponse {
  field_data?: GraphLeadFieldData[];
  id?: string;
}

interface GraphAdResponse {
  campaign_id?: string;
  adset_id?: string;
}

// The live webhook path fires one Graph API call per incoming lead with no delay between
// leads, so a burst of deliveries can trip Meta's rate limits (see isFacebookRateLimitError).
// A rate-limited call here is a *permanently* dropped lead unless retried: fetchAndStoreLead
// is fire-and-forget (`void`) and the webhook already returned 200, so Meta never redelivers.
// See the 2026-09-26 Pooinfotech incident (43 of 117 leads lost over ~12.5h).

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentsService,
    private readonly nurturing: NurturingService,
    private readonly campaigns: CampaignsService,
    private readonly wa: WhatsappWebhookService,
    private readonly organizations: OrganizationsService,
    private readonly alerts: IngestionAlertsService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === (process.env.FACEBOOK_VERIFY_TOKEN ?? 'genxcrm-fb-verify')) return challenge;
    return null;
  }

  verifySignature(rawBody: string, signature: string): boolean {
    if (!process.env.FACEBOOK_APP_SECRET) return true;
    const expected = `sha256=${crypto
      .createHmac('sha256', process.env.FACEBOOK_APP_SECRET)
      .update(rawBody)
      .digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  processLeadEvent(payload: FacebookWebhookPayload | WhatsAppWebhookPayload): void {
    // A Meta App has one Callback URL total, shared across every subscribed product —
    // WhatsApp Embedded Signup rides the same app as Lead Ads, so its events land here too,
    // discriminated by object like the existing instagram/page branch below.
    if (payload.object === 'whatsapp_business_account') {
      void this.wa.processEmbeddedSignupEvent(payload as WhatsAppWebhookPayload);
      return;
    }
    const platform: MetaPlatform = payload.object === 'instagram' ? 'instagram' : 'facebook';
    const entries = (payload as FacebookWebhookPayload).entry ?? [];
    for (const entry of entries) {
      // entry.id is the FB Page ID for page-level webhook subscriptions
      const pageId = entry.id;
      void this.processEntry(entry, pageId, platform);
    }
  }

  private async processEntry(
    entry: MetaWebhookEntry,
    pageId: string | undefined,
    platform: MetaPlatform,
  ): Promise<void> {
    // Resolve org(s) by page_id — each org's connected page is stored in OrgIntegration.accountId.
    // The same Facebook Page can be connected by more than one org (e.g. an agency and its
    // client both admin the same Page), so every leadgen event fans out to every org currently
    // connected to it — each gets its own independent, org-scoped lead.
    const orgIntegrations = pageId
      ? await this.prisma.orgIntegration.findMany({
          where: {
            accountId: pageId,
            provider: IntegrationProvider.FACEBOOK,
            status: IntegrationStatus.CONNECTED,
          },
        })
      : [];

    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const { leadgen_id, form_id, ad_id, adgroup_id, campaign_id } = change.value;

      if (!orgIntegrations.length) {
        this.logger.warn(`Received Meta leadgen event but no connected org found for page_id=${pageId}`);
        continue;
      }

      for (const orgIntegration of orgIntegrations) {
        let accessToken: string;
        try {
          accessToken = decryptToken(orgIntegration.accessToken!);
        } catch {
          this.logger.error(`Failed to decrypt access token for orgId=${orgIntegration.orgId}`);
          continue;
        }

        // Ads-scoped token (set once an ad account is connected) used only to backfill
        // campaign_id below — the Page token above has no ads_read scope.
        let adAccountAccessToken: string | undefined;
        if (orgIntegration.adAccountAccessToken) {
          try {
            adAccountAccessToken = decryptToken(orgIntegration.adAccountAccessToken);
          } catch {
            this.logger.warn(`Failed to decrypt ad account token for orgId=${orgIntegration.orgId}`);
          }
        }

        void this.fetchAndStoreLead(
          leadgen_id,
          form_id,
          platform,
          ad_id,
          adgroup_id,
          campaign_id,
          orgIntegration.orgId,
          accessToken,
          adAccountAccessToken,
        );
      }
    }
  }

  private async fetchAndStoreLead(
    leadgenId: string,
    formId: string,
    platform: MetaPlatform,
    adId?: string,
    adSetId?: string,
    campaignId?: string,
    orgId?: string,
    accessToken?: string,
    adAccountAccessToken?: string,
  ): Promise<void> {
    const token = accessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!token) {
      this.logger.warn(`Meta lead received (${platform}) but no access token available — leadgen_id=${leadgenId}`);
      return;
    }

    // Meta's leadgen webhook payload doesn't reliably include campaign_id (unlike ad_id/
    // form_id), and its `adgroup_id` (ad set id) has been observed populated but WRONG —
    // equal to ad_id itself — for at least one real campaign, which silently corrupts
    // AdSet.externalId (it then never matches a real Facebook ad set, so the Insights sync
    // can never resolve its display name no matter how many times it's re-run). The ad's
    // own Graph object is the only field we trust for these two ids, so always re-fetch it
    // (not just when campaign_id is missing) whenever an ads-scoped token is connected —
    // the Page token has no ads_read permission — and prefer the fetched values over
    // whatever the webhook sent.
    let resolvedCampaignId = campaignId;
    let resolvedAdSetId = adSetId;
    if (adId && adAccountAccessToken) {
      try {
        const { data } = await axios.get<GraphAdResponse>(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${adId}`, {
          params: { fields: 'campaign_id,adset_id', access_token: adAccountAccessToken },
        });
        resolvedCampaignId = data.campaign_id ?? resolvedCampaignId;
        resolvedAdSetId = data.adset_id ?? resolvedAdSetId;
      } catch (err) {
        this.logger.warn(
          `Could not resolve campaign_id/adset_id for ad_id=${adId} orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      const { data } = await this.getLeadWithRateLimitRetry(leadgenId, token);

      const fields = data.field_data ?? [];
      const get = (name: string) => fields.find((f) => f.name === name)?.values?.[0] ?? '';
      // Every question on the form, keyed by its raw Meta field name — resolved against the
      // org's Field Mappings config below so custom form questions land on the right column
      // or customFields key, not just the three fields hardcoded here.
      const rawFields: Record<string, string> = {};
      for (const f of fields) {
        if (f.values?.[0]) rawFields[f.name] = f.values[0];
      }

      const name = get('full_name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ') || 'Unknown';
      const phone = get('phone_number') || get('mobile') || get('phone');
      const email = get('email');

      if (!phone) {
        this.logger.warn(`Meta lead ${leadgenId} has no phone field — skipping`);
        void this.alerts.recordFailure({ leadgenId, formId, platform, orgId, reason: 'Submission has no phone_number field — lead was not created.' });
        return;
      }

      await this.ingestLead(
        {
          name,
          email: email || undefined,
          phone,
          formId,
          adId,
          adSetId: resolvedAdSetId,
          campaignId: resolvedCampaignId,
          platform,
          rawFields,
          leadgenId,
        },
        orgId,
      );
      this.logger.log(`Meta lead ingested: platform=${platform} leadgen_id=${leadgenId} orgId=${orgId}`);
    } catch (err) {
      const detail = this.graphErrorDetail(err);
      this.logger.error(`Failed to fetch Meta lead ${leadgenId} from Graph API`, detail);
      // This is the 2026-09-26 Pooinfotech failure mode: the webhook already ACKed Meta (so
      // it never redelivers) and this call is fire-and-forget from the caller — if it fails
      // here, even after the retry above, the lead is gone with nothing but a log line
      // showing it, which nobody is watching in real time. Record it for the batched alert email.
      void this.alerts.recordFailure({ leadgenId, formId, platform, orgId, reason: detail });
    }
  }

  /** Extracts Facebook's actual error message/code from an axios error, for logging/alerting. */
  private graphErrorDetail(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const fbError = (err.response?.data as { error?: { message?: string; code?: number; type?: string } })?.error;
      if (fbError) return `FB error code=${fbError.code} type=${fbError.type}: ${fbError.message}`;
      return err.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  /** One retry after a 5s backoff on Meta rate-limit errors — see isFacebookRateLimitError. */
  private async getLeadWithRateLimitRetry(leadgenId: string, accessToken: string): Promise<{ data: GraphLeadResponse }> {
    const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${leadgenId}`;
    const config = { params: { fields: 'field_data', access_token: accessToken } };
    try {
      return await axios.get<GraphLeadResponse>(url, config);
    } catch (err) {
      if (!isFacebookRateLimitError(err)) throw err;
      this.logger.warn(`Meta lead fetch rate-limited, retrying once after 5s: leadgen_id=${leadgenId}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return axios.get<GraphLeadResponse>(url, config);
    }
  }

  async ingestLead(
    data: {
      name: string;
      email?: string;
      phone: string;
      formId?: string;
      adId?: string;
      adSetId?: string;
      campaignId?: string;
      platform?: MetaPlatform;
      rawFields?: Record<string, string>;
      leadgenId?: string;
    },
    orgId?: string,
  ) {
    const phone = data.phone.replace(/\D/g, '');

    // Org-configured Field Mappings (Administration > Field Mappings) let each org map its
    // own Meta form questions to core Lead columns (course/location/language/altPhone/tags)
    // and to custom fields — used only as a fallback for name/email since those are already
    // reliably detected above, and never for `source`, which this channel already knows
    // deterministically (FACEBOOK/INSTAGRAM by platform).
    const { core, customFields, unmatchedKeys } =
      orgId && data.rawFields
        ? resolveOrgFields(data.rawFields, await this.organizations.getFieldMappingsForOrg(orgId))
        : { core: {}, customFields: {}, unmatchedKeys: [] };

    // Fire-and-forget — feeds the Administration > Field Mappings suggestion list, never
    // blocks ingestion.
    if (orgId && unmatchedKeys.length) void this.organizations.recordDetectedFields(orgId, unmatchedKeys);

    // Only dedup when we have a real number to match on. A blank/short phone makes
    // `endsWith` collapse to `endsWith('')`, which matches the FIRST lead in the org —
    // silently dropping a genuine lead as a false "duplicate". Skip dedup instead so the
    // lead is still created. `slice(-10)` yields 10 chars only for a full-length number.
    const phoneTail = phone.slice(-10);
    const email = (data.email || core.email)?.toLowerCase().trim();
    const orMatches = [
      ...(phoneTail.length >= 10 ? [{ phone: { endsWith: phoneTail } }] : []),
      ...(email ? [{ email }] : []),
    ];

    const source = data.platform === 'instagram' ? LeadSource.INSTAGRAM : LeadSource.FACEBOOK;

    const { campaignId, adSetId, adId } = await this.campaigns.resolveHierarchy(orgId, source, {
      campaign: data.campaignId,
      adSet: data.adSetId,
      ad: data.adId,
    });

    // Meta redelivers leadgen webhook events at-least-once, so the same submission can
    // arrive as two near-simultaneous calls to ingestLead. A plain findFirst-then-create
    // lets both calls pass the dedup check before either INSERT commits, producing two
    // lead rows with the same phone. A transaction-scoped Postgres advisory lock, keyed
    // on org+phone/email, serializes those calls so the second one sees the first's
    // committed row before it re-checks.
    const { lead, wasCreated } = await this.prisma.$transaction(async (tx) => {
      if (orMatches.length) {
        const lockKey = `${orgId ?? 'global'}:${phoneTail || email}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

        const existing = await tx.lead.findFirst({
          where: {
            isDeleted: false,
            ...(orgId && { orgId }),
            OR: orMatches,
          },
        });
        if (existing) {
          // Meta delivers each leadgen event at least once, so the same submission can arrive
          // again. Same leadgen id = the same submission redelivered, not the person submitting
          // again — leave the lead untouched and log nothing.
          if (data.leadgenId && existing.leadgenId === data.leadgenId) {
            return { lead: existing, wasCreated: false };
          }
          // A resubmission of the same person — touch activityAt (not the auto-bumped
          // updatedAt) so the existing lead resurfaces at the top of the list and in
          // notifications instead of silently vanishing.
          const bumped = await tx.lead.update({
            where: { id: existing.id },
            data: { activityAt: new Date() },
          });
          await tx.activity.create({
            data: {
              leadId: existing.id,
              type: RESUBMITTED_ACTIVITY_TYPE,
              note: `Submitted again via ${source === LeadSource.INSTAGRAM ? 'Instagram' : 'Facebook'} lead form`,
              metadata: { source, leadgenId: data.leadgenId ?? null },
            },
          });
          return { lead: bumped, wasCreated: false };
        }
      }

      const created = await tx.lead.create({
        data: {
          name: core.name || data.name,
          email,
          phone,
          altPhone: core.altPhone,
          course: core.course,
          location: core.location,
          language: core.language,
          tags: core.tags ? core.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
          source,
          leadgenId: data.leadgenId,
          ...(data.rawFields && Object.keys(data.rawFields).length > 0 && { rawFields: data.rawFields }),
          sourceAd: data.adId,
          sourceAdSet: data.adSetId,
          sourceCampaign: data.campaignId,
          campaignId,
          adSetId,
          adId,
          ...(orgId && { orgId }),
          ...(Object.keys(customFields).length > 0 && { customFields: customFields as Prisma.InputJsonValue }),
        },
      });
      return { lead: created, wasCreated: true };
    });

    if (!wasCreated) {
      this.logger.log(
        `Duplicate Meta lead for phone ${phone} (platform=${data.platform ?? 'facebook'}) orgId=${orgId}`,
      );
      return lead;
    }

    // Inbound leads carry no team — queueAutomaticAssignment applies the org's Routing
    // settings (autoAssign toggle, per-source team routing, working hours) the same way
    // manually-created/imported leads get them; the chosen rep's team is then applied to
    // the lead during assignment (see AssignmentsService).
    if (orgId) {
      await this.assignments.queueAutomaticAssignment(lead.id, orgId, null, source);
      // Auto-enroll into the org's active lead_created sequences (welcome email, etc.).
      // Fire-and-forget — nurturing must never block ingestion.
      void this.nurturing.autoEnroll(lead.id, orgId, 'lead_created');
    }

    return lead;
  }
}
