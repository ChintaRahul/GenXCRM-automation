import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from '../../modules/assignments/assignments.service';
import { NurturingService } from '../../modules/nurturing/nurturing.service';
import { CampaignsService } from '../../modules/campaigns/campaigns.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { LeadSource, IntegrationProvider, IntegrationStatus, Prisma } from '@prisma/client';
import { encryptToken, decryptToken } from '../../common/crypto.utils';
import { resolveOrgFields } from '../../common/utils/field-mapping.util';
import axios from 'axios';

export interface GoogleLeadColumn {
  // `column_id` is Google's stable field identifier (e.g. FULL_NAME, PHONE_NUMBER);
  // `column_name` is the human label shown in the form and may be customised, so we
  // match on column_id first and only fall back to column_name.
  column_id?: string;
  column_name?: string;
  string_value: string;
}

export interface GoogleLeadPayload {
  lead_id?: string;
  campaign_id?: string;
  adgroup_id?: string;
  creative_id?: string;
  // Shared secret echoed back from the form's "Webhook key" field — verified per org.
  google_key?: string;
  // Google posts a test lead when you click "Send test data" while configuring the form.
  is_test?: boolean;
  user_column_data?: GoogleLeadColumn[];
}

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentsService,
    private readonly nurturing: NurturingService,
    private readonly campaigns: CampaignsService,
    private readonly organizations: OrganizationsService,
  ) {}

  async processLead(payload: GoogleLeadPayload, orgId: string) {
    const { campaign_id, adgroup_id, creative_id, user_column_data = [], google_key, is_test } = payload;

    // Verify the form's "Webhook key" before doing anything with the payload. The key is
    // stored per org on the GOOGLE_ADS integration; if one is set it MUST match.
    if (!(await this.verifyGoogleKey(orgId, google_key))) {
      this.logger.warn(`Google lead rejected — invalid webhook key for orgId=${orgId}`);
      return { ignored: true, reason: 'invalid_key' };
    }

    // Index by stable column_id, falling back to the human label. Google only guarantees
    // column_id for the built-in fields, so prefer it.
    const fields: Record<string, string> = {};
    for (const col of user_column_data) {
      const key = col.column_id ?? col.column_name;
      if (key) fields[key] = col.string_value;
    }

    const phone = (fields['PHONE_NUMBER'] ?? fields['phone_number'] ?? '').replace(/\D/g, '');
    if (!phone) {
      this.logger.warn(`Google lead missing phone — orgId=${orgId}`);
      return { ignored: true, reason: 'no_phone' };
    }

    // Google sends a test lead during form setup — acknowledge it (200) but never store it.
    if (is_test) {
      this.logger.log(`Google test lead received and acknowledged — orgId=${orgId}`);
      return { test: true };
    }

    const existing = await this.prisma.lead.findFirst({
      where: { phone: { endsWith: phone.slice(-10) }, isDeleted: false, orgId },
    });
    if (existing) return { duplicate: true, leadId: existing.id };

    const name =
      fields['FULL_NAME'] ||
      [fields['FIRST_NAME'], fields['LAST_NAME']].filter(Boolean).join(' ') ||
      'Unknown';

    // Org-configured Field Mappings (Administration > Field Mappings) let each org map its
    // own Google Lead Form questions to core Lead columns (course/location/language/altPhone/
    // tags) and to custom fields — `source` is excluded because this channel already knows
    // its source deterministically (GOOGLE_ADS) and free text can't safely become that enum.
    const fieldMapping = await this.organizations.getFieldMappingsForOrg(orgId);
    const { core, customFields, unmatchedKeys } = resolveOrgFields(fields, fieldMapping);

    // Fire-and-forget — feeds the Administration > Field Mappings suggestion list, never
    // blocks ingestion.
    if (unmatchedKeys.length) void this.organizations.recordDetectedFields(orgId, unmatchedKeys);

    const { campaignId, adSetId, adId } = await this.campaigns.resolveHierarchy(orgId, LeadSource.GOOGLE_ADS, {
      campaign: campaign_id,
      adSet: adgroup_id,
      ad: creative_id,
    });

    const lead = await this.prisma.lead.create({
      data: {
        name: core.name || name,
        email: fields['EMAIL'] || fields['WORK_EMAIL'] || core.email || undefined,
        phone,
        altPhone: core.altPhone,
        course: core.course,
        location: fields['CITY'] || fields['POSTAL_CODE'] || core.location || undefined,
        language: core.language,
        tags: core.tags ? core.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        source: LeadSource.GOOGLE_ADS,
        rawFields: fields,
        sourceCampaign: campaign_id,
        sourceAdSet: adgroup_id,
        sourceAd: creative_id,
        campaignId,
        adSetId,
        adId,
        orgId,
        ...(Object.keys(customFields).length > 0 && { customFields: customFields as Prisma.InputJsonValue }),
      },
    });

    // Inbound leads carry no team — queueAutomaticAssignment applies the org's Routing
    // settings (autoAssign toggle, per-source team routing, working hours) the same way
    // manually-created/imported leads get them; the chosen rep's team is then applied to
    // the lead during assignment (see AssignmentsService).
    await this.assignments.queueAutomaticAssignment(lead.id, orgId, null, LeadSource.GOOGLE_ADS);

    // Auto-enroll into the org's active lead_created sequences (welcome email, etc.).
    // Fire-and-forget — nurturing must never block ingestion.
    void this.nurturing.autoEnroll(lead.id, orgId, 'lead_created');

    return lead;
  }

  /**
   * Verify the `google_key` echoed back in the webhook payload against the key stored on
   * the org's GOOGLE_ADS integration. Returns true when no key is configured (nothing to
   * verify against yet) so setup isn't blocked before a key exists.
   */
  private async verifyGoogleKey(orgId: string, providedKey: string | undefined): Promise<boolean> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_ADS } },
      select: { webhookSecret: true },
    });
    const expected = integration?.webhookSecret;
    if (!expected) return true;
    return providedKey === expected;
  }

  async getValidAccessToken(orgId: string): Promise<string | null> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_ADS } },
    });
    if (!integration || integration.status !== IntegrationStatus.CONNECTED) return null;
    if (!integration.accessToken) return null;

    // Refresh if token expires within 5 minutes
    if (integration.tokenExpiry && integration.tokenExpiry.getTime() < Date.now() + 5 * 60 * 1000) {
      if (!integration.refreshToken) {
        await this.prisma.orgIntegration.update({
          where: { id: integration.id },
          data: { status: IntegrationStatus.ERROR },
        });
        return null;
      }
      return this.refreshToken(integration.id, decryptToken(integration.refreshToken));
    }

    return decryptToken(integration.accessToken);
  }

  private async refreshToken(integrationId: string, refreshToken: string): Promise<string | null> {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
      const { data } = await axios.post<{ access_token: string; expires_in: number }>(
        'https://oauth2.googleapis.com/token',
        { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret },
      );
      const tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
      await this.prisma.orgIntegration.update({
        where: { id: integrationId },
        data: { accessToken: encryptToken(data.access_token), tokenExpiry },
      });
      return data.access_token;
    } catch (err) {
      this.logger.error('Google token refresh failed', err instanceof Error ? err.message : String(err));
      await this.prisma.orgIntegration.update({
        where: { id: integrationId },
        data: { status: IntegrationStatus.ERROR },
      });
      return null;
    }
  }
}
