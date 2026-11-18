import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { IntegrationsConfigService } from './integrations-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FacebookInsightsService } from '../facebook-insights/facebook-insights.service';
import { FacebookLeadBackfillService } from '../facebook-lead-backfill/facebook-lead-backfill.service';
import { IntegrationProvider, IntegrationStatus, Role } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

jest.mock('axios');
jest.mock('../../common/crypto.utils', () => ({
  encryptToken: jest.fn((t: string) => `enc:${t}`),
  decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')),
}));

const mockTransporterVerify = jest.fn().mockResolvedValue(true);
const mockCreateTransport = jest.fn().mockReturnValue({ verify: mockTransporterVerify });
jest.mock('nodemailer', () => ({ createTransport: (...args: unknown[]) => mockCreateTransport(...args) }));

const mockSesVerifyDomainIdentity = jest.fn();
const mockSesVerifyDomainDkim = jest.fn();
const mockSesGetIdentityVerificationAttributes = jest.fn();
const mockSesDeleteIdentity = jest.fn().mockReturnValue({ promise: () => Promise.resolve({}) });
jest.mock('aws-sdk', () => ({
  SES: jest.fn().mockImplementation(() => ({
    verifyDomainIdentity: (...args: unknown[]) => mockSesVerifyDomainIdentity(...args),
    verifyDomainDkim: (...args: unknown[]) => mockSesVerifyDomainDkim(...args),
    getIdentityVerificationAttributes: (...args: unknown[]) => mockSesGetIdentityVerificationAttributes(...args),
    deleteIdentity: (...args: unknown[]) => mockSesDeleteIdentity(...args),
  })),
}));

const mockRzpPaymentsAll = jest.fn().mockResolvedValue({ items: [] });
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({ payments: { all: (...args: unknown[]) => mockRzpPaymentsAll(...args) } })),
);

const mockInsights = { enqueueSync: jest.fn() };
const mockLeadBackfill = { enqueueBackfill: jest.fn().mockResolvedValue(undefined) };

const mockCaller: AuthUser = {
  id: 'user-1',
  name: 'Test Director',
  email: 'director@test.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

const mockPrisma = {
  orgIntegration: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('IntegrationsConfigService', () => {
  let service: IntegrationsConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsConfigService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FacebookInsightsService, useValue: mockInsights },
        { provide: FacebookLeadBackfillService, useValue: mockLeadBackfill },
      ],
    }).compile();

    service = module.get(IntegrationsConfigService);
  });

  describe('getStatuses', () => {
    it('scopes query to caller.orgId', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([]);
      await service.getStatuses(mockCaller);
      expect(mockPrisma.orgIntegration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('never returns raw accessToken or refreshToken', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([
        {
          provider: IntegrationProvider.FACEBOOK,
          status: IntegrationStatus.CONNECTED,
          accessToken: 'super-secret-token',
          refreshToken: 'super-secret-refresh',
          accountName: 'Test Page',
          accountId: 'page123',
          tokenExpiry: null,
        },
      ]);
      const result = await service.getStatuses(mockCaller);
      expect(result[0]).not.toHaveProperty('accessToken');
      expect(result[0]).not.toHaveProperty('refreshToken');
    });

    it('surfaces lastBackfill info from the metadata JSON column', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([
        {
          provider: IntegrationProvider.FACEBOOK,
          status: IntegrationStatus.CONNECTED,
          accountId: 'page123',
          accountName: 'Test Page',
          tokenExpiry: null,
          metadata: { lastBackfill: { at: '2026-08-08T10:00:00.000Z', leadsProcessed: 3 } },
        },
      ]);
      const result = await service.getStatuses(mockCaller);
      expect(result[0].lastBackfillAt).toEqual(new Date('2026-08-08T10:00:00.000Z'));
      expect(result[0].lastBackfillLeadsCount).toBe(3);
    });

    it('surfaces metadata.connectMethod on the returned status', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([
        {
          provider: IntegrationProvider.WHATSAPP,
          status: IntegrationStatus.CONNECTED,
          accountName: 'Acme WhatsApp',
          accountId: '1234567890123',
          tokenExpiry: null,
          metadata: { connectMethod: 'EMBEDDED_SIGNUP' },
        },
      ]);
      const result = await service.getStatuses(mockCaller);
      expect(result[0].connectMethod).toBe('EMBEDDED_SIGNUP');
    });

    it('returns connectMethod null when metadata has none', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([
        {
          provider: IntegrationProvider.FACEBOOK,
          status: IntegrationStatus.CONNECTED,
          accountName: 'Acme Page',
          accountId: 'pg-1',
          tokenExpiry: null,
          metadata: null,
        },
      ]);
      const result = await service.getStatuses(mockCaller);
      expect(result[0].connectMethod).toBeNull();
    });

    it('masks accountId to last 4 chars', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([
        {
          provider: IntegrationProvider.FACEBOOK,
          status: IntegrationStatus.CONNECTED,
          accountId: 'page_1234567890',
          accountName: 'Test',
          tokenExpiry: null,
        },
      ]);
      const result = await service.getStatuses(mockCaller);
      expect(result[0].maskedAccountId).toBe('****7890');
    });
  });

  describe('initFacebookOAuth', () => {
    it('throws InternalServerErrorException when FACEBOOK_APP_ID is not set', () => {
      const origAppId = process.env.FACEBOOK_APP_ID;
      delete process.env.FACEBOOK_APP_ID;
      expect(() => service.initFacebookOAuth(mockCaller)).toThrow(InternalServerErrorException);
      process.env.FACEBOOK_APP_ID = origAppId;
    });

    it('returns a URL containing the Facebook OAuth domain when configured', () => {
      process.env.FACEBOOK_APP_ID = 'test-app-id';
      process.env.FACEBOOK_LEAD_ADS_REDIRECT_URI = 'http://localhost:3000/callback';
      const result = service.initFacebookOAuth(mockCaller);
      expect(result.url).toContain('facebook.com');
      expect(result.url).toContain('test-app-id');
      delete process.env.FACEBOOK_APP_ID;
      delete process.env.FACEBOOK_LEAD_ADS_REDIRECT_URI;
    });

    it('targets the current Graph API version (v25.0)', () => {
      process.env.FACEBOOK_APP_ID = 'test-app-id';
      const result = service.initFacebookOAuth(mockCaller);
      expect(result.url).toContain('https://www.facebook.com/v25.0/dialog/oauth');
      delete process.env.FACEBOOK_APP_ID;
    });

    it('sends config_id and omits scope when FACEBOOK_CONFIG_ID is set (Login for Business)', () => {
      process.env.FACEBOOK_APP_ID = 'test-app-id';
      process.env.FACEBOOK_CONFIG_ID = 'cfg-123';
      const params = new URL(service.initFacebookOAuth(mockCaller).url).searchParams;
      expect(params.get('config_id')).toBe('cfg-123');
      expect(params.has('scope')).toBe(false);
      delete process.env.FACEBOOK_APP_ID;
      delete process.env.FACEBOOK_CONFIG_ID;
    });

    it('falls back to scope when FACEBOOK_CONFIG_ID is absent', () => {
      process.env.FACEBOOK_APP_ID = 'test-app-id';
      delete process.env.FACEBOOK_CONFIG_ID;
      const params = new URL(service.initFacebookOAuth(mockCaller).url).searchParams;
      expect(params.has('config_id')).toBe(false);
      expect(params.get('scope')).toContain('pages_show_list');
      delete process.env.FACEBOOK_APP_ID;
    });
  });

  describe('initGoogleOAuth', () => {
    it('throws InternalServerErrorException when GOOGLE_ADS_CLIENT_ID is not set', () => {
      const origClientId = process.env.GOOGLE_ADS_CLIENT_ID;
      delete process.env.GOOGLE_ADS_CLIENT_ID;
      expect(() => service.initGoogleOAuth(mockCaller)).toThrow(InternalServerErrorException);
      process.env.GOOGLE_ADS_CLIENT_ID = origClientId;
    });

    it('returns a Google accounts OAuth URL when configured', () => {
      process.env.GOOGLE_ADS_CLIENT_ID = 'test-google-client-id';
      process.env.GOOGLE_ADS_REDIRECT_URI = 'http://localhost:3000/callback';
      const result = service.initGoogleOAuth(mockCaller);
      expect(result.url).toContain('accounts.google.com');
      expect(result.url).toContain('adwords');
      delete process.env.GOOGLE_ADS_CLIENT_ID;
      delete process.env.GOOGLE_ADS_REDIRECT_URI;
    });
  });

  describe('manualBackfillFacebook', () => {
    it('enqueues a backfill scoped to caller.orgId and the connected Page', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accountId: 'page1',
      });
      const since = new Date('2026-08-08T12:49:00Z');

      await service.manualBackfillFacebook(mockCaller, since);

      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.FACEBOOK } },
        }),
      );
      expect(mockLeadBackfill.enqueueBackfill).toHaveBeenCalledWith('org-1', 'page1', since);
    });

    it('throws BadRequestException when Facebook is not connected', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.DISCONNECTED,
        accountId: 'page1',
      });
      await expect(service.manualBackfillFacebook(mockCaller, new Date())).rejects.toThrow(BadRequestException);
      expect(mockLeadBackfill.enqueueBackfill).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when there is no integration on file', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.manualBackfillFacebook(mockCaller, new Date())).rejects.toThrow(BadRequestException);
    });
  });

  describe('disconnect', () => {
    it('sets status to DISCONNECTED and nulls tokens', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      await service.disconnect(IntegrationProvider.FACEBOOK, mockCaller);
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: IntegrationStatus.DISCONNECTED,
            accessToken: null,
            refreshToken: null,
            tokenExpiry: null,
          }),
        }),
      );
    });

    it('scopes upsert to caller.orgId', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      await service.disconnect(IntegrationProvider.GOOGLE_ADS, mockCaller);
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.GOOGLE_ADS } },
        }),
      );
    });

    it('does not clear webhookSecret for non-WhatsApp providers (it is GenXCRM’s own key)', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      await service.disconnect(IntegrationProvider.FACEBOOK, mockCaller);
      const [{ update }] = mockPrisma.orgIntegration.upsert.mock.calls[0];
      expect('webhookSecret' in update).toBe(false);
      expect('metadata' in update).toBe(false);
    });

    it('clears webhookSecret and metadata for WhatsApp (customer app secret + verify token)', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      await service.disconnect(IntegrationProvider.WHATSAPP, mockCaller);
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: IntegrationStatus.DISCONNECTED,
            webhookSecret: null,
            metadata: {},
          }),
        }),
      );
    });

    it('deletes the SES identity when disconnecting a SES_DOMAIN email integration', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        accountId: 'acme.com',
        metadata: { method: 'SES_DOMAIN' },
      });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      await service.disconnect(IntegrationProvider.EMAIL, mockCaller);

      expect(mockSesDeleteIdentity).toHaveBeenCalledWith({ Identity: 'acme.com' });
    });

    it('does not touch SES when disconnecting an SMTP email integration', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        accountId: 'director@acme.com',
        metadata: { method: 'SMTP' },
      });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      await service.disconnect(IntegrationProvider.EMAIL, mockCaller);

      expect(mockSesDeleteIdentity).not.toHaveBeenCalled();
    });

    it('still disconnects when the SES cleanup call fails', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        accountId: 'acme.com',
        metadata: { method: 'SES_DOMAIN' },
      });
      mockSesDeleteIdentity.mockReturnValueOnce({ promise: () => Promise.reject(new Error('AWS unavailable')) });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      await expect(service.disconnect(IntegrationProvider.EMAIL, mockCaller)).resolves.toBeUndefined();
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalled();
    });
  });

  describe('getWebhookInfo', () => {
    it('generates orgWebhookToken if not present', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: null });
      mockPrisma.organization.update.mockResolvedValue({ orgWebhookToken: 'generated-token' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);

      await service.getWebhookInfo(mockCaller);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-1' } }));
    });

    it('returns the full secret so the user can copy it to sign requests', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        webhookSecret: 'abcdef1234567890',
      });

      const result = await service.getWebhookInfo(mockCaller);
      expect(result.webhookSecret).toBe('abcdef1234567890');
    });

    it('returns null secret when none is set', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);

      const result = await service.getWebhookInfo(mockCaller);
      expect(result.webhookSecret).toBeNull();
    });

    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getWebhookInfo(mockCaller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('regenerateWebhookSecret', () => {
    it('upserts a new webhook secret and returns it in full', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.regenerateWebhookSecret(mockCaller);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.WEBHOOK } },
          update: expect.objectContaining({ status: IntegrationStatus.CONNECTED }),
        }),
      );
      // Full 32-byte hex secret (64 chars), not masked — the user must copy it verbatim.
      expect(result.webhookSecret).toHaveLength(64);
      expect(result.webhookSecret).not.toContain('*');
      expect(result.webhookUrl).toContain('tok123');
    });
  });

  describe('getGoogleWebhookInfo', () => {
    it('returns the Google webhook URL and the existing key in full', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'existing-key' });

      const result = await service.getGoogleWebhookInfo(mockCaller);

      expect(result.webhookUrl).toContain('/integrations/google/tok123/webhook');
      expect(result.webhookKey).toBe('existing-key');
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('generates a key on first access when none is set', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: null });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.getGoogleWebhookInfo(mockCaller);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.GOOGLE_ADS } },
        }),
      );
      expect(result.webhookKey).toHaveLength(48);
    });
  });

  describe('regenerateGoogleWebhookKey', () => {
    it('upserts a fresh key and returns it in full', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.regenerateGoogleWebhookKey(mockCaller);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.GOOGLE_ADS } },
          update: expect.objectContaining({ webhookSecret: expect.any(String) }),
        }),
      );
      expect(result.webhookKey).toHaveLength(48);
      expect(result.webhookUrl).toContain('/integrations/google/tok123/webhook');
    });
  });

  describe('handleFacebookCallback', () => {
    beforeEach(() => {
      process.env.FACEBOOK_APP_ID = 'test-app-id';
      process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
    });
    afterEach(() => {
      delete process.env.FACEBOOK_APP_ID;
      delete process.env.FACEBOOK_APP_SECRET;
    });

    it('returns an error result for an invalid state token', async () => {
      const result = await service.handleFacebookCallback('code', 'invalid-state');
      expect(result.kind).toBe('error');
    });

    it('returns an error result when app credentials are not configured', async () => {
      delete process.env.FACEBOOK_APP_SECRET;
      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.handleFacebookCallback('code', state);
      expect(result.kind).toBe('error');
    });

    it('upserts integration record and returns a success result after successful OAuth', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived', expires_in: 7776000 } })
        .mockResolvedValueOnce({ data: { data: [{ id: 'page1', name: 'Test Page', access_token: 'page-token' }] } });
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.handleFacebookCallback('code', state);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalled();
      // A Page can be shared by more than one org (e.g. an agency and its client both admin
      // it) — connecting it for this org must NOT disconnect any other org already on it.
      expect(mockPrisma.orgIntegration.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ kind: 'success', accountName: 'Test Page' }));
    });

    it('returns an error result when Graph API returns no pages', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived' } })
        .mockResolvedValueOnce({ data: { data: [] } });
      mockedAxios.post = jest.fn().mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.handleFacebookCallback('code', state);

      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
      expect(result.kind).toBe('error');
    });

    it('enqueues a lead backfill when reconnecting a Page that was previously DISCONNECTED', async () => {
      const outageStart = new Date('2026-08-01T00:00:00Z');
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.DISCONNECTED,
        disconnectedAt: outageStart,
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived' } })
        .mockResolvedValueOnce({ data: { data: [{ id: 'page1', name: 'Test Page', access_token: 'page-token' }] } });
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      await service.handleFacebookCallback('code', state);

      expect(mockLeadBackfill.enqueueBackfill).toHaveBeenCalledWith('org-1', 'page1', outageStart);
    });

    it('retries the backfill on a second reconnect after the first backfill attempt failed', async () => {
      // Status is already CONNECTED (set by the first reconnect's upsert) but
      // disconnectedAt is still set because the backfill job itself never succeeded
      // (e.g. a missing Graph API permission) — the retry must still fire.
      const outageStart = new Date('2026-08-01T00:00:00Z');
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        disconnectedAt: outageStart,
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived' } })
        .mockResolvedValueOnce({ data: { data: [{ id: 'page1', name: 'Test Page', access_token: 'page-token' }] } });
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      await service.handleFacebookCallback('code', state);

      expect(mockLeadBackfill.enqueueBackfill).toHaveBeenCalledWith('org-1', 'page1', outageStart);
    });

    it('does not clear disconnectedAt in the upsert — only a successful backfill clears it', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.DISCONNECTED,
        disconnectedAt: new Date('2026-08-01T00:00:00Z'),
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived' } })
        .mockResolvedValueOnce({ data: { data: [{ id: 'page1', name: 'Test Page', access_token: 'page-token' }] } });
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      await service.handleFacebookCallback('code', state);

      const updatePayload = mockPrisma.orgIntegration.upsert.mock.calls[0][0].update;
      expect(updatePayload).not.toHaveProperty('disconnectedAt');
    });

    it('does not enqueue a backfill on a first-time connect (no prior integration)', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived' } })
        .mockResolvedValueOnce({ data: { data: [{ id: 'page1', name: 'Test Page', access_token: 'page-token' }] } });
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      await service.handleFacebookCallback('code', state);

      expect(mockLeadBackfill.enqueueBackfill).not.toHaveBeenCalled();
    });

    it('still succeeds when the page leadgen webhook subscription fails', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived' } })
        .mockResolvedValueOnce({ data: { data: [{ id: 'page1', name: 'Page', access_token: 'tok' }] } });
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('subscription failed'));
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.handleFacebookCallback('code', state);
      expect(result).toEqual(expect.objectContaining({ kind: 'success' }));
    });
  });

  describe('handleGoogleCallback', () => {
    beforeEach(() => {
      process.env.GOOGLE_ADS_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_ADS_CLIENT_SECRET = 'test-client-secret';
    });
    afterEach(() => {
      delete process.env.GOOGLE_ADS_CLIENT_ID;
      delete process.env.GOOGLE_ADS_CLIENT_SECRET;
    });

    it('throws InternalServerErrorException when Google credentials not configured', async () => {
      delete process.env.GOOGLE_ADS_CLIENT_SECRET;
      const { url } = service.initGoogleOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      await expect(service.handleGoogleCallback('code', state)).rejects.toThrow(InternalServerErrorException);
    });

    it('upserts GOOGLE_ADS integration and returns redirect URL', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValueOnce({
        data: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 },
      });
      mockedAxios.get = jest.fn().mockResolvedValueOnce({
        data: { resourceNames: ['customers/1234567'] },
      });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });

      const { url } = service.initGoogleOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.handleGoogleCallback('code', state);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.GOOGLE_ADS } },
        }),
      );
      expect(result).toContain('/integrations');
    });

    it('stores integration without accountId when customer list fetch fails', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValueOnce({
        data: { access_token: 'access', expires_in: 3600 },
      });
      mockedAxios.get = jest.fn().mockRejectedValueOnce(new Error('no ads access'));
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'tok123' });

      const { url } = service.initGoogleOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.handleGoogleCallback('code', state);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalled();
      expect(result).toContain('/integrations');
    });
  });

  describe('refreshGoogleToken', () => {
    beforeEach(() => {
      process.env.GOOGLE_ADS_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_ADS_CLIENT_SECRET = 'test-client-secret';
    });
    afterEach(() => {
      delete process.env.GOOGLE_ADS_CLIENT_ID;
      delete process.env.GOOGLE_ADS_CLIENT_SECRET;
    });

    it('fetches a new access token and updates orgIntegration', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValueOnce({
        data: { access_token: 'new-access-token', expires_in: 3600 },
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      const result = await service.refreshGoogleToken('int-1', 'refresh-token');

      expect(mockedAxios.post).toHaveBeenCalled();
      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'int-1' } }),
      );
      expect(result).toBe('new-access-token');
    });

    it('throws InternalServerErrorException when Google credentials not configured', async () => {
      delete process.env.GOOGLE_ADS_CLIENT_ID;
      await expect(service.refreshGoogleToken('int-1', 'refresh')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('listAdAccounts', () => {
    it('throws BadRequestException when no Facebook Page is connected', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.listAdAccounts(mockCaller)).rejects.toThrow(BadRequestException);
    });

    it('scopes the lookup to caller.orgId and decrypts the stored user token', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        adAccountAccessToken: 'enc:user-token',
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { data: [{ id: 'act_1', name: 'Main Account', account_status: 1 }] },
      });

      const result = await service.listAdAccounts(mockCaller);

      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.FACEBOOK } },
        }),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/me/adaccounts'),
        expect.objectContaining({ params: expect.objectContaining({ access_token: 'user-token' }) }),
      );
      expect(result).toEqual([{ id: 'act_1', name: 'Main Account', accountStatus: 1 }]);
    });
  });

  describe('connectAdAccount', () => {
    it('throws BadRequestException when the ad account is not in the caller org account list', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ adAccountAccessToken: 'enc:user-token' });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockResolvedValue({ data: { data: [] } });

      await expect(service.connectAdAccount(mockCaller, 'act_missing')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.update).not.toHaveBeenCalled();
    });

    it('stores the chosen ad account scoped to caller.orgId and enqueues a sync', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ adAccountAccessToken: 'enc:user-token' });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { data: [{ id: 'act_1', name: 'Main Account', account_status: 1 }] },
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      const result = await service.connectAdAccount(mockCaller, 'act_1');

      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.FACEBOOK } },
          data: { adAccountId: 'act_1', adAccountName: 'Main Account' },
        }),
      );
      expect(mockInsights.enqueueSync).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({ adAccountName: 'Main Account' });
    });
  });

  describe('OAuth state CSRF protection', () => {
    it('returns an error result for an invalid state token', async () => {
      const result = await service.handleFacebookCallback('code', 'invalid-state');
      expect(result.kind).toBe('error');
    });

    it('returns an error result when OAuth state has expired', async () => {
      process.env.FACEBOOK_APP_ID = 'test-app-id';
      jest.useFakeTimers();
      const { url } = service.initFacebookOAuth(mockCaller);
      const state = new URL(url).searchParams.get('state')!;
      jest.advanceTimersByTime(11 * 60 * 1000);
      const result = await service.handleFacebookCallback('code', state);
      expect(result.kind).toBe('error');
      jest.useRealTimers();
      delete process.env.FACEBOOK_APP_ID;
    });
  });

  describe('connectWhatsApp', () => {
    const dto = {
      phoneNumberId: '1234567890',
      accessToken: 'wa-token',
      appSecret: 'app-secret',
      businessAccountId: 'waba-1',
    };

    it('validates credentials against Graph API, then stores them encrypted and scoped to orgId', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { display_phone_number: '+91 98765 43210', verified_name: 'Acme Academy' },
      });
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'org-tok-1' });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.connectWhatsApp(mockCaller, dto);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(dto.phoneNumberId),
        expect.objectContaining({ headers: { Authorization: `Bearer ${dto.accessToken}` } }),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(dto.businessAccountId),
        expect.objectContaining({ headers: { Authorization: `Bearer ${dto.accessToken}` } }),
      );
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.WHATSAPP } },
          create: expect.objectContaining({
            orgId: 'org-1',
            accessToken: 'enc:wa-token',
            webhookSecret: 'enc:app-secret',
            accountId: dto.phoneNumberId,
            accountName: 'Acme Academy',
            status: IntegrationStatus.CONNECTED,
            metadata: expect.objectContaining({ businessAccountId: 'enc:waba-1' }),
          }),
        }),
      );
      expect(result.accountName).toBe('Acme Academy');
      expect(result.webhookUrl).toContain('/integrations/whatsapp/org-tok-1/webhook');
      expect(result.verifyToken).toEqual(expect.any(String));
    });

    it('throws BadRequestException and never writes to the DB when Graph API rejects the phone number credentials', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('401'));

      await expect(service.connectWhatsApp(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and never writes to the DB when Graph API rejects the WABA id', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { display_phone_number: '+91 98765 43210', verified_name: 'Acme Academy' } })
        .mockRejectedValueOnce(new Error('400 invalid waba'));

      await expect(service.connectWhatsApp(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getWhatsAppWebhookInfo', () => {
    it('returns the org webhook URL and stored verify token', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'org-tok-1' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ metadata: { verifyToken: 'vtok-1' } });

      const result = await service.getWhatsAppWebhookInfo(mockCaller);

      expect(result).toEqual({
        webhookUrl: expect.stringContaining('/integrations/whatsapp/org-tok-1/webhook'),
        verifyToken: 'vtok-1',
      });
    });
  });

  describe('regenerateWhatsAppVerifyToken', () => {
    it('generates a new verify token and upserts it', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ orgWebhookToken: 'org-tok-1' });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.regenerateWhatsAppVerifyToken(mockCaller);

      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.WHATSAPP } },
        }),
      );
      expect(result.verifyToken).toEqual(expect.any(String));
    });
  });

  describe('connectEmailSmtp', () => {
    const dto = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      username: 'sales@acme.com',
      password: 'app-password',
      fromEmail: 'sales@acme.com',
      fromName: 'Acme Academy',
    };

    it('verifies the SMTP handshake, then stores the encrypted password scoped to caller.orgId', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.connectEmailSmtp(mockCaller, dto);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: dto.host, port: dto.port, secure: dto.secure }),
      );
      expect(mockTransporterVerify).toHaveBeenCalled();
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.EMAIL } },
          create: expect.objectContaining({
            orgId: 'org-1',
            status: IntegrationStatus.CONNECTED,
            accessToken: 'enc:app-password',
            accountId: dto.username,
            accountName: dto.fromName,
            metadata: expect.objectContaining({ method: 'SMTP', host: dto.host }),
          }),
        }),
      );
      expect(result).toEqual({ fromEmail: dto.fromEmail });
    });

    it('throws BadRequestException and never writes to the DB when the SMTP handshake fails', async () => {
      mockTransporterVerify.mockRejectedValueOnce(new Error('auth failed'));

      await expect(service.connectEmailSmtp(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('connectEmailSesDomain', () => {
    const dto = { domain: 'acme.com', fromEmail: 'sales@acme.com', fromName: 'Acme Academy' };

    it('verifies the domain with SES, stores it as PENDING, and returns DNS records', async () => {
      mockSesVerifyDomainIdentity.mockReturnValue({ promise: () => Promise.resolve({ VerificationToken: 'vtoken' }) });
      mockSesVerifyDomainDkim.mockReturnValue({ promise: () => Promise.resolve({ DkimTokens: ['dkim1', 'dkim2', 'dkim3'] }) });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.connectEmailSesDomain(mockCaller, dto);

      expect(mockSesVerifyDomainIdentity).toHaveBeenCalledWith({ Domain: dto.domain });
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.EMAIL } },
          create: expect.objectContaining({
            orgId: 'org-1',
            status: IntegrationStatus.PENDING,
            accountId: dto.domain,
            metadata: expect.objectContaining({ method: 'SES_DOMAIN', domainVerificationToken: 'vtoken' }),
          }),
        }),
      );
      expect(result.domain).toBe(dto.domain);
      expect(result.dnsRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'TXT', name: '_amazonses.acme.com', value: 'vtoken' }),
          expect.objectContaining({ type: 'CNAME', name: 'dkim1._domainkey.acme.com' }),
        ]),
      );
    });

    it('throws BadRequestException and never writes to the DB when SES rejects the domain', async () => {
      mockSesVerifyDomainIdentity.mockReturnValue({ promise: () => Promise.reject(new Error('invalid domain')) });

      await expect(service.connectEmailSesDomain(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('deletes the old SES identity when reconnecting with a different domain', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        accountId: 'old-domain.com',
        metadata: { method: 'SES_DOMAIN' },
      });
      mockSesVerifyDomainIdentity.mockReturnValue({ promise: () => Promise.resolve({ VerificationToken: 'vtoken' }) });
      mockSesVerifyDomainDkim.mockReturnValue({ promise: () => Promise.resolve({ DkimTokens: ['dkim1'] }) });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      await service.connectEmailSesDomain(mockCaller, dto);

      expect(mockSesDeleteIdentity).toHaveBeenCalledWith({ Identity: 'old-domain.com' });
    });

    it('does not delete anything when reconnecting the same domain', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        accountId: dto.domain,
        metadata: { method: 'SES_DOMAIN' },
      });
      mockSesVerifyDomainIdentity.mockReturnValue({ promise: () => Promise.resolve({ VerificationToken: 'vtoken' }) });
      mockSesVerifyDomainDkim.mockReturnValue({ promise: () => Promise.resolve({ DkimTokens: ['dkim1'] }) });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      await service.connectEmailSesDomain(mockCaller, dto);

      expect(mockSesDeleteIdentity).not.toHaveBeenCalled();
    });

    it('does not delete an SES identity when switching over from SMTP', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        accountId: 'director@acme.com',
        metadata: { method: 'SMTP' },
      });
      mockSesVerifyDomainIdentity.mockReturnValue({ promise: () => Promise.resolve({ VerificationToken: 'vtoken' }) });
      mockSesVerifyDomainDkim.mockReturnValue({ promise: () => Promise.resolve({ DkimTokens: ['dkim1'] }) });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      await service.connectEmailSesDomain(mockCaller, dto);

      expect(mockSesDeleteIdentity).not.toHaveBeenCalled();
    });
  });

  describe('checkEmailDomainStatus', () => {
    it('flips PENDING to CONNECTED when SES reports the domain verified', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.PENDING,
        accountId: 'acme.com',
        accountName: 'Acme Academy',
        metadata: { method: 'SES_DOMAIN', fromEmail: 'sales@acme.com' },
      });
      mockSesGetIdentityVerificationAttributes.mockReturnValue({
        promise: () => Promise.resolve({ VerificationAttributes: { 'acme.com': { VerificationStatus: 'Success' } } }),
      });
      mockPrisma.orgIntegration.update.mockResolvedValue({});

      const result = await service.checkEmailDomainStatus(mockCaller);

      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.EMAIL } },
          data: { status: IntegrationStatus.CONNECTED },
        }),
      );
      expect(result.status).toBe(IntegrationStatus.CONNECTED);
    });

    it('stays PENDING when SES has not yet verified the domain', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.PENDING,
        accountId: 'acme.com',
        accountName: 'Acme Academy',
        metadata: { method: 'SES_DOMAIN', fromEmail: 'sales@acme.com' },
      });
      mockSesGetIdentityVerificationAttributes.mockReturnValue({
        promise: () => Promise.resolve({ VerificationAttributes: { 'acme.com': { VerificationStatus: 'Pending' } } }),
      });

      const result = await service.checkEmailDomainStatus(mockCaller);

      expect(mockPrisma.orgIntegration.update).not.toHaveBeenCalled();
      expect(result.status).toBe(IntegrationStatus.PENDING);
    });

    it('throws BadRequestException when no email integration is on file', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.checkEmailDomainStatus(mockCaller)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getEmailConfig', () => {
    it('scopes the lookup to caller.orgId and masks the SMTP username', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accountId: 'sales@acme.com',
        accountName: 'Acme Academy',
        metadata: { method: 'SMTP', host: 'smtp.gmail.com', port: 587, secure: false, fromEmail: 'sales@acme.com' },
      });

      const result = await service.getEmailConfig(mockCaller);

      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.EMAIL } },
        }),
      );
      expect(result.maskedUsername).toBe('****.com');
      expect(result).not.toHaveProperty('password');
    });

    it('returns a disconnected shape when no integration exists', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      const result = await service.getEmailConfig(mockCaller);
      expect(result).toEqual({ method: null, status: IntegrationStatus.DISCONNECTED });
    });
  });

  describe('disconnect (EMAIL)', () => {
    it('clears webhookSecret and metadata for EMAIL (holds the org’s own SMTP/SES config)', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      await service.disconnect(IntegrationProvider.EMAIL, mockCaller);
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: IntegrationStatus.DISCONNECTED,
            webhookSecret: null,
            metadata: {},
          }),
        }),
      );
    });
  });

  describe('connectRazorpay', () => {
    const dto = { keyId: 'rzp_test_abc', keySecret: 'shhh-secret' };

    it('validates credentials against the Razorpay API, then stores them encrypted scoped to caller.orgId', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.connectRazorpay(mockCaller, dto);

      expect(mockRzpPaymentsAll).toHaveBeenCalledWith({ count: 1 });
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.RAZORPAY } },
          create: expect.objectContaining({
            orgId: 'org-1',
            provider: IntegrationProvider.RAZORPAY,
            status: IntegrationStatus.CONNECTED,
            accessToken: 'enc:shhh-secret',
            accountId: dto.keyId,
          }),
        }),
      );
      // webhookSecret is generated by us (see getRazorpayWebhookInfo), not part of connect.
      const [{ create, update }] = mockPrisma.orgIntegration.upsert.mock.calls[0];
      expect('webhookSecret' in create).toBe(false);
      expect('webhookSecret' in update).toBe(false);
      expect(result).toEqual({ keyId: dto.keyId });
    });

    it('throws BadRequestException and never writes to the DB when Razorpay rejects the credentials', async () => {
      mockRzpPaymentsAll.mockRejectedValueOnce(new Error('Authentication failed'));

      await expect(service.connectRazorpay(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('connectCashfree', () => {
    const dto = { appId: 'TEST123', secretKey: 'cf-secret' };
    const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

    beforeEach(() => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.isAxiosError = jest.fn(() => true);
    });

    it('treats a 404 on the probe link as valid credentials and stores them encrypted scoped to caller.orgId', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockRejectedValue(httpError(404));
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.connectCashfree(mockCaller, dto);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://sandbox.cashfree.com/pg/links/genxcrm-credential-check',
        { headers: expect.objectContaining({ 'x-client-id': 'TEST123', 'x-client-secret': 'cf-secret' }) },
      );
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.CASHFREE } },
          create: expect.objectContaining({
            orgId: 'org-1',
            provider: IntegrationProvider.CASHFREE,
            status: IntegrationStatus.CONNECTED,
            accessToken: 'enc:cf-secret',
            accountId: 'TEST123',
          }),
        }),
      );
      expect(result).toEqual({ appId: 'TEST123' });
    });

    it('throws BadRequestException and never writes to the DB when Cashfree rejects the credentials (401)', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockRejectedValue(httpError(401));

      await expect(service.connectCashfree(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('connectTradeIndia', () => {
    it('stores the API Link encrypted as PENDING, scoped to caller.orgId', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      const apiLink = 'https://www.tradeindia.com/api?key=k';
      const result = await service.connectTradeIndia(mockCaller, { apiLink });
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.TRADEINDIA } },
          create: expect.objectContaining({ orgId: 'org-1', status: IntegrationStatus.PENDING, accessToken: `enc:${apiLink}` }),
        }),
      );
      expect(result).toEqual({ saved: true });
    });
  });

  describe('disconnect (RAZORPAY)', () => {
    it('does not clear webhookSecret (it is GenXCRM’s own generated key, not the customer’s)', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});
      await service.disconnect(IntegrationProvider.RAZORPAY, mockCaller);
      const [{ update }] = mockPrisma.orgIntegration.upsert.mock.calls[0];
      expect('webhookSecret' in update).toBe(false);
      expect('metadata' in update).toBe(false);
    });
  });

  describe('getRazorpayWebhookInfo', () => {
    it('returns the static webhook URL and generates a secret on first access', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.getRazorpayWebhookInfo(mockCaller);

      expect(result.webhookUrl).toMatch(/\/payments\/webhook\/RAZORPAY$/);
      expect(result.webhookSecret).toHaveLength(64);
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.RAZORPAY } },
          update: { webhookSecret: result.webhookSecret },
        }),
      );
    });

    it('reuses the existing secret instead of generating a new one', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'existing-rzp-secret' });

      const result = await service.getRazorpayWebhookInfo(mockCaller);

      expect(result.webhookSecret).toBe('existing-rzp-secret');
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('regenerateRazorpayWebhookSecret', () => {
    it('upserts a fresh secret and returns it in full', async () => {
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.regenerateRazorpayWebhookSecret(mockCaller);

      expect(result.webhookUrl).toMatch(/\/payments\/webhook\/RAZORPAY$/);
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.RAZORPAY } },
          update: { webhookSecret: result.webhookSecret },
        }),
      );
    });
  });

  describe('completeWhatsAppEmbeddedSignup', () => {
    const dto = { code: 'auth-code-1', phoneNumberId: 'pn-1', wabaId: 'waba-1' };
    const originalAppId = process.env.FACEBOOK_APP_ID;
    const originalAppSecret = process.env.FACEBOOK_APP_SECRET;

    beforeEach(() => {
      process.env.FACEBOOK_APP_ID = 'app-123';
      process.env.FACEBOOK_APP_SECRET = 'secret-456';
    });
    afterEach(() => {
      process.env.FACEBOOK_APP_ID = originalAppId;
      process.env.FACEBOOK_APP_SECRET = originalAppSecret;
    });

    it('exchanges the code, subscribes the app to the WABA, and upserts the integration', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived-token' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived-token' } })
        .mockResolvedValueOnce({ data: { verified_name: 'Acme Support', display_phone_number: '+1 555 0100' } });
      mockedAxios.post = jest.fn().mockResolvedValue({ data: {} });
      mockPrisma.orgIntegration.upsert.mockResolvedValue({});

      const result = await service.completeWhatsAppEmbeddedSignup(mockCaller, dto);

      expect(result).toEqual({ accountName: 'Acme Support' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/waba-1/subscribed_apps'),
        null,
        expect.objectContaining({ params: expect.objectContaining({ access_token: 'long-lived-token' }) }),
      );
      expect(mockPrisma.orgIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.WHATSAPP } },
          create: expect.objectContaining({
            orgId: 'org-1',
            provider: IntegrationProvider.WHATSAPP,
            status: IntegrationStatus.CONNECTED,
            accountId: 'pn-1',
            accountName: 'Acme Support',
            metadata: expect.objectContaining({ connectMethod: 'EMBEDDED_SIGNUP' }),
          }),
        }),
      );
    });

    it('throws BadRequestException and writes nothing when the code exchange fails', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest.fn().mockRejectedValueOnce(new Error('bad code'));

      await expect(service.completeWhatsAppEmbeddedSignup(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and writes nothing when subscribing to the WABA fails', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { access_token: 'short-lived-token' } })
        .mockResolvedValueOnce({ data: { access_token: 'long-lived-token' } });
      mockedAxios.post = jest.fn().mockRejectedValueOnce(new Error('permission denied'));

      await expect(service.completeWhatsAppEmbeddedSignup(mockCaller, dto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getWhatsAppEmbeddedSignupConfig', () => {
    const originalAppId = process.env.FACEBOOK_APP_ID;
    const originalConfigId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
    afterEach(() => {
      process.env.FACEBOOK_APP_ID = originalAppId;
      process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = originalConfigId;
    });

    it('returns appId and configId when both env vars are set', () => {
      process.env.FACEBOOK_APP_ID = 'app-123';
      process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = 'cfg-456';
      expect(service.getWhatsAppEmbeddedSignupConfig()).toEqual({ appId: 'app-123', configId: 'cfg-456' });
    });

    it('throws when WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID is unset', () => {
      process.env.FACEBOOK_APP_ID = 'app-123';
      delete process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
      expect(() => service.getWhatsAppEmbeddedSignupConfig()).toThrow(InternalServerErrorException);
    });

    it('throws when FACEBOOK_APP_ID is unset', () => {
      delete process.env.FACEBOOK_APP_ID;
      process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = 'cfg-456';
      expect(() => service.getWhatsAppEmbeddedSignupConfig()).toThrow(InternalServerErrorException);
    });
  });
});
