import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { IntegrationProvider, IntegrationStatus, type OrgIntegration } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptToken, encryptToken } from '../../common/crypto.utils';
import { ErrorMessages } from '../../common/constants/messages';
import type { AuthUser } from '../../common/types/auth-user.type';

export const GOOGLE_FORMS_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about';
const STATE_TTL_MS = 10 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000;
const FORM_ENCODED = { 'Content-Type': 'application/x-www-form-urlencoded' };
// One hung Google endpoint must not wedge the shared sync loop.
const GOOGLE_REQUEST_TIMEOUT_MS = 15000;

export class GoogleNotConnectedError extends ForbiddenException {
  constructor() {
    super(ErrorMessages.googleForms.notConnected);
  }
}

export class GoogleAccessRevokedError extends ForbiddenException {
  constructor() {
    super(ErrorMessages.googleForms.reconnectNeeded);
  }
}

interface StatePayload {
  orgId: string;
  userId: string;
  exp: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  private credentials(): { clientId: string; clientSecret: string; redirectUri: string } {
    const clientId = process.env.GOOGLE_FORMS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_FORMS_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new InternalServerErrorException(ErrorMessages.googleForms.notConfigured);
    const frontend = process.env.FRONTEND_URL?.replace(/\/+$/, '');
    const redirectUri =
      process.env.GOOGLE_FORMS_REDIRECT_URI ?? (frontend ? `${frontend}/integrations/google-forms/callback` : undefined);
    if (!redirectUri) throw new InternalServerErrorException(ErrorMessages.googleForms.notConfigured);
    return { clientId, clientSecret, redirectUri };
  }

  private sign(data: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new InternalServerErrorException(ErrorMessages.googleForms.notConfigured);
    return crypto.createHmac('sha256', secret).update(data).digest('base64url');
  }

  createState(orgId: string, userId: string, now: number = Date.now()): string {
    const body = Buffer.from(JSON.stringify({ orgId, userId, exp: now + STATE_TTL_MS } satisfies StatePayload)).toString(
      'base64url',
    );
    return `${body}.${this.sign(body)}`;
  }

  verifyState(state: string, now: number = Date.now()): StatePayload | null {
    const [body, signature] = state.split('.');
    if (!body || !signature) return null;
    const provided = Buffer.from(signature);
    const expected = Buffer.from(this.sign(body));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
      return payload.exp > now ? payload : null;
    } catch {
      return null;
    }
  }

  private requireOrg(caller: AuthUser): string {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.googleForms.noOrg);
    return caller.orgId;
  }

  initConnection(caller: AuthUser): { url: string } {
    const orgId = this.requireOrg(caller);
    const { clientId, redirectUri } = this.credentials();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_FORMS_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: this.createState(orgId, caller.id),
    });
    return { url: `${AUTH_URL}?${params.toString()}` };
  }

  // Authenticated completion step: the frontend callback route posts code+state here, so the
  // redemption is bound to the same org and user that started the flow.
  async completeConnection(
    caller: AuthUser,
    code: string | undefined,
    state: string | undefined,
  ): Promise<{ accountName: string | null }> {
    const orgId = this.requireOrg(caller);
    const payload = state ? this.verifyState(state) : null;
    if (!payload) throw new BadRequestException(ErrorMessages.googleForms.oauthStateInvalid);
    if (payload.orgId !== orgId || payload.userId !== caller.id) {
      throw new ForbiddenException(ErrorMessages.googleForms.oauthStateInvalid);
    }
    if (!code) throw new BadRequestException(ErrorMessages.googleForms.oauthCodeMissing);

    const { clientId, clientSecret, redirectUri } = this.credentials();
    let tokens: TokenResponse;
    try {
      const res = await axios.post<TokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: FORM_ENCODED, timeout: GOOGLE_REQUEST_TIMEOUT_MS },
      );
      tokens = res.data;
    } catch (err) {
      this.logger.error(`Google token exchange failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      throw new BadRequestException(ErrorMessages.googleForms.oauthExchangeFailed);
    }

    // A row in ERROR may keep its stored refresh token here: prompt: 'consent' makes Google return a fresh one.
    const existing = await this.loadIntegration(orgId);
    if (!tokens.refresh_token && !existing?.refreshToken) {
      throw new BadRequestException(ErrorMessages.googleForms.noRefreshToken);
    }
    const accountName = await this.fetchAccountEmail(tokens.access_token);
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);
    const accessToken = encryptToken(tokens.access_token);
    const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined;

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_FORMS } },
      create: {
        orgId,
        provider: IntegrationProvider.GOOGLE_FORMS,
        status: IntegrationStatus.CONNECTED,
        accessToken,
        refreshToken,
        tokenExpiry,
        accountName,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken,
        ...(refreshToken && { refreshToken }),
        tokenExpiry,
        accountName,
        disconnectedAt: null,
      },
    });
    return { accountName };
  }

  // Best effort: drive.file allows Drive `about`, but never fail the connection over a display name.
  private async fetchAccountEmail(accessToken: string): Promise<string | null> {
    try {
      const { data } = await axios.get<{ user?: { emailAddress?: string } }>(ABOUT_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'user(emailAddress)' },
        timeout: GOOGLE_REQUEST_TIMEOUT_MS,
      });
      return data.user?.emailAddress ?? null;
    } catch {
      return null;
    }
  }

  private async loadIntegration(orgId: string): Promise<OrgIntegration | null> {
    return this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_FORMS } },
    });
  }

  async getAccessTokenWithExpiry(orgId: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const integration = await this.loadIntegration(orgId);
    if (integration?.status === IntegrationStatus.ERROR) throw new GoogleAccessRevokedError();
    if (!integration || integration.status !== IntegrationStatus.CONNECTED || !integration.refreshToken) {
      throw new GoogleNotConnectedError();
    }
    let refreshToken: string;
    try {
      if (
        integration.accessToken &&
        integration.tokenExpiry &&
        integration.tokenExpiry.getTime() - Date.now() > EXPIRY_MARGIN_MS
      ) {
        return { accessToken: decryptToken(integration.accessToken), expiresAt: integration.tokenExpiry };
      }
      refreshToken = decryptToken(integration.refreshToken);
    } catch {
      throw new GoogleAccessRevokedError();
    }
    return this.refresh(integration.id, refreshToken);
  }

  async getAccessToken(orgId: string): Promise<string> {
    return (await this.getAccessTokenWithExpiry(orgId)).accessToken;
  }

  private async refresh(integrationId: string, refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const { clientId, clientSecret } = this.credentials();
    try {
      const { data } = await axios.post<TokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        { headers: FORM_ENCODED, timeout: GOOGLE_REQUEST_TIMEOUT_MS },
      );
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);
      await this.prisma.orgIntegration.update({
        where: { id: integrationId },
        data: { accessToken: encryptToken(data.access_token), tokenExpiry: expiresAt },
      });
      return { accessToken: data.access_token, expiresAt };
    } catch (err) {
      const reason = axios.isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined;
      if (reason === 'invalid_grant') {
        await this.prisma.orgIntegration.update({
          where: { id: integrationId },
          data: { status: IntegrationStatus.ERROR, accessToken: null, disconnectedAt: new Date() },
        });
        throw new GoogleAccessRevokedError();
      }
      this.logger.warn(`Google token refresh failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      throw new ServiceUnavailableException(ErrorMessages.googleForms.googleUnavailable);
    }
  }

  async getPickerConfig(
    caller: AuthUser,
  ): Promise<{ accessToken: string; expiresAt: string; apiKey: string; appId: string }> {
    const orgId = this.requireOrg(caller);
    const apiKey = process.env.GOOGLE_PICKER_API_KEY;
    const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    if (!apiKey || !appId) throw new InternalServerErrorException(ErrorMessages.googleForms.notConfigured);
    const { accessToken, expiresAt } = await this.getAccessTokenWithExpiry(orgId);
    return { accessToken, expiresAt: expiresAt.toISOString(), apiKey, appId };
  }

  async getConnection(
    caller: AuthUser,
  ): Promise<{ status: IntegrationStatus; accountName: string | null; configured: boolean }> {
    const orgId = this.requireOrg(caller);
    const integration = await this.loadIntegration(orgId);
    return {
      status: integration?.status ?? IntegrationStatus.DISCONNECTED,
      accountName: integration?.accountName ?? null,
      configured: Boolean(
        process.env.GOOGLE_FORMS_CLIENT_ID &&
          process.env.GOOGLE_FORMS_CLIENT_SECRET &&
          process.env.GOOGLE_PICKER_API_KEY &&
          process.env.GOOGLE_CLOUD_PROJECT_NUMBER,
      ),
    };
  }

  async disconnect(caller: AuthUser): Promise<void> {
    const orgId = this.requireOrg(caller);
    const integration = await this.loadIntegration(orgId);
    if (!integration) return;
    if (integration.refreshToken) {
      try {
        await axios.post(REVOKE_URL, new URLSearchParams({ token: decryptToken(integration.refreshToken) }).toString(), {
          headers: FORM_ENCODED,
          timeout: GOOGLE_REQUEST_TIMEOUT_MS,
        });
      } catch (err) {
        this.logger.warn(`Could not revoke Google token for org ${orgId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    await this.prisma.orgIntegration.update({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_FORMS } },
      data: { status: IntegrationStatus.DISCONNECTED, accessToken: null, refreshToken: null, disconnectedAt: new Date() },
    });
  }
}
