import { Test } from '@nestjs/testing';
import axios from 'axios';
import { LeadSource, IntegrationStatus } from '@prisma/client';
import { GoogleService } from './google.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from '../../modules/assignments/assignments.service';
import { NurturingService } from '../../modules/nurturing/nurturing.service';
import { CampaignsService } from '../../modules/campaigns/campaigns.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { DEFAULT_CORE_FIELD_ALIASES } from '../../common/utils/field-mapping.util';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../common/crypto.utils', () => ({
  encryptToken: jest.fn((s: string) => `enc:${s}`),
  decryptToken: jest.fn((s: string) => s.replace(/^enc:/, '')),
}));

const mockPrisma = {
  lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  orgIntegration: { findUnique: jest.fn(), update: jest.fn() },
};

// processLead now verifies google_key by loading the GOOGLE_ADS integration. Default to
// "no key configured" so the ingestion-path tests aren't blocked; override per-test as needed.
const noKeyConfigured = () => mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: null });
const mockAssignments = { queueAutomaticAssignment: jest.fn() };
const mockNurturing = { autoEnroll: jest.fn() };
const mockCampaigns = { resolveHierarchy: jest.fn().mockResolvedValue({}) };
const mockOrganizations = {
  getFieldMappingsForOrg: jest.fn().mockResolvedValue({ coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES, customFieldDefs: [] }),
  recordDetectedFields: jest.fn().mockResolvedValue(undefined),
};

const createdLead = { id: 'lead-g-1', name: 'John Smith', phone: '919876543210', source: LeadSource.GOOGLE_ADS };

const makePayload = (phone = '+91 98765 43210', name = 'John Smith') => ({
  lead_id: 'ggl-1',
  campaign_id: 'camp-1',
  adgroup_id: 'ad-1',
  creative_id: 'cr-1',
  user_column_data: [
    { column_name: 'PHONE_NUMBER', string_value: phone },
    { column_name: 'FULL_NAME', string_value: name },
    { column_name: 'EMAIL', string_value: 'john@example.com' },
  ],
});

describe('GoogleService', () => {
  let service: GoogleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    noKeyConfigured();
    mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
      coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
      customFieldDefs: [],
    });
    const module = await Test.createTestingModule({
      providers: [
        GoogleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AssignmentsService, useValue: mockAssignments },
        { provide: NurturingService, useValue: mockNurturing },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: OrganizationsService, useValue: mockOrganizations },
      ],
    }).compile();
    service = module.get(GoogleService);
  });

  // ── processLead ─────────────────────────────────────────────────────────────

  describe('processLead', () => {
    it('scopes dedup findFirst to orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(makePayload(), 'org-1');

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes lead create to orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(makePayload(), 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('returns duplicate when phone already exists in same org', async () => {
      const existing = { ...createdLead, id: 'existing-1' };
      mockPrisma.lead.findFirst.mockResolvedValue(existing);

      const result = await service.processLead(makePayload(), 'org-1');

      expect(result).toEqual({ duplicate: true, leadId: 'existing-1' });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('strips non-digits from phone before storing', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(makePayload('+91 98765 43210'), 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '919876543210' }) }),
      );
    });

    it('ignores the lead when phone is absent', async () => {
      const payloadNoPhone = {
        user_column_data: [{ column_name: 'FULL_NAME', string_value: 'No Phone' }],
      };
      const result = await service.processLead(payloadNoPhone, 'org-1');
      expect(result).toEqual({ ignored: true, reason: 'no_phone' });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('matches fields by stable column_id (real Google payload shape)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(
        {
          user_column_data: [
            { column_id: 'FULL_NAME', column_name: 'Your name', string_value: 'Jane Roe' },
            { column_id: 'PHONE_NUMBER', column_name: 'Mobile', string_value: '+91 90000 11111' },
            { column_id: 'EMAIL', column_name: 'Work email', string_value: 'jane@roe.com' },
          ],
        },
        'org-1',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Jane Roe', phone: '919000011111', email: 'jane@roe.com' }),
        }),
      );
    });

    it('acknowledges a test lead without creating a record', async () => {
      const result = await service.processLead({ ...makePayload(), is_test: true }, 'org-1');
      expect(result).toEqual({ test: true });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('rejects the lead when google_key does not match the configured key', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'right-key' });

      const result = await service.processLead({ ...makePayload(), google_key: 'wrong-key' }, 'org-1');

      expect(result).toEqual({ ignored: true, reason: 'invalid_key' });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('ingests the lead when google_key matches the configured key', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'right-key' });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      const result = await service.processLead({ ...makePayload(), google_key: 'right-key' }, 'org-1');

      expect(result).toEqual(createdLead);
      expect(mockPrisma.lead.create).toHaveBeenCalled();
    });

    it('sets source to GOOGLE_ADS', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(makePayload(), 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: LeadSource.GOOGLE_ADS }) }),
      );
    });

    it('queues org-wide round-robin assignment (via automatic-assignment routing) for the new lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);
      mockAssignments.queueAutomaticAssignment.mockResolvedValue(undefined);

      await service.processLead(makePayload(), 'org-1');

      expect(mockAssignments.queueAutomaticAssignment).toHaveBeenCalledWith(
        'lead-g-1',
        'org-1',
        null,
        LeadSource.GOOGLE_ADS,
      );
    });

    it('auto-enrolls the new lead into lead_created nurturing sequences', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);
      mockAssignments.queueAutomaticAssignment.mockResolvedValue(undefined);

      await service.processLead(makePayload(), 'org-1');

      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith('lead-g-1', 'org-1', 'lead_created');
    });

    it('maps an org-configured core field alias onto the matching Lead column', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, course: 'which_course_are_you_interested_in' },
        customFieldDefs: [],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(
        {
          ...makePayload(),
          user_column_data: [
            ...makePayload().user_column_data,
            { column_id: 'which_course_are_you_interested_in', string_value: 'MBA' },
          ],
        },
        'org-1',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ course: 'MBA' }) }),
      );
    });

    it('maps an org-configured custom field definition into Lead.customFields keyed by its id', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'what_type_of_organization_do_you_run?' }],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(
        {
          ...makePayload(),
          user_column_data: [
            ...makePayload().user_column_data,
            { column_id: 'what_type_of_organization_do_you_run?', string_value: 'EdTech' },
          ],
        },
        'org-1',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customFields: { 'cf-1': 'EdTech' } }) }),
      );
    });

    it('records raw form fields that matched no configured alias', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.processLead(
        {
          ...makePayload(),
          user_column_data: [
            ...makePayload().user_column_data,
            { column_id: 'preferred_batch', string_value: 'Weekend' },
          ],
        },
        'org-1',
      );

      expect(mockOrganizations.recordDetectedFields).toHaveBeenCalledWith('org-1', expect.arrayContaining(['preferred_batch']));
    });
  });

  // ── getValidAccessToken ──────────────────────────────────────────────────────

  describe('getValidAccessToken', () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    it('returns null when no integration exists', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      expect(await service.getValidAccessToken('org-1')).toBeNull();
    });

    it('returns null when integration is not CONNECTED', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.DISCONNECTED,
        accessToken: 'enc:tok',
        tokenExpiry: futureExpiry,
      });
      expect(await service.getValidAccessToken('org-1')).toBeNull();
    });

    it('returns decrypted access token when valid and not expiring soon', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        id: 'int-1',
        status: IntegrationStatus.CONNECTED,
        accessToken: 'enc:valid-token',
        refreshToken: 'enc:refresh-token',
        tokenExpiry: futureExpiry,
      });

      const result = await service.getValidAccessToken('org-1');
      expect(result).toBe('valid-token');
    });

    it('triggers refresh when token expires within 5 minutes', async () => {
      const nearExpiry = new Date(Date.now() + 3 * 60 * 1000); // 3 min from now
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        id: 'int-1',
        status: IntegrationStatus.CONNECTED,
        accessToken: 'enc:old-token',
        refreshToken: 'enc:refresh-tok',
        tokenExpiry: nearExpiry,
      });
      process.env.GOOGLE_ADS_CLIENT_ID = 'cid';
      process.env.GOOGLE_ADS_CLIENT_SECRET = 'csec';
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'new-token', expires_in: 3600 } });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      const result = await service.getValidAccessToken('org-1');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({ grant_type: 'refresh_token', refresh_token: 'refresh-tok' }),
      );
      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1' },
          data: expect.objectContaining({ accessToken: 'enc:new-token' }),
        }),
      );
      expect(result).toBe('new-token');

      delete process.env.GOOGLE_ADS_CLIENT_ID;
      delete process.env.GOOGLE_ADS_CLIENT_SECRET;
    });

    it('sets integration to ERROR when refresh fails', async () => {
      const nearExpiry = new Date(Date.now() + 3 * 60 * 1000);
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        id: 'int-1',
        status: IntegrationStatus.CONNECTED,
        accessToken: 'enc:old-token',
        refreshToken: 'enc:refresh-tok',
        tokenExpiry: nearExpiry,
      });
      process.env.GOOGLE_ADS_CLIENT_ID = 'cid';
      process.env.GOOGLE_ADS_CLIENT_SECRET = 'csec';
      mockedAxios.post.mockRejectedValue(new Error('Network error'));
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      const result = await service.getValidAccessToken('org-1');

      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: IntegrationStatus.ERROR } }),
      );
      expect(result).toBeNull();

      delete process.env.GOOGLE_ADS_CLIENT_ID;
      delete process.env.GOOGLE_ADS_CLIENT_SECRET;
    });

    it('sets integration to ERROR when no refresh token is available', async () => {
      const nearExpiry = new Date(Date.now() + 3 * 60 * 1000);
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        id: 'int-2',
        status: IntegrationStatus.CONNECTED,
        accessToken: 'enc:old-token',
        refreshToken: null,
        tokenExpiry: nearExpiry,
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      const result = await service.getValidAccessToken('org-1');

      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: IntegrationStatus.ERROR } }),
      );
      expect(result).toBeNull();
    });
  });
});
