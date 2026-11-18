import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { LeadSource, IntegrationProvider } from '@prisma/client';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from '../../modules/assignments/assignments.service';
import { NurturingService } from '../../modules/nurturing/nurturing.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { MfgLeadsService } from '../../modules/mfg-leads/mfg-leads.service';
import { DEFAULT_CORE_FIELD_ALIASES } from '../../common/utils/field-mapping.util';

const mockPrisma = {
  lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  orgIntegration: { findUnique: jest.fn() },
};
const mockAssignments = { queueAutomaticAssignment: jest.fn() };
const mockNurturing = { autoEnroll: jest.fn() };
const mockOrganizations = {
  getFieldMappingsForOrg: jest.fn().mockResolvedValue({ coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES, customFieldDefs: [] }),
  recordDetectedFields: jest.fn().mockResolvedValue(undefined),
};

const createdLead = { id: 'lead-wh-1', name: 'Test Lead', phone: '919876543210', source: LeadSource.WEBSITE };

const basePayload = { name: 'Test Lead', phone: '+91 98765 43210', email: 'test@example.com', source: 'website' };

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
      coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
      customFieldDefs: [],
    });
    const module = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AssignmentsService, useValue: mockAssignments },
        { provide: NurturingService, useValue: mockNurturing },
        { provide: OrganizationsService, useValue: mockOrganizations },
        { provide: MfgLeadsService, useValue: { ingest: jest.fn() } },
      ],
    }).compile();
    service = module.get(WebhookService);
  });

  // ── validateSignature ───────────────────────────────────────────────────────

  describe('validateSignature', () => {
    it('returns true when no webhook secret is configured', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      expect(await service.validateSignature('org-1', 'any-body', undefined)).toBe(true);
    });

    it('returns true when integration exists but has no secret', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: null });
      expect(await service.validateSignature('org-1', 'any-body', 'sig')).toBe(true);
    });

    it('returns true for a valid HMAC-SHA256 signature', async () => {
      const secret = 'test-webhook-secret';
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: secret });
      const body = '{"name":"Test"}';
      const sig = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

      expect(await service.validateSignature('org-1', body, sig)).toBe(true);
    });

    it('verifies the signature against the raw request body (Buffer)', async () => {
      const secret = 'test-webhook-secret';
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: secret });
      const rawBody = Buffer.from('{"name":"Test","phone":"9876543210"}');
      const sig = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

      expect(await service.validateSignature('org-1', rawBody, sig)).toBe(true);
    });

    it('returns false for an invalid HMAC signature', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'test-secret' });
      const invalidSig = `sha256=${'0'.repeat(64)}`;

      expect(await service.validateSignature('org-1', 'body', invalidSig)).toBe(false);
    });

    it('returns false when signature length does not match', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'test-secret' });
      expect(await service.validateSignature('org-1', 'body', 'sha256=tooshort')).toBe(false);
    });

    it('looks up integration by orgId', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await service.validateSignature('org-42', 'body', undefined);
      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith({
        where: { orgId_provider: { orgId: 'org-42', provider: IntegrationProvider.WEBHOOK } },
      });
    });
  });

  // ── ingestLead ──────────────────────────────────────────────────────────────

  describe('ingestLead', () => {
    it('scopes dedup findFirst to orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(basePayload, 'org-1');

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes lead create to orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(basePayload, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('returns existing lead without creating when phone is a duplicate in the same org', async () => {
      const existing = { ...createdLead, id: 'existing-1' };
      mockPrisma.lead.findFirst.mockResolvedValue(existing);

      const result = await service.ingestLead(basePayload, 'org-1');

      expect(result).toEqual({ duplicate: true, leadId: 'existing-1' });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('strips non-digits from phone before storing', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(basePayload, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '919876543210' }) }),
      );
    });

    it('maps source string to LeadSource enum value', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, source: 'instagram' }, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: LeadSource.INSTAGRAM }) }),
      );
    });

    it('defaults to LeadSource.OTHER for unknown source strings', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, source: 'unknown-channel' }, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: LeadSource.OTHER }) }),
      );
    });

    it('returns error object when phone is missing', async () => {
      const result = await service.ingestLead({ ...basePayload, phone: '' }, 'org-1');
      expect(result).toEqual({ error: 'phone required' });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('queues org-wide round-robin assignment (via automatic-assignment routing) for the new lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);
      mockAssignments.queueAutomaticAssignment.mockResolvedValue(undefined);

      await service.ingestLead(basePayload, 'org-1');

      expect(mockAssignments.queueAutomaticAssignment).toHaveBeenCalledWith(
        'lead-wh-1',
        'org-1',
        null,
        LeadSource.WEBSITE,
      );
    });

    it('auto-enrolls the new lead into lead_created nurturing sequences', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);
      mockAssignments.queueAutomaticAssignment.mockResolvedValue(undefined);

      await service.ingestLead(basePayload, 'org-1');

      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith('lead-wh-1', 'org-1', 'lead_created');
    });

    it('maps an org-configured custom field alias found in an unlisted top-level payload key', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'org_type' }],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, org_type: 'EdTech' } as never, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customFields: { 'cf-1': 'EdTech' } }) }),
      );
    });

    it('maps an org-configured custom field alias found inside payload.customFields', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'org_type' }],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, customFields: { org_type: 'EdTech' } }, 'org-1');

      // The original raw key is preserved (unchanged generic-webhook behavior for arbitrary
      // customFields) alongside the canonical id, so cross-channel display (keyed by id) works too.
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customFields: { 'cf-1': 'EdTech', org_type: 'EdTech' } }) }),
      );
    });

    it('lets an explicit payload.customFields value win over an alias match for the same key', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'org_type' }],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      // Caller explicitly sets the resolved key itself ("cf-1") alongside the aliasable raw key.
      await service.ingestLead(
        { ...basePayload, org_type: 'EdTech', customFields: { 'cf-1': 'Explicit Value' } } as never,
        'org-1',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customFields: { 'cf-1': 'Explicit Value' } }) }),
      );
    });

    it('lets an explicit payload.course win over an org-configured alias match for course', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, course: 'program' },
        customFieldDefs: [],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, course: 'MBA', program: 'BBA' } as never, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ course: 'MBA' }) }),
      );
    });

    it('falls back to an org-configured alias for course when the caller did not set it explicitly', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, course: 'program' },
        customFieldDefs: [],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, course: undefined, program: 'BBA' } as never, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ course: 'BBA' }) }),
      );
    });

    it('records a top-level payload key that matched no configured alias', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...basePayload, budget: '50000' } as never, 'org-1');

      expect(mockOrganizations.recordDetectedFields).toHaveBeenCalledWith('org-1', expect.arrayContaining(['budget']));
    });
  });
});
