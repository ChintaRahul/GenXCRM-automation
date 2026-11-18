import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from '../../modules/assignments/assignments.service';
import { NurturingService } from '../../modules/nurturing/nurturing.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { MfgLeadsService, type MfgLeadWebhookPayload } from '../../modules/mfg-leads/mfg-leads.service';
import { LeadSource, Prisma, IntegrationProvider } from '@prisma/client';
import { resolveOrgFields } from '../../common/utils/field-mapping.util';
import * as crypto from 'crypto';

export interface WebhookLeadPayload {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  course?: string;
  location?: string;
  campaignId?: string;
  customFields?: Record<string, string | number | boolean>;
}

const SOURCE_MAP: Record<string, LeadSource> = {
  instagram: LeadSource.INSTAGRAM,
  website: LeadSource.WEBSITE,
  facebook: LeadSource.FACEBOOK,
  google: LeadSource.GOOGLE_ADS,
  referral: LeadSource.REFERRAL,
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentsService,
    private readonly nurturing: NurturingService,
    private readonly organizations: OrganizationsService,
    private readonly mfgLeads: MfgLeadsService,
  ) {}

  async validateSignature(orgId: string, rawBody: Buffer | string, signature: string | undefined): Promise<boolean> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WEBHOOK } },
    });
    if (!integration?.webhookSecret) return true; // No secret configured → accept all
    // Sign the raw request bytes, not a re-serialized body — key order/whitespace differences
    // would otherwise make a correctly-signed request fail.
    const expected = `sha256=${crypto.createHmac('sha256', integration.webhookSecret).update(rawBody).digest('hex')}`;
    const provided = signature ?? '';
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  // Manufacturing workspaces keep their enquiries as Manufacturing leads, not education leads.
  ingestMfgLead(payload: MfgLeadWebhookPayload, orgId: string) {
    return this.mfgLeads.ingest(payload, orgId);
  }

  async ingestLead(payload: WebhookLeadPayload, orgId: string) {
    const phone = (payload.phone ?? '').replace(/\D/g, '');
    if (!phone) return { error: 'phone required' };

    const existing = await this.prisma.lead.findFirst({
      where: { phone: { endsWith: phone.slice(-10) }, isDeleted: false, orgId },
    });
    if (existing) return { duplicate: true, leadId: existing.id };

    // Org-configured Field Mappings (Administration > Field Mappings) let each org map
    // arbitrary keys in its own webhook payload — beyond this endpoint's documented
    // fields — to core Lead columns and custom fields. Anything the caller sets
    // explicitly (payload.course, payload.customFields.x, etc.) always wins over an
    // alias match; this only fills gaps, never overwrites an explicit value. `source`
    // is excluded — it already goes through the explicit SOURCE_MAP lookup above.
    const raw: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload as unknown as Record<string, unknown>)) {
      if (key === 'customFields' || key === 'source') continue;
      if (typeof value === 'string' && value) raw[key] = value;
    }
    for (const [key, value] of Object.entries(payload.customFields ?? {})) {
      if (value !== undefined && value !== null && String(value)) raw[key] = String(value);
    }
    const fieldMapping = await this.organizations.getFieldMappingsForOrg(orgId);
    const { core, customFields: aliasedCustomFields, unmatchedKeys } = resolveOrgFields(raw, fieldMapping);
    const mergedCustomFields = { ...aliasedCustomFields, ...(payload.customFields ?? {}) };

    // Fire-and-forget — feeds the Administration > Field Mappings suggestion list, never
    // blocks ingestion.
    if (unmatchedKeys.length) void this.organizations.recordDetectedFields(orgId, unmatchedKeys);

    const lead = await this.prisma.lead.create({
      data: {
        name: payload.name,
        phone,
        email: payload.email,
        altPhone: core.altPhone,
        course: payload.course ?? core.course,
        location: payload.location ?? core.location,
        language: core.language,
        tags: core.tags ? core.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        source: SOURCE_MAP[payload.source?.toLowerCase() ?? ''] ?? LeadSource.OTHER,
        sourceCampaign: payload.campaignId,
        rawFields: raw as Prisma.InputJsonValue,
        customFields: (Object.keys(mergedCustomFields).length > 0 ? mergedCustomFields : null) as Prisma.InputJsonValue,
        orgId,
      },
    });

    // Inbound leads carry no team — queueAutomaticAssignment applies the org's Routing
    // settings (autoAssign toggle, per-source team routing, working hours) the same way
    // manually-created/imported leads get them; the chosen rep's team is then applied to
    // the lead during assignment (see AssignmentsService).
    await this.assignments.queueAutomaticAssignment(lead.id, orgId, null, lead.source);

    // Auto-enroll into the org's active lead_created sequences (welcome email, etc.).
    // Fire-and-forget — nurturing must never block ingestion.
    void this.nurturing.autoEnroll(lead.id, orgId, 'lead_created');

    this.logger.log(`Webhook lead ingested: ${lead.id} orgId=${orgId}`);
    return lead;
  }
}
