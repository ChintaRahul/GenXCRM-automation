import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import axios from 'axios';
import { LeadSource, IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { FacebookService } from './facebook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from '../../modules/assignments/assignments.service';
import { NurturingService } from '../../modules/nurturing/nurturing.service';
import { CampaignsService } from '../../modules/campaigns/campaigns.service';
import { WhatsappWebhookService } from '../whatsapp/whatsapp-webhook.service';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { IngestionAlertsService } from '../../modules/ingestion-alerts/ingestion-alerts.service';
import { DEFAULT_CORE_FIELD_ALIASES } from '../../common/utils/field-mapping.util';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../common/crypto.utils', () => ({
  decryptToken: jest.fn((ciphertext: string) => `decrypted-${ciphertext}`),
}));

const mockPrisma = {
  lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  activity: { create: jest.fn() },
  orgIntegration: { findMany: jest.fn() },
  organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Test Org' }) },
  $executeRaw: jest.fn().mockResolvedValue(undefined),
  $transaction: jest.fn(),
};
const mockAssignments = { queueAutomaticAssignment: jest.fn() };
const mockNurturing = { autoEnroll: jest.fn() };
const mockCampaigns = { resolveHierarchy: jest.fn().mockResolvedValue({}) };
const mockWhatsappWebhook = { processEmbeddedSignupEvent: jest.fn().mockResolvedValue(undefined) };
const mockOrganizations = {
  getFieldMappingsForOrg: jest.fn().mockResolvedValue({ coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES, customFieldDefs: [] }),
  recordDetectedFields: jest.fn().mockResolvedValue(undefined),
};
const mockAlerts = { recordFailure: jest.fn().mockResolvedValue(undefined) };

const createdLead = { id: 'lead-fb-1', name: 'Jane Doe', phone: '919876543210', source: LeadSource.FACEBOOK };
const mockOrgIntegration = {
  id: 'int-1',
  orgId: 'org-1',
  provider: IntegrationProvider.FACEBOOK,
  status: IntegrationStatus.CONNECTED,
  accessToken: null, // tests use env var fallback
};

describe('FacebookService', () => {
  let service: FacebookService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$executeRaw.mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
    );
    mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
      coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
      customFieldDefs: [],
    });
    const module = await Test.createTestingModule({
      providers: [
        FacebookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AssignmentsService, useValue: mockAssignments },
        { provide: NurturingService, useValue: mockNurturing },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: WhatsappWebhookService, useValue: mockWhatsappWebhook },
        { provide: OrganizationsService, useValue: mockOrganizations },
        { provide: IngestionAlertsService, useValue: mockAlerts },
      ],
    }).compile();
    service = module.get(FacebookService);
  });

  // ── verifyWebhook ───────────────────────────────────────────────────────────

  describe('verifyWebhook', () => {
    const originalToken = process.env.FACEBOOK_VERIFY_TOKEN;
    afterEach(() => {
      process.env.FACEBOOK_VERIFY_TOKEN = originalToken;
    });

    it('returns challenge when mode=subscribe and token matches env var', () => {
      process.env.FACEBOOK_VERIFY_TOKEN = 'my-token';
      expect(service.verifyWebhook('subscribe', 'my-token', 'ch-abc')).toBe('ch-abc');
    });

    it('returns challenge using default token when env var is unset', () => {
      delete process.env.FACEBOOK_VERIFY_TOKEN;
      expect(service.verifyWebhook('subscribe', 'genxcrm-fb-verify', 'ch-xyz')).toBe('ch-xyz');
    });

    it('returns null when token does not match', () => {
      delete process.env.FACEBOOK_VERIFY_TOKEN;
      expect(service.verifyWebhook('subscribe', 'wrong-token', 'ch-xyz')).toBeNull();
    });

    it('returns null when mode is not subscribe', () => {
      delete process.env.FACEBOOK_VERIFY_TOKEN;
      expect(service.verifyWebhook('unsubscribe', 'genxcrm-fb-verify', 'ch-xyz')).toBeNull();
    });
  });

  // ── verifySignature ─────────────────────────────────────────────────────────

  describe('verifySignature', () => {
    const originalSecret = process.env.FACEBOOK_APP_SECRET;
    afterEach(() => {
      process.env.FACEBOOK_APP_SECRET = originalSecret;
    });

    it('returns true when FACEBOOK_APP_SECRET is not set', () => {
      delete process.env.FACEBOOK_APP_SECRET;
      expect(service.verifySignature('any-body', 'any-sig')).toBe(true);
    });

    it('returns true for a valid HMAC-SHA256 signature', () => {
      process.env.FACEBOOK_APP_SECRET = 'test-secret';
      const body = 'test-body';
      const sig = `sha256=${crypto.createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
      expect(service.verifySignature(body, sig)).toBe(true);
    });

    it('returns false for an incorrect signature of the correct length', () => {
      process.env.FACEBOOK_APP_SECRET = 'test-secret';
      const badSig = `sha256=${'0'.repeat(64)}`;
      expect(service.verifySignature('test-body', badSig)).toBe(false);
    });
  });

  // ── processLeadEvent (org routing) ─────────────────────────────────────────

  describe('processLeadEvent', () => {
    it('looks up every CONNECTED OrgIntegration for the page_id from entry.id', () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([]);
      service.processLeadEvent({
        object: 'page',
        entry: [
          {
            id: 'page-123',
            changes: [{ field: 'leadgen', value: { leadgen_id: 'lg-1', form_id: 'f-1', page_id: 'page-123' } }],
          },
        ],
      });
      expect(mockPrisma.orgIntegration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accountId: 'page-123',
            provider: IntegrationProvider.FACEBOOK,
            status: IntegrationStatus.CONNECTED,
          }),
        }),
      );
    });

    it('fans out to every org connected to the same page — a page can be shared by multiple orgs', async () => {
      const orgA = { ...mockOrgIntegration, orgId: 'org-a' };
      const orgB = { ...mockOrgIntegration, orgId: 'org-b' };
      mockPrisma.orgIntegration.findMany.mockResolvedValue([orgA, orgB]);
      const spy = jest.spyOn(service as any, 'fetchAndStoreLead').mockResolvedValue(undefined);

      service.processLeadEvent({
        object: 'page',
        entry: [
          {
            id: 'page-123',
            changes: [{ field: 'leadgen', value: { leadgen_id: 'lg-shared', form_id: 'f-1', page_id: 'page-123' } }],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.map((call) => call[6])).toEqual(expect.arrayContaining(['org-a', 'org-b']));
    });

    it('ignores changes where field is not "leadgen"', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([mockOrgIntegration]);
      const spy = jest.spyOn(service as any, 'fetchAndStoreLead').mockResolvedValue(undefined);
      service.processLeadEvent({
        object: 'page',
        entry: [
          {
            id: 'page-123',
            changes: [{ field: 'feed', value: { leadgen_id: 'lg-3', form_id: 'f-3', page_id: 'p-3' } }],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(spy).not.toHaveBeenCalled();
    });

    it('handles empty entry array without throwing', () => {
      expect(() => service.processLeadEvent({ object: 'page', entry: [] })).not.toThrow();
    });
  });

  describe('processLeadEvent — WhatsApp dispatch', () => {
    it('delegates whatsapp_business_account events to WhatsappWebhookService and does not run the leadgen path', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-1', changes: [] }],
      };
      service.processLeadEvent(payload as never);
      expect(mockWhatsappWebhook.processEmbeddedSignupEvent).toHaveBeenCalledWith(payload);
      expect(mockPrisma.orgIntegration.findMany).not.toHaveBeenCalled();
    });

    it('still runs the leadgen path for object: "page"', () => {
      service.processLeadEvent({ object: 'page', entry: [] });
      expect(mockWhatsappWebhook.processEmbeddedSignupEvent).not.toHaveBeenCalled();
    });
  });

  // ── ingestLead (orgId scoping) ──────────────────────────────────────────────

  describe('ingestLead', () => {
    const leadData = { name: 'Jane Doe', phone: '+91 98765 43210', email: 'jane@example.com' };

    it('scopes dedup findFirst to orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(leadData, 'org-1');

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes lead create to orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(leadData, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('returns existing lead without creating when phone is a duplicate within the same org', async () => {
      const existing = { ...createdLead, id: 'existing-1' };
      mockPrisma.lead.findFirst.mockResolvedValue(existing);
      mockPrisma.lead.update.mockResolvedValue(existing);

      const result = await service.ingestLead(leadData, 'org-1');

      expect(result).toEqual(existing);
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('bumps activityAt on the existing lead when it is resubmitted, so it resurfaces as recent', async () => {
      const existing = { ...createdLead, id: 'existing-1' };
      mockPrisma.lead.findFirst.mockResolvedValue(existing);
      mockPrisma.lead.update.mockResolvedValue({ ...existing, activityAt: new Date() });

      await service.ingestLead(leadData, 'org-1');

      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'existing-1' },
        data: { activityAt: expect.any(Date) },
      });
    });

    it('treats a redelivery of the same leadgen id as the same submission: no bump, no activity', async () => {
      const existing = { ...createdLead, id: 'existing-1', leadgenId: 'lg-1' };
      mockPrisma.lead.findFirst.mockResolvedValue(existing);

      const result = await service.ingestLead({ ...leadData, leadgenId: 'lg-1' }, 'org-1');

      expect(result).toEqual(existing);
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });

    it('logs a RESUBMITTED activity on the existing lead so the timeline explains why it resurfaced', async () => {
      const existing = { ...createdLead, id: 'existing-1' };
      mockPrisma.lead.findFirst.mockResolvedValue(existing);
      mockPrisma.lead.update.mockResolvedValue(existing);

      await service.ingestLead(leadData, 'org-1');

      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: 'existing-1',
          type: 'RESUBMITTED',
          note: expect.stringContaining('Submitted again'),
        }),
      });
    });

    it('skips dedup and still creates the lead when phone has no digits (no false-duplicate drop)', async () => {
      mockPrisma.lead.create.mockResolvedValue({ ...createdLead, phone: '' });

      const result = await service.ingestLead({ name: 'No Number', phone: 'N/A' }, 'org-1');

      // endsWith('') would match the first lead in the org — guard must skip the lookup entirely
      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '' }) }),
      );
      expect(result).toEqual({ ...createdLead, phone: '' });
    });

    it('includes an email match in the dedup lookup, not just phone', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(
        { name: 'Jane Doe', phone: '+91 99999 99999', email: 'jane@example.com' },
        'org-1',
      );

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ email: 'jane@example.com' }]),
          }),
        }),
      );
    });

    it('serializes the duplicate check with a Postgres advisory lock inside a transaction', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(leadData, 'org-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      const [strings] = mockPrisma.$executeRaw.mock.calls[0] as [TemplateStringsArray];
      expect(strings.join('')).toContain('pg_advisory_xact_lock');
    });

    it('strips non-digits from phone before storing', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(leadData, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '919876543210' }) }),
      );
    });

    it('does not look up org field mappings when no rawFields are passed', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(leadData, 'org-1');

      expect(mockOrganizations.getFieldMappingsForOrg).not.toHaveBeenCalled();
    });

    it('maps an org-configured custom field definition into Lead.customFields keyed by its id', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'what_type_of_organization_do_you_run?' }],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(
        { ...leadData, rawFields: { what_type_of_organization_do_you_run__c: 'irrelevant', 'what_type_of_organization_do_you_run?': 'EdTech' } },
        'org-1',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customFields: { 'cf-1': 'EdTech' } }) }),
      );
      expect(mockOrganizations.recordDetectedFields).toHaveBeenCalledWith('org-1', [
        'what_type_of_organization_do_you_run__c',
      ]);
    });

    it('does not record detected fields when every raw key matches a configured alias', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'which_city_are_you_in?' },
        customFieldDefs: [],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ ...leadData, rawFields: { 'which_city_are_you_in?': 'Pune' } }, 'org-1');

      expect(mockOrganizations.recordDetectedFields).not.toHaveBeenCalled();
    });

    it('maps an org-configured core field alias onto the matching Lead column', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'which_city_are_you_in?' },
        customFieldDefs: [],
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead(
        { ...leadData, rawFields: { 'which_city_are_you_in?': 'Pune' } },
        'org-1',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ location: 'Pune' }) }),
      );
    });

    it('sets source to INSTAGRAM when platform is instagram', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue({ ...createdLead, source: LeadSource.INSTAGRAM });

      await service.ingestLead({ ...leadData, platform: 'instagram' }, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: LeadSource.INSTAGRAM }) }),
      );
    });

    it('queues org-wide round-robin assignment (via automatic-assignment routing) for the new lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);
      mockAssignments.queueAutomaticAssignment.mockResolvedValue(undefined);

      await service.ingestLead(leadData, 'org-1');

      expect(mockAssignments.queueAutomaticAssignment).toHaveBeenCalledWith(
        'lead-fb-1',
        'org-1',
        null,
        LeadSource.FACEBOOK,
      );
    });

    it('auto-enrolls the new lead into lead_created nurturing sequences', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);
      mockAssignments.queueAutomaticAssignment.mockResolvedValue(undefined);

      await service.ingestLead(leadData, 'org-1');

      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith('lead-fb-1', 'org-1', 'lead_created');
    });
  });

  // ── fetchAndStoreLead (private) ─────────────────────────────────────────────

  describe('fetchAndStoreLead', () => {
    const originalToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    beforeEach(() => {
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-access-token';
    });
    afterEach(() => {
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = originalToken;
    });

    it('does not call Graph API when no token is available', async () => {
      delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
      await (service as any).fetchAndStoreLead(
        'lg-1',
        'f-1',
        'facebook',
        undefined,
        undefined,
        undefined,
        'org-1',
        undefined,
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('calls Graph API v25.0 with the per-org access token', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          field_data: [
            { name: 'full_name', values: ['Jane Doe'] },
            { name: 'phone_number', values: ['9876543210'] },
          ],
        },
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await (service as any).fetchAndStoreLead(
        'lg-5',
        'f-1',
        'facebook',
        undefined,
        undefined,
        undefined,
        'org-1',
        'per-org-token',
      );

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/lg-5',
        expect.objectContaining({ params: expect.objectContaining({ access_token: 'per-org-token' }) }),
      );
    });

    it('skips ingestion when phone field is absent and records the failure', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { field_data: [{ name: 'full_name', values: ['No Phone'] }] },
      });
      await (service as any).fetchAndStoreLead(
        'lg-6',
        'f-1',
        'facebook',
        undefined,
        undefined,
        undefined,
        'org-1',
        'token',
      );
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockAlerts.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ leadgenId: 'lg-6', orgId: 'org-1', reason: expect.stringContaining('phone_number') }),
      );
    });

    it('resolves without throwing when Graph API call fails, and records the failure with org + lead info', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network Error'));
      await expect(
        (service as any).fetchAndStoreLead(
          'lg-9',
          'f-1',
          'facebook',
          undefined,
          undefined,
          undefined,
          'org-1',
          'token',
        ),
      ).resolves.toBeUndefined();
      expect(mockAlerts.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ leadgenId: 'lg-9', orgId: 'org-1', reason: 'Network Error' }),
      );
    });

    it('does not retry a non-rate-limit error — one Graph API call, lead still dropped', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network Error'));
      mockedAxios.isAxiosError.mockReturnValue(false);
      await (service as any).fetchAndStoreLead(
        'lg-9b',
        'f-1',
        'facebook',
        undefined,
        undefined,
        undefined,
        'org-1',
        'token',
      );
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('retries once after a rate-limited lead fetch (80004) and ingests the lead on the retry', async () => {
      jest.useFakeTimers();
      let callCount = 0;
      mockedAxios.get.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          const rateLimitErr = Object.assign(new Error('rate limited'), {
            isAxiosError: true,
            response: { data: { error: { code: 80004 } } },
          });
          return Promise.reject(rateLimitErr);
        }
        return Promise.resolve({
          data: {
            field_data: [
              { name: 'full_name', values: ['Retry Lead'] },
              { name: 'phone_number', values: ['9876543210'] },
            ],
          },
        });
      });
      mockedAxios.isAxiosError.mockImplementation((err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true);
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      const resultPromise = (service as any).fetchAndStoreLead(
        'lg-9c',
        'f-1',
        'facebook',
        undefined,
        undefined,
        undefined,
        'org-1',
        'token',
      );
      await jest.advanceTimersByTimeAsync(5000);
      await resultPromise;

      expect(callCount).toBe(2);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Retry Lead', leadgenId: 'lg-9c' }) }),
      );
      jest.useRealTimers();
    });

    it('retries a code-less TooManyRequestsException (HTTP 429) lead fetch and ingests on the retry', async () => {
      jest.useFakeTimers();
      let callCount = 0;
      mockedAxios.get.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(
            Object.assign(new Error('Request failed with status code 429'), {
              isAxiosError: true,
              response: { status: 429, data: { error: { type: 'TooManyRequestsException', message: 'An error has occurred.' } } },
            }),
          );
        }
        return Promise.resolve({
          data: {
            field_data: [
              { name: 'full_name', values: ['Throttled Lead'] },
              { name: 'phone_number', values: ['9876543210'] },
            ],
          },
        });
      });
      mockedAxios.isAxiosError.mockImplementation((err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true);
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      const resultPromise = (service as any).fetchAndStoreLead('lg-9d', 'f-1', 'facebook', undefined, undefined, undefined, 'org-1', 'token');
      await jest.advanceTimersByTimeAsync(5000);
      await resultPromise;

      expect(callCount).toBe(2);
      expect(mockAlerts.recordFailure).not.toHaveBeenCalled();
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Throttled Lead', leadgenId: 'lg-9d' }) }),
      );
      jest.useRealTimers();
    });

    it('resolves campaign_id via a Graph API lookup on ad_id when the webhook omits it and an ad-account token is connected', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.endsWith('/lg-10')) {
          return Promise.resolve({
            data: {
              field_data: [
                { name: 'full_name', values: ['Jane Doe'] },
                { name: 'phone_number', values: ['9876543210'] },
              ],
            },
          });
        }
        if (url.endsWith('/ad-1')) {
          return Promise.resolve({ data: { campaign_id: 'camp-1', adset_id: 'adset-1' } });
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await (service as any).fetchAndStoreLead(
        'lg-10',
        'f-1',
        'facebook',
        'ad-1',
        undefined,
        undefined,
        'org-1',
        'token',
        'ad-account-token',
      );

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/ad-1',
        expect.objectContaining({
          params: expect.objectContaining({ fields: 'campaign_id,adset_id', access_token: 'ad-account-token' }),
        }),
      );
      expect(mockCampaigns.resolveHierarchy).toHaveBeenCalledWith(
        'org-1',
        LeadSource.FACEBOOK,
        expect.objectContaining({ campaign: 'camp-1', adSet: 'adset-1' }),
      );
    });

    it('overrides a webhook adgroup_id that is wrong (equal to ad_id) with the value from the Graph API lookup, even when campaign_id was already present', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.endsWith('/lg-13')) {
          return Promise.resolve({
            data: {
              field_data: [
                { name: 'full_name', values: ['Jane Doe'] },
                { name: 'phone_number', values: ['9876543210'] },
              ],
            },
          });
        }
        if (url.endsWith('/ad-1')) {
          return Promise.resolve({ data: { campaign_id: 'camp-1', adset_id: 'real-adset-1' } });
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await (service as any).fetchAndStoreLead(
        'lg-13',
        'f-1',
        'facebook',
        'ad-1',
        'ad-1', // webhook's adgroup_id wrongly equals ad_id — must not be trusted as-is
        'camp-1', // webhook already supplied campaign_id
        'org-1',
        'token',
        'ad-account-token',
      );

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/ad-1',
        expect.objectContaining({
          params: expect.objectContaining({ fields: 'campaign_id,adset_id', access_token: 'ad-account-token' }),
        }),
      );
      expect(mockCampaigns.resolveHierarchy).toHaveBeenCalledWith(
        'org-1',
        LeadSource.FACEBOOK,
        expect.objectContaining({ campaign: 'camp-1', adSet: 'real-adset-1' }),
      );
    });

    it('does not attempt the ad lookup when no ad-account token is connected', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          field_data: [
            { name: 'full_name', values: ['Jane Doe'] },
            { name: 'phone_number', values: ['9876543210'] },
          ],
        },
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await (service as any).fetchAndStoreLead(
        'lg-11',
        'f-1',
        'facebook',
        'ad-1',
        undefined,
        undefined,
        'org-1',
        'token',
        undefined,
      );

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockCampaigns.resolveHierarchy).toHaveBeenCalledWith(
        'org-1',
        LeadSource.FACEBOOK,
        expect.objectContaining({ campaign: undefined }),
      );
    });

    it('passes every field_data question through to org field-mapping resolution, not just name/phone/email', async () => {
      mockOrganizations.getFieldMappingsForOrg.mockResolvedValue({
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'what_type_of_organization_do_you_run?' }],
      });
      mockedAxios.get.mockResolvedValue({
        data: {
          field_data: [
            { name: 'full_name', values: ['Jane Doe'] },
            { name: 'phone_number', values: ['9876543210'] },
            { name: 'what_type_of_organization_do_you_run?', values: ['EdTech'] },
          ],
        },
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await (service as any).fetchAndStoreLead(
        'lg-14',
        'f-1',
        'facebook',
        undefined,
        undefined,
        undefined,
        'org-1',
        'token',
      );

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customFields: { 'cf-1': 'EdTech' } }) }),
      );
    });

    it('still ingests the lead when the campaign_id lookup itself fails', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.endsWith('/lg-12')) {
          return Promise.resolve({
            data: {
              field_data: [
                { name: 'full_name', values: ['Jane Doe'] },
                { name: 'phone_number', values: ['9876543210'] },
              ],
            },
          });
        }
        return Promise.reject(new Error('permission denied'));
      });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await expect(
        (service as any).fetchAndStoreLead(
          'lg-12',
          'f-1',
          'facebook',
          'ad-1',
          undefined,
          undefined,
          'org-1',
          'token',
          'ad-account-token',
        ),
      ).resolves.toBeUndefined();

      expect(mockPrisma.lead.create).toHaveBeenCalled();
    });
  });

  // ── leadgenId persistence ───────────────────────────────────────────────────

  describe('ingestLead — leadgenId', () => {
    it('stores the Meta leadgen id on the created lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(createdLead);

      await service.ingestLead({ name: 'Jane', phone: '9876543210', leadgenId: 'lg-1' }, 'org-1');

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadgenId: 'lg-1' }) }),
      );
    });
  });
});
