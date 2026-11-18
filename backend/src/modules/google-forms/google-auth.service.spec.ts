import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { IntegrationProvider, IntegrationStatus, Role } from '@prisma/client';
import {
  GOOGLE_FORMS_SCOPE,
  GoogleAccessRevokedError,
  GoogleAuthService,
  GoogleNotConnectedError,
} from './google-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptToken, decryptToken } from '../../common/crypto.utils';
import type { AuthUser } from '../../common/types/auth-user.type';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@t.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const connected = (over: Record<string, unknown> = {}) => ({
  id: 'int-1',
  orgId: 'org-1',
  provider: IntegrationProvider.GOOGLE_FORMS,
  status: IntegrationStatus.CONNECTED,
  accessToken: encryptToken('cached-at'),
  refreshToken: encryptToken('the-refresh'),
  tokenExpiry: new Date(Date.now() + 30 * 60 * 1000),
  accountName: 'owner@x.com',
  ...over,
});

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let prisma: { orgIntegration: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };

  beforeAll(() => {
    process.env.INTEGRATION_SECRET_KEY = 'a'.repeat(64);
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    (axios.isAxiosError as unknown as jest.Mock).mockImplementation((e: unknown) =>
      Boolean((e as { isAxiosError?: boolean } | null)?.isAxiosError),
    );
    process.env.GOOGLE_FORMS_CLIENT_ID = 'cid';
    process.env.GOOGLE_FORMS_CLIENT_SECRET = 'csec';
    process.env.GOOGLE_PICKER_API_KEY = 'api-key';
    process.env.GOOGLE_CLOUD_PROJECT_NUMBER = '1234567';
    process.env.API_URL = 'https://api.example.com/';
    process.env.FRONTEND_URL = 'https://app.example.com/';
    delete process.env.GOOGLE_FORMS_REDIRECT_URI;

    prisma = { orgIntegration: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [GoogleAuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(GoogleAuthService);
  });

  describe('state', () => {
    it('round-trips org and user', () => {
      const state = service.createState('org-1', 'u1');
      expect(service.verifyState(state)).toMatchObject({ orgId: 'org-1', userId: 'u1' });
    });

    it('rejects a tampered, malformed or expired state', () => {
      const state = service.createState('org-1', 'u1', 1_000);
      const [body, sig] = state.split('.');
      const forged = `${Buffer.from(JSON.stringify({ orgId: 'org-2', userId: 'u1', exp: 9e15 })).toString('base64url')}.${sig}`;
      expect(service.verifyState(forged)).toBeNull();
      expect(service.verifyState(`${body}.bad`)).toBeNull();
      expect(service.verifyState('nonsense')).toBeNull();
      expect(service.verifyState(state, 1_000 + 11 * 60 * 1000)).toBeNull();
    });
  });

  describe('state signature', () => {
    it('rejects a same-length but different signature without throwing', () => {
      const [body, sig] = service.createState('org-1', 'u1').split('.');
      const flipped = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
      expect(flipped).toHaveLength(sig.length);
      expect(service.verifyState(`${body}.${flipped}`)).toBeNull();
    });
  });

  describe('initConnection', () => {
    it('builds a Google consent URL with only the drive.file scope, offline access and a signed state', () => {
      const { url } = service.initConnection(caller);
      const params = new URL(url).searchParams;
      expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
      expect(params.get('scope')).toBe(GOOGLE_FORMS_SCOPE);
      expect(params.get('access_type')).toBe('offline');
      expect(params.get('prompt')).toBe('consent');
      expect(params.get('client_id')).toBe('cid');
      expect(params.get('redirect_uri')).toBe(
        'https://app.example.com/integrations/google-forms/callback',
      );
      expect(service.verifyState(params.get('state') ?? '')).toMatchObject({ orgId: 'org-1', userId: 'u1' });
    });

    it('throws when the Google credentials are not configured', () => {
      delete process.env.GOOGLE_FORMS_CLIENT_ID;
      expect(() => service.initConnection(caller)).toThrow(InternalServerErrorException);
    });
  });

  describe('completeConnection', () => {
    const tokens = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 };
    const okState = () => service.createState('org-1', 'u1');

    it('stores encrypted tokens and returns the account name', async () => {
      mockedAxios.post.mockResolvedValue({ data: tokens });
      mockedAxios.get.mockResolvedValue({ data: { user: { emailAddress: 'owner@x.com' } } });
      prisma.orgIntegration.findUnique.mockResolvedValue(null);

      await expect(service.completeConnection(caller, 'the-code', okState())).resolves.toEqual({
        accountName: 'owner@x.com',
      });
      const args = prisma.orgIntegration.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.GOOGLE_FORMS } });
      expect(args.create).toMatchObject({ status: IntegrationStatus.CONNECTED, accountName: 'owner@x.com' });
      expect(args.create.accessToken).not.toBe('at-1');
      expect(decryptToken(args.create.accessToken)).toBe('at-1');
      expect(decryptToken(args.create.refreshToken)).toBe('rt-1');
      expect(args.update.disconnectedAt).toBeNull();
    });

    it('passes a timeout on the token exchange and the account-name call', async () => {
      mockedAxios.post.mockResolvedValue({ data: tokens });
      mockedAxios.get.mockResolvedValue({ data: { user: { emailAddress: 'owner@x.com' } } });
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      await service.completeConnection(caller, 'the-code', okState());
      expect(mockedAxios.post.mock.calls[0][2]).toMatchObject({ timeout: 15000 });
      expect(mockedAxios.get.mock.calls[0][1]).toMatchObject({ timeout: 15000 });
    });

    it('still connects when the account email cannot be read', async () => {
      mockedAxios.post.mockResolvedValue({ data: tokens });
      mockedAxios.get.mockRejectedValue(new Error('403'));
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.completeConnection(caller, 'c', okState())).resolves.toEqual({ accountName: null });
    });

    it('rejects a state issued for a different user with no Google call and no write', async () => {
      await expect(
        service.completeConnection(caller, 'c', service.createState('org-1', 'someone-else')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(prisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects a state issued for a different org', async () => {
      await expect(
        service.completeConnection(caller, 'c', service.createState('org-2', 'u1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects a caller without an org', async () => {
      await expect(
        service.completeConnection({ ...caller, orgId: null } as unknown as AuthUser, 'c', okState()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects expired, tampered and missing state with 400 and no Google call', async () => {
      const expired = service.createState('org-1', 'u1', 1_000);
      const tampered = `${okState().split('.')[0]}.bad`;
      for (const st of [expired, tampered, undefined]) {
        await expect(service.completeConnection(caller, 'c', st)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects a missing code', async () => {
      await expect(service.completeConnection(caller, undefined, okState())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('maps a token exchange failure to a safe message without leaking code or tokens', async () => {
      mockedAxios.post.mockRejectedValue(new Error('secret-body the-code'));
      const err = await service.completeConnection(caller, 'the-code', okState()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const message = JSON.stringify((err as BadRequestException).getResponse());
      expect(message).toContain('complete the Google connection');
      expect(message).not.toContain('the-code');
      expect(message).not.toContain('secret-body');
      expect(prisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('refuses to persist when Google grants no refresh token on first connect', async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'at-1', expires_in: 3600 } });
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.completeConnection(caller, 'c', okState())).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.orgIntegration.upsert).not.toHaveBeenCalled();
    });

    it('keeps the stored refresh token on re-consent without a new one', async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'at-2', expires_in: 3600 } });
      mockedAxios.get.mockRejectedValue(new Error('x'));
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      await service.completeConnection(caller, 'c', okState());
      const args = prisma.orgIntegration.upsert.mock.calls[0][0];
      expect(decryptToken(args.create.accessToken)).toBe('at-2');
      expect(args.update).not.toHaveProperty('refreshToken');
    });

    it('uses the same redirect URI in the consent URL and the exchange, honoring the override', async () => {
      mockedAxios.post.mockResolvedValue({ data: tokens });
      mockedAxios.get.mockRejectedValue(new Error('x'));
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      const check = async (expected: string) => {
        const consent = new URL(service.initConnection(caller).url).searchParams.get('redirect_uri');
        mockedAxios.post.mockClear();
        await service.completeConnection(caller, 'c', okState());
        const body = new URLSearchParams(mockedAxios.post.mock.calls[0][1] as string);
        expect(consent).toBe(expected);
        expect(body.get('redirect_uri')).toBe(expected);
      };
      await check('https://app.example.com/integrations/google-forms/callback');
      process.env.GOOGLE_FORMS_REDIRECT_URI = 'https://override.example.com/cb';
      await check('https://override.example.com/cb');
    });
  });

  describe('getAccessToken', () => {
    it('throws when the org is not connected', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.getAccessToken('org-1')).rejects.toBeInstanceOf(GoogleNotConnectedError);
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ status: IntegrationStatus.DISCONNECTED }));
      await expect(service.getAccessToken('org-1')).rejects.toBeInstanceOf(GoogleNotConnectedError);
    });

    it('returns the stored token while it is still valid', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      await expect(service.getAccessToken('org-1')).resolves.toBe('cached-at');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('refreshes an expiring token and stores the new one encrypted', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ tokenExpiry: new Date(Date.now() + 10_000) }));
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'new-at', expires_in: 3600 } });
      await expect(service.getAccessToken('org-1')).resolves.toBe('new-at');
      const data = prisma.orgIntegration.update.mock.calls[0][0].data;
      expect(decryptToken(data.accessToken)).toBe('new-at');
    });

    it('marks the integration ERROR and throws when Google says invalid_grant', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ tokenExpiry: new Date(Date.now() - 1000) }));
      mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { data: { error: 'invalid_grant' } } });
      await expect(service.getAccessToken('org-1')).rejects.toBeInstanceOf(GoogleAccessRevokedError);
      expect(prisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: IntegrationStatus.ERROR,
            accessToken: null,
            disconnectedAt: expect.any(Date),
          }),
        }),
      );
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ status: IntegrationStatus.ERROR }));
      await expect(service.getAccessToken('org-1')).rejects.toBeInstanceOf(GoogleAccessRevokedError);
    });

    it('maps a network failure to ServiceUnavailableException and does not mark ERROR', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ tokenExpiry: new Date(Date.now() - 1000) }));
      mockedAxios.post.mockRejectedValue(new Error('network'));
      await expect(service.getAccessToken('org-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.orgIntegration.update).not.toHaveBeenCalled();
    });

    it('passes a timeout on the refresh call', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ tokenExpiry: new Date(Date.now() + 10_000) }));
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'new-at', expires_in: 3600 } });
      await service.getAccessToken('org-1');
      expect(mockedAxios.post.mock.calls[0][2]).toMatchObject({ timeout: 15000 });
    });

    it('maps an undecryptable stored token to GoogleAccessRevokedError', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected({ accessToken: 'garbage' }));
      await expect(service.getAccessToken('org-1')).rejects.toBeInstanceOf(GoogleAccessRevokedError);
    });
  });

  describe('getPickerConfig', () => {
    it('returns a short-lived access token with the picker key and app id — never the refresh token', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      const config = await service.getPickerConfig(caller);
      expect(config).toMatchObject({ accessToken: 'cached-at', apiKey: 'api-key', appId: '1234567' });
      expect(JSON.stringify(config)).not.toContain('the-refresh');
    });

    it('throws when the picker key or app id is not configured', async () => {
      delete process.env.GOOGLE_PICKER_API_KEY;
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      await expect(service.getPickerConfig(caller)).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('getConnection', () => {
    it('reports DISCONNECTED and configured when there is no row', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.getConnection(caller)).resolves.toEqual({
        status: IntegrationStatus.DISCONNECTED,
        accountName: null,
        configured: true,
      });
    });

    it.each([
      'GOOGLE_FORMS_CLIENT_ID',
      'GOOGLE_FORMS_CLIENT_SECRET',
      'GOOGLE_PICKER_API_KEY',
      'GOOGLE_CLOUD_PROJECT_NUMBER',
    ])('reports configured=false when %s is missing', async (name) => {
      delete process.env[name];
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      expect((await service.getConnection(caller)).configured).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('revokes the refresh token at Google and clears local tokens', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      mockedAxios.post.mockResolvedValue({ data: {} });
      await service.disconnect(caller);
      expect(mockedAxios.post.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke');
      expect(prisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.GOOGLE_FORMS } },
          data: expect.objectContaining({ status: IntegrationStatus.DISCONNECTED, accessToken: null, refreshToken: null }),
        }),
      );
    });

    it('passes a timeout on the revoke call', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      mockedAxios.post.mockResolvedValue({ data: {} });
      await service.disconnect(caller);
      expect(mockedAxios.post.mock.calls[0][2]).toMatchObject({ timeout: 15000 });
    });

    it('still disconnects locally when the revoke call fails', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(connected());
      mockedAxios.post.mockRejectedValue(new Error('network'));
      await expect(service.disconnect(caller)).resolves.toBeUndefined();
      expect(prisma.orgIntegration.update).toHaveBeenCalled();
    });

    it('does nothing when the org never connected', async () => {
      prisma.orgIntegration.findUnique.mockResolvedValue(null);
      await service.disconnect(caller);
      expect(prisma.orgIntegration.update).not.toHaveBeenCalled();
    });
  });
});
