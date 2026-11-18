import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';
import * as AWS from 'aws-sdk';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptToken, decryptToken } from '../../common/crypto.utils';
import { IntegrationProvider, IntegrationStatus, type OrgIntegration } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { FacebookOAuthResult } from './oauth-popup.template';
import { ErrorMessages } from '../../common/constants/messages';
import { FB_GRAPH_VERSION } from '../../common/constants/facebook.constants';
import { FacebookInsightsService } from '../facebook-insights/facebook-insights.service';
import { FacebookLeadBackfillService } from '../facebook-lead-backfill/facebook-lead-backfill.service';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { CompleteWhatsAppEmbeddedSignupDto } from './dto/complete-whatsapp-embedded-signup.dto';
import { ConnectEmailSmtpDto } from './dto/connect-email-smtp.dto';
import { ConnectEmailSesDomainDto } from './dto/connect-email-ses-domain.dto';
import { ConnectRazorpayDto } from './dto/connect-razorpay.dto';
import { ConnectCashfreeDto } from './dto/connect-cashfree.dto';
import { ConnectTradeIndiaDto } from './dto/connect-tradeindia.dto';
import { cashfreeBaseUrl, cashfreeHeaders } from '../../common/utils/cashfree.util';
import Razorpay from 'razorpay';

interface OAuthState {
  orgId: string;
  expiresAt: number;
}

type FbPage = { id: string; name: string; access_token: string };

interface PendingSelection {
  orgId: string;
  pages: FbPage[];
  userAccessToken: string;
  expiresAt: number;
}

export interface IntegrationStatusDto {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountName?: string | null;
  maskedAccountId?: string | null;
  tokenExpiry?: Date | null;
  adAccountName?: string | null;
  lastSyncedAt?: Date | null;
  lastBackfillAt?: Date | null;
  lastBackfillLeadsCount?: number | null;
  connectMethod?: string | null;
}

export interface FacebookAdAccountDto {
  id: string;
  name: string;
  accountStatus: number;
}

export interface WebhookInfoDto {
  webhookUrl: string;
  // The full HMAC secret — the caller must copy it verbatim to sign requests. Shown
  // behind the same RBAC guard as the rest of the integration config; masking happens
  // client-side. Null until a secret has been generated.
  webhookSecret: string | null;
}

export interface GoogleWebhookInfoDto {
  // The URL to paste into Google Ads → Lead form → Webhook integration.
  webhookUrl: string;
  // The "Webhook key" to paste alongside it. Shown in full (not masked): the user must
  // copy it verbatim into Google Ads, and it is the org's own secret behind an RBAC guard.
  webhookKey: string;
}

export interface WhatsAppWebhookInfoDto {
  webhookUrl: string;
  verifyToken: string;
}

export interface DnsRecordDto {
  type: string;
  name: string;
  value: string;
}

export interface EmailConfigDto {
  method: 'SMTP' | 'SES_DOMAIN' | null;
  status: IntegrationStatus;
  fromEmail?: string | null;
  fromName?: string | null;
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  maskedUsername?: string | null;
  domain?: string | null;
  dnsRecords?: DnsRecordDto[];
}

@Injectable()
export class IntegrationsConfigService {
  private readonly logger = new Logger(IntegrationsConfigService.name);
  private readonly oauthStates = new Map<string, OAuthState>();
  // Short-lived store of the Pages a freshly-authorized user can pick from.
  private readonly pendingSelections = new Map<string, PendingSelection>();
  private readonly ses: AWS.SES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: FacebookInsightsService,
    private readonly leadBackfill: FacebookLeadBackfillService,
  ) {
    this.ses = new AWS.SES({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  }

  async getStatuses(caller: AuthUser): Promise<IntegrationStatusDto[]> {
    const records = await this.prisma.orgIntegration.findMany({
      where: { orgId: caller.orgId! },
    });
    return records.map(({ provider, status, accountName, accountId, tokenExpiry, adAccountName, lastSyncedAt, metadata }) => {
      const meta = metadata as
        | { lastBackfill?: { at?: string; leadsProcessed?: number }; connectMethod?: string }
        | null;
      return {
        provider,
        status,
        accountName,
        maskedAccountId: accountId ? `****${accountId.slice(-4)}` : null,
        tokenExpiry,
        adAccountName,
        lastSyncedAt,
        lastBackfillAt: meta?.lastBackfill?.at ? new Date(meta.lastBackfill.at) : null,
        lastBackfillLeadsCount: meta?.lastBackfill?.leadsProcessed ?? null,
        connectMethod: meta?.connectMethod ?? null,
      };
    });
  }

  initFacebookOAuth(caller: AuthUser): { url: string } {
    if (!process.env.FACEBOOK_APP_ID) {
      throw new InternalServerErrorException(ErrorMessages.integrations.facebookNotConfigured);
    }
    const state = this.createOAuthState(caller.orgId!);
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID,
      redirect_uri:
        process.env.FACEBOOK_LEAD_ADS_REDIRECT_URI ??
        `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/integrations/config/facebook/oauth/callback`,
      response_type: 'code',
      state,
    });
    // We use Facebook Login for Business: permissions AND the Page (asset) selection come from the
    // dashboard configuration (docs/FACEBOOK_BUSINESS_SETUP.md Part 4.3), so we send `config_id` and
    // must NOT send `scope` — sending both makes Meta drop to a basic dialog that skips Page
    // selection, leaving the token with no Pages and `me/accounts` empty. A newly-created Business
    // app cannot switch to classic Facebook Login, so config_id (and its "Choose the Pages…" asset
    // screen) is the expected, supported flow here. `scope` is the local/dev fallback only.
    if (process.env.FACEBOOK_CONFIG_ID) {
      params.set('config_id', process.env.FACEBOOK_CONFIG_ID);
    } else {
      params.set(
        'scope',
        process.env.FACEBOOK_OAUTH_SCOPES ??
          'public_profile,pages_show_list,leads_retrieval,pages_read_engagement,pages_manage_metadata,business_management',
      );
    }
    return { url: `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth?${params.toString()}` };
  }

  /**
   * Handle Facebook's OAuth redirect. Returns a result the popup renders:
   *   - 0 pages              → error
   *   - exactly 1 page       → connected immediately (success)
   *   - 2+ pages             → stash & ask the user to pick one (select)
   *
   * NOTE: an org can hold one Facebook Page (unique orgId_provider), so multi-page
   * accounts MUST choose. The old code looped every page into the same row, so only
   * the last page in Meta's list ever survived — silently connecting the wrong Page.
   */
  async handleFacebookCallback(code: string, stateToken: string): Promise<FacebookOAuthResult> {
    let orgId: string;
    try {
      orgId = this.consumeOAuthState(stateToken);
    } catch {
      return { kind: 'error', message: 'This authorization link expired. Please start the connection again.' };
    }

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri =
      process.env.FACEBOOK_LEAD_ADS_REDIRECT_URI ??
      `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/integrations/config/facebook/oauth/callback`;

    if (!appId || !appSecret) {
      return { kind: 'error', message: 'Facebook is not configured on the server.' };
    }
    if (!code) {
      return { kind: 'error', message: 'Facebook did not return an authorization code. Please try again.' };
    }

    try {
      // Exchange code for a short-lived user token …
      const { data: shortLived } = await axios.get<{ access_token: string }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`,
        { params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code } },
      );

      // … then a long-lived one.
      const { data: longLived } = await axios.get<{ access_token: string; expires_in?: number }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLived.access_token,
          },
        },
      );

      // Pages the user manages (each carries its own permanent token).
      const { data: pagesData } = await axios.get<{ data: FbPage[] }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`,
        { params: { access_token: longLived.access_token } },
      );
      const pages = pagesData.data ?? [];

      if (pages.length === 0) {
        this.logger.warn(`Facebook OAuth: no pages found for orgId=${orgId}`);
        return {
          kind: 'error',
          message:
            'No Facebook Pages were found on this account. Make sure you grant access to your Page during login, then try again.',
        };
      }

      if (pages.length === 1) {
        await this.connectPage(orgId, pages[0], longLived.access_token);
        return { kind: 'success', accountName: pages[0].name };
      }

      // Multiple pages → let the user choose exactly one.
      const selectionToken = crypto.randomUUID();
      this.pendingSelections.set(selectionToken, {
        orgId,
        pages,
        userAccessToken: longLived.access_token,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      for (const [key, val] of this.pendingSelections) {
        if (val.expiresAt < Date.now()) this.pendingSelections.delete(key);
      }
      return {
        kind: 'select',
        selectionToken,
        pages: pages.map((p) => ({ id: p.id, name: p.name })),
      };
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.error('Facebook OAuth callback failed', err.response?.data ?? err.message);
      }
      return { kind: 'error', message: 'Something went wrong while talking to Facebook. Please try again.' };
    }
  }

  /** Finalize a multi-page connection: the user picked `pageId`. */
  async connectFacebookPage(selectionToken: string, pageId: string): Promise<{ accountName: string }> {
    const pending = this.pendingSelections.get(selectionToken);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingSelections.delete(selectionToken);
      throw new BadRequestException(ErrorMessages.integrations.facebookSelectionExpired);
    }
    const page = pending.pages.find((p) => p.id === pageId);
    if (!page) throw new BadRequestException(ErrorMessages.integrations.facebookPageUnavailable);

    await this.connectPage(pending.orgId, page, pending.userAccessToken);
    this.pendingSelections.delete(selectionToken);
    return { accountName: page.name };
  }

  /** Upsert the chosen Page as the org's Facebook integration + subscribe it to leadgen. */
  private async connectPage(orgId: string, page: FbPage, userAccessToken: string): Promise<void> {
    // A Facebook Page can be connected by more than one org at once (e.g. an agency and its
    // client both admin the same Page) — FacebookService.processEntry fans leadgen events out
    // to every org connected to a given page_id, so connecting here must not disturb any other
    // org's existing connection to the same page.

    // Read the prior state before the upsert overwrites it — a Page that was previously
    // CONNECTED and later fell to DISCONNECTED/ERROR left a `disconnectedAt` timestamp
    // marking when leadgen webhooks stopped being trusted. If this connect is a
    // reconnect (not a first-time connect), that gap needs backfilling below.
    const priorIntegration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
    });

    // The long-lived USER token (distinct from the Page token above) is kept so a
    // Director/Manager can later list + connect an ad account for Marketing API
    // Insights sync (see facebook-insights module) without re-authenticating.
    //
    // Deliberately NOT clearing disconnectedAt here: it's the only record of the
    // outage window, and the backfill job (queued below) is what actually resolves
    // it — only on success (see FacebookLeadBackfillService.runBackfill). If the
    // backfill fails (e.g. a missing Graph API permission) and the user reconnects
    // again before that's fixed, the original outage start must still be there for
    // the retry to backfill the full gap, not just since the last click.
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
      create: {
        orgId,
        provider: IntegrationProvider.FACEBOOK,
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(page.access_token),
        accountId: page.id,
        accountName: page.name,
        adAccountAccessToken: encryptToken(userAccessToken),
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(page.access_token),
        accountId: page.id,
        accountName: page.name,
        adAccountAccessToken: encryptToken(userAccessToken),
      },
    });

    // Keyed on disconnectedAt alone (not status !== CONNECTED) — status is already
    // CONNECTED again by the time this check runs, and a prior backfill attempt may
    // have failed without clearing disconnectedAt. As long as it's set, there's an
    // unresolved gap to retry.
    if (priorIntegration?.disconnectedAt) {
      void this.leadBackfill
        .enqueueBackfill(orgId, page.id, priorIntegration.disconnectedAt)
        .catch((err) => this.logger.error(`Failed to enqueue Facebook lead backfill for orgId=${orgId}: ${err}`));
    }

    try {
      await axios.post(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${page.id}/subscribed_apps`, null, {
        params: { access_token: page.access_token, subscribed_fields: 'leadgen' },
      });
      this.logger.log(`Subscribed FB page ${page.id} to leadgen webhook`);
    } catch (err) {
      this.logger.warn(
        `Failed to subscribe page ${page.id} to leadgen: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Same one-click experience as Page connect: if the user manages exactly one ad
    // account, connect it automatically so most orgs never see a picker at all. With
    // 0 or 2+ accounts, the Integrations page shows an inline picker instead.
    try {
      const accounts = await this.fetchAdAccounts(userAccessToken);
      if (accounts.length === 1) {
        await this.prisma.orgIntegration.update({
          where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
          data: { adAccountId: accounts[0].id, adAccountName: accounts[0].name },
        });
        void this.insights.enqueueSync(orgId);
        this.logger.log(`Auto-connected sole FB ad account ${accounts[0].id} for orgId=${orgId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Could not list Facebook ad accounts for orgId=${orgId}: ${this.graphErrorDetail(err)}`,
      );
    }
  }

  /** List the Facebook ad accounts the connected Page's user can access. */
  async listAdAccounts(caller: AuthUser): Promise<FacebookAdAccountDto[]> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId: caller.orgId!, provider: IntegrationProvider.FACEBOOK } },
    });
    if (!integration?.adAccountAccessToken) {
      throw new BadRequestException(ErrorMessages.integrations.facebookPageNotConnected);
    }

    const userAccessToken = decryptToken(integration.adAccountAccessToken);
    try {
      return await this.fetchAdAccounts(userAccessToken);
    } catch (err) {
      this.logger.error(`Failed to list Facebook ad accounts for orgId=${caller.orgId}: ${this.graphErrorDetail(err)}`);
      throw new BadRequestException(ErrorMessages.integrations.facebookAdAccountsListFailed);
    }
  }

  private async fetchAdAccounts(userAccessToken: string): Promise<FacebookAdAccountDto[]> {
    const { data } = await axios.get<{ data: { id: string; name: string; account_status: number }[] }>(
      `https://graph.facebook.com/${FB_GRAPH_VERSION}/me/adaccounts`,
      { params: { access_token: userAccessToken, fields: 'id,name,account_status' } },
    );
    return (data.data ?? []).map((a) => ({ id: a.id, name: a.name, accountStatus: a.account_status }));
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

  /** Connect the chosen ad account and enqueue a sync. */
  async connectAdAccount(caller: AuthUser, adAccountId: string): Promise<{ adAccountName: string }> {
    const orgId = caller.orgId!;
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
    });
    if (!integration?.adAccountAccessToken) {
      throw new BadRequestException(ErrorMessages.integrations.facebookPageNotConnected);
    }

    const accounts = await this.listAdAccounts(caller);
    const account = accounts.find((a) => a.id === adAccountId);
    if (!account) throw new BadRequestException(ErrorMessages.integrations.facebookAdAccountUnavailable);

    await this.prisma.orgIntegration.update({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
      data: { adAccountId: account.id, adAccountName: account.name },
    });

    void this.insights.enqueueSync(orgId);

    return { adAccountName: account.name };
  }

  initGoogleOAuth(caller: AuthUser): { url: string } {
    if (!process.env.GOOGLE_ADS_CLIENT_ID) {
      throw new InternalServerErrorException(ErrorMessages.integrations.googleNotConfigured);
    }
    const state = this.createOAuthState(caller.orgId!);
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      redirect_uri:
        process.env.GOOGLE_ADS_REDIRECT_URI ??
        `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/integrations/config/google/oauth/callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  async handleGoogleCallback(code: string, stateToken: string): Promise<string> {
    const orgId = this.consumeOAuthState(stateToken);
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const redirectUri =
      process.env.GOOGLE_ADS_REDIRECT_URI ??
      `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/integrations/config/google/oauth/callback`;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(ErrorMessages.integrations.googleCredsMissing);
    }

    try {
      const { data: tokens } = await axios.post<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      }>('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      // Try to fetch Google Ads customer list
      let accountId: string | undefined;
      try {
        const { data: adsData } = await axios.get<{ resourceNames: string[] }>(
          'https://googleads.googleapis.com/v16/customers:listAccessibleCustomers',
          { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        );
        const first = adsData.resourceNames?.[0];
        accountId = first ? first.replace('customers/', '') : undefined;
      } catch {
        this.logger.warn('Could not fetch Google Ads customer list — storing token without accountId');
      }

      const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);

      await this.prisma.orgIntegration.upsert({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_ADS } },
        create: {
          orgId,
          provider: IntegrationProvider.GOOGLE_ADS,
          status: IntegrationStatus.CONNECTED,
          accessToken: encryptToken(tokens.access_token),
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined,
          tokenExpiry,
          accountId,
        },
        update: {
          status: IntegrationStatus.CONNECTED,
          accessToken: encryptToken(tokens.access_token),
          ...(tokens.refresh_token && { refreshToken: encryptToken(tokens.refresh_token) }),
          tokenExpiry,
          accountId,
        },
      });

      // Ensure the org has a webhook token for routing and a Google webhook key to verify with
      await this.ensureOrgWebhookToken(orgId);
      await this.ensureGoogleWebhookKey(orgId);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.error('Google OAuth callback failed', err.response?.data ?? err.message);
      }
      throw err;
    }

    return `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/integrations?connected=google`;
  }

  async disconnect(provider: IntegrationProvider, caller: AuthUser): Promise<void> {
    const orgId = caller.orgId!;

    // A disconnected SES_DOMAIN identity would otherwise sit in AWS forever — SES never
    // expires unverified/orphaned identities on its own — so clean it up before clearing
    // our own record of it.
    if (provider === IntegrationProvider.EMAIL) {
      const existing = await this.prisma.orgIntegration.findUnique({
        where: { orgId_provider: { orgId, provider } },
      });
      const metadata = existing?.metadata as { method?: string } | null;
      if (metadata?.method === 'SES_DOMAIN' && existing?.accountId) {
        await this.deleteSesIdentity(existing.accountId, orgId);
      }
    }

    // For WhatsApp, webhookSecret holds the customer's own Meta App Secret and metadata
    // holds their webhook verify token — both must be cleared on disconnect, otherwise the
    // webhook keeps accepting/verifying events for an org that explicitly disconnected. For
    // every other provider (including Razorpay — its webhookSecret is generated by us, like
    // the generic-webhook/Google Ads secrets, not supplied by the customer), webhookSecret is
    // GenXCRM's own key and must survive disconnect. Email's metadata holds SMTP host/port or
    // SES domain/DKIM tokens — also the customer's own config, so it must be cleared too
    // rather than silently reused on the next connect.
    const isWhatsApp = provider === IntegrationProvider.WHATSAPP;
    const clearsMetadata = isWhatsApp || provider === IntegrationProvider.EMAIL;

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider } },
      create: {
        orgId,
        provider,
        status: IntegrationStatus.DISCONNECTED,
        disconnectedAt: new Date(),
      },
      update: {
        status: IntegrationStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
        accountId: null,
        accountName: null,
        adAccountId: null,
        adAccountName: null,
        adAccountAccessToken: null,
        lastSyncedAt: null,
        ...(clearsMetadata ? { webhookSecret: null, metadata: {} } : {}),
      },
    });
  }

  /**
   * Manually re-trigger a Facebook lead backfill from an arbitrary point in time.
   * For closing a gap the automatic reconnect trigger already missed — e.g. an outage
   * that started before disconnectedAt was ever recorded correctly, or one already
   * cleared by a prior successful (but incomplete) backfill.
   */
  async manualBackfillFacebook(caller: AuthUser, since: Date): Promise<void> {
    const orgId = caller.orgId!;
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.FACEBOOK } },
    });
    if (!integration?.accountId || integration.status !== IntegrationStatus.CONNECTED) {
      throw new BadRequestException(ErrorMessages.integrations.facebookNotConnectedForBackfill);
    }
    await this.leadBackfill.enqueueBackfill(orgId, integration.accountId, since);
  }

  async getWebhookInfo(caller: AuthUser): Promise<WebhookInfoDto> {
    const orgWebhookToken = await this.ensureOrgWebhookToken(caller.orgId!);
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId: caller.orgId!, provider: IntegrationProvider.WEBHOOK } },
    });
    return {
      webhookUrl: this.buildWebhookUrl(orgWebhookToken),
      webhookSecret: integration?.webhookSecret ?? null,
    };
  }

  async regenerateWebhookSecret(caller: AuthUser): Promise<WebhookInfoDto> {
    const newSecret = crypto.randomBytes(32).toString('hex');
    const orgWebhookToken = await this.ensureOrgWebhookToken(caller.orgId!);
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId: caller.orgId!, provider: IntegrationProvider.WEBHOOK } },
      create: {
        orgId: caller.orgId!,
        provider: IntegrationProvider.WEBHOOK,
        status: IntegrationStatus.CONNECTED,
        webhookSecret: newSecret,
      },
      update: {
        webhookSecret: newSecret,
        status: IntegrationStatus.CONNECTED,
      },
    });
    return {
      webhookUrl: this.buildWebhookUrl(orgWebhookToken),
      webhookSecret: newSecret,
    };
  }

  /** URL + key the user pastes into Google Ads to deliver leads to this org. */
  async getGoogleWebhookInfo(caller: AuthUser): Promise<GoogleWebhookInfoDto> {
    const orgWebhookToken = await this.ensureOrgWebhookToken(caller.orgId!);
    const webhookKey = await this.ensureGoogleWebhookKey(caller.orgId!);
    return {
      webhookUrl: this.buildGoogleWebhookUrl(orgWebhookToken),
      webhookKey,
    };
  }

  /** Issue a fresh Google webhook key (invalidates the old one). */
  async regenerateGoogleWebhookKey(caller: AuthUser): Promise<GoogleWebhookInfoDto> {
    const newKey = crypto.randomBytes(24).toString('hex');
    const orgWebhookToken = await this.ensureOrgWebhookToken(caller.orgId!);
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId: caller.orgId!, provider: IntegrationProvider.GOOGLE_ADS } },
      create: {
        orgId: caller.orgId!,
        provider: IntegrationProvider.GOOGLE_ADS,
        status: IntegrationStatus.DISCONNECTED,
        webhookSecret: newKey,
      },
      update: { webhookSecret: newKey },
    });
    return { webhookUrl: this.buildGoogleWebhookUrl(orgWebhookToken), webhookKey: newKey };
  }

  /** Validate the customer's WABA credentials against the Graph API, then store them. */
  async connectWhatsApp(
    caller: AuthUser,
    dto: ConnectWhatsAppDto,
  ): Promise<{ accountName: string; webhookUrl: string; verifyToken: string }> {
    const orgId = caller.orgId!;

    let accountName: string;
    try {
      const { data } = await axios.get<{ display_phone_number?: string; verified_name?: string }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/${dto.phoneNumberId}`,
        {
          params: { fields: 'display_phone_number,verified_name' },
          headers: { Authorization: `Bearer ${dto.accessToken}` },
        },
      );
      accountName = data.verified_name ?? data.display_phone_number ?? dto.phoneNumberId;
    } catch (err) {
      this.logger.error(`WhatsApp credential validation failed for orgId=${orgId}: ${this.graphErrorDetail(err)}`);
      throw new BadRequestException(ErrorMessages.integrations.whatsappCredentialsInvalid);
    }

    try {
      await axios.get(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${dto.businessAccountId}`, {
        params: { fields: 'id' },
        headers: { Authorization: `Bearer ${dto.accessToken}` },
      });
    } catch (err) {
      this.logger.error(
        `WhatsApp business account id validation failed for orgId=${orgId}: ${this.graphErrorDetail(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.whatsappBusinessAccountInvalid);
    }

    const orgWebhookToken = await this.ensureOrgWebhookToken(orgId);
    const verifyToken = crypto.randomBytes(16).toString('hex');
    const metadata = { verifyToken, businessAccountId: encryptToken(dto.businessAccountId) };

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
      create: {
        orgId,
        provider: IntegrationProvider.WHATSAPP,
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.accessToken),
        webhookSecret: encryptToken(dto.appSecret),
        accountId: dto.phoneNumberId,
        accountName,
        metadata,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.accessToken),
        webhookSecret: encryptToken(dto.appSecret),
        accountId: dto.phoneNumberId,
        accountName,
        metadata,
      },
    });

    return { accountName, webhookUrl: this.buildWhatsAppWebhookUrl(orgWebhookToken), verifyToken };
  }

  /** App ID + config ID the frontend needs to call `FB.login()` for WhatsApp Embedded Signup. */
  getWhatsAppEmbeddedSignupConfig(): { appId: string; configId: string } {
    const appId = process.env.FACEBOOK_APP_ID;
    const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
    if (!appId || !configId) {
      throw new InternalServerErrorException(ErrorMessages.integrations.whatsappEmbeddedSignupNotConfigured);
    }
    return { appId, configId };
  }

  /**
   * Finish WhatsApp Embedded Signup: exchange the FB.login() code for a token,
   * subscribe GenXCRM's app to the org's WABA, and store the connection.
   */
  async completeWhatsAppEmbeddedSignup(
    caller: AuthUser,
    dto: CompleteWhatsAppEmbeddedSignupDto,
  ): Promise<{ accountName: string }> {
    const orgId = caller.orgId!;
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      throw new InternalServerErrorException(ErrorMessages.integrations.whatsappEmbeddedSignupNotConfigured);
    }

    let accessToken: string;
    try {
      const { data: shortLived } = await axios.get<{ access_token: string }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`,
        { params: { client_id: appId, client_secret: appSecret, code: dto.code } },
      );
      const { data: longLived } = await axios.get<{ access_token: string }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLived.access_token,
          },
        },
      );
      accessToken = longLived.access_token;
    } catch (err) {
      this.logger.error(
        `WhatsApp Embedded Signup code exchange failed for orgId=${orgId}: ${this.graphErrorDetail(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.whatsappCredentialsInvalid);
    }

    try {
      await axios.post(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${dto.wabaId}/subscribed_apps`, null, {
        params: { access_token: accessToken },
      });
    } catch (err) {
      this.logger.error(
        `Failed to subscribe app to WABA ${dto.wabaId} for orgId=${orgId}: ${this.graphErrorDetail(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.whatsappBusinessAccountInvalid);
    }

    let accountName: string;
    try {
      const { data } = await axios.get<{ display_phone_number?: string; verified_name?: string }>(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/${dto.phoneNumberId}`,
        { params: { fields: 'display_phone_number,verified_name', access_token: accessToken } },
      );
      accountName = data.verified_name ?? data.display_phone_number ?? dto.phoneNumberId;
    } catch (err) {
      this.logger.error(
        `Failed to fetch WhatsApp phone number details for orgId=${orgId}: ${this.graphErrorDetail(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.whatsappCredentialsInvalid);
    }

    const metadata = { businessAccountId: encryptToken(dto.wabaId), connectMethod: 'EMBEDDED_SIGNUP' };
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
      create: {
        orgId,
        provider: IntegrationProvider.WHATSAPP,
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(accessToken),
        accountId: dto.phoneNumberId,
        accountName,
        metadata,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(accessToken),
        webhookSecret: null,
        accountId: dto.phoneNumberId,
        accountName,
        metadata,
      },
    });

    return { accountName };
  }

  /** URL + verify token the user pastes into Meta's WhatsApp webhook configuration. */
  async getWhatsAppWebhookInfo(caller: AuthUser): Promise<WhatsAppWebhookInfoDto> {
    const orgId = caller.orgId!;
    const orgWebhookToken = await this.ensureOrgWebhookToken(orgId);
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
    });
    const verifyToken = (integration?.metadata as { verifyToken?: string } | null)?.verifyToken ?? '';
    return { webhookUrl: this.buildWhatsAppWebhookUrl(orgWebhookToken), verifyToken };
  }

  /** Issue a fresh WhatsApp webhook verify token (invalidates the old one). */
  async regenerateWhatsAppVerifyToken(caller: AuthUser): Promise<WhatsAppWebhookInfoDto> {
    const orgId = caller.orgId!;
    const orgWebhookToken = await this.ensureOrgWebhookToken(orgId);
    const verifyToken = crypto.randomBytes(16).toString('hex');
    const existing = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
      select: { metadata: true },
    });
    const existingBusinessAccountId = (existing?.metadata as { businessAccountId?: string } | null)
      ?.businessAccountId;
    const metadata = existingBusinessAccountId
      ? { verifyToken, businessAccountId: existingBusinessAccountId }
      : { verifyToken };
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
      create: {
        orgId,
        provider: IntegrationProvider.WHATSAPP,
        status: IntegrationStatus.DISCONNECTED,
        metadata,
      },
      update: { metadata },
    });
    return { webhookUrl: this.buildWhatsAppWebhookUrl(orgWebhookToken), verifyToken };
  }

  /** Validate the customer's SMTP credentials with a live handshake, then store them. */
  async connectEmailSmtp(caller: AuthUser, dto: ConnectEmailSmtpDto): Promise<{ fromEmail: string }> {
    const orgId = caller.orgId!;

    const transporter = nodemailer.createTransport({
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      auth: { user: dto.username, pass: dto.password },
    });
    try {
      await transporter.verify();
    } catch (err) {
      this.logger.error(
        `SMTP verification failed for orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.smtpVerificationFailed);
    }

    const metadata = { method: 'SMTP', host: dto.host, port: dto.port, secure: dto.secure, fromEmail: dto.fromEmail };

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.EMAIL } },
      create: {
        orgId,
        provider: IntegrationProvider.EMAIL,
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.password),
        accountId: dto.username,
        accountName: dto.fromName,
        metadata,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.password),
        accountId: dto.username,
        accountName: dto.fromName,
        metadata,
      },
    });

    return { fromEmail: dto.fromEmail };
  }

  /**
   * Start AWS SES verification for the org's own sending domain and return the DNS
   * records they need to add. Verification finishes asynchronously on AWS's side —
   * status stays PENDING until checkEmailDomainStatus confirms it.
   */
  async connectEmailSesDomain(
    caller: AuthUser,
    dto: ConnectEmailSesDomainDto,
  ): Promise<{ domain: string; dnsRecords: DnsRecordDto[] }> {
    const orgId = caller.orgId!;

    const existing = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.EMAIL } },
    });
    const existingMetadata = existing?.metadata as { method?: string } | null;
    const previousDomain =
      existingMetadata?.method === 'SES_DOMAIN' && existing?.accountId !== dto.domain ? existing?.accountId : null;

    let domainVerificationToken: string;
    let dkimTokens: string[];
    try {
      const domainResult = await this.ses.verifyDomainIdentity({ Domain: dto.domain }).promise();
      domainVerificationToken = domainResult.VerificationToken;
      const dkimResult = await this.ses.verifyDomainDkim({ Domain: dto.domain }).promise();
      dkimTokens = dkimResult.DkimTokens;
    } catch (err) {
      this.logger.error(
        `SES domain verification failed for orgId=${orgId}, domain=${dto.domain}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.emailDomainVerificationFailed);
    }

    // A previously connected domain (different from this one) would otherwise sit orphaned
    // in AWS SES forever — clean it up now that the new domain is verified.
    if (previousDomain) {
      await this.deleteSesIdentity(previousDomain, orgId);
    }

    const metadata = { method: 'SES_DOMAIN', fromEmail: dto.fromEmail, domainVerificationToken, dkimTokens };

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.EMAIL } },
      create: {
        orgId,
        provider: IntegrationProvider.EMAIL,
        status: IntegrationStatus.PENDING,
        accountId: dto.domain,
        accountName: dto.fromName,
        metadata,
      },
      update: {
        status: IntegrationStatus.PENDING,
        accessToken: null,
        accountId: dto.domain,
        accountName: dto.fromName,
        metadata,
      },
    });

    return { domain: dto.domain, dnsRecords: this.buildSesDnsRecords(dto.domain, domainVerificationToken, dkimTokens) };
  }

  /**
   * Re-checks AWS SES for a PENDING domain and flips it to CONNECTED once verified.
   * Called both from an explicit "Check status" action and automatically whenever the
   * org loads the Email tab while still PENDING — no background job needed.
   */
  async checkEmailDomainStatus(caller: AuthUser): Promise<EmailConfigDto> {
    const orgId = caller.orgId!;
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.EMAIL } },
    });
    if (!integration?.accountId) {
      throw new BadRequestException(ErrorMessages.integrations.emailNotConnected);
    }

    const metadata = integration.metadata as { method?: string } | null;
    if (integration.status === IntegrationStatus.PENDING && metadata?.method === 'SES_DOMAIN') {
      try {
        const { VerificationAttributes } = await this.ses
          .getIdentityVerificationAttributes({ Identities: [integration.accountId] })
          .promise();
        if (VerificationAttributes?.[integration.accountId]?.VerificationStatus === 'Success') {
          await this.prisma.orgIntegration.update({
            where: { orgId_provider: { orgId, provider: IntegrationProvider.EMAIL } },
            data: { status: IntegrationStatus.CONNECTED },
          });
          integration.status = IntegrationStatus.CONNECTED;
        }
      } catch (err) {
        this.logger.error(
          `Failed to check SES domain verification for orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.toEmailConfigDto(integration);
  }

  /** Current email config (method, status, masked identifiers, DNS records if applicable). */
  async getEmailConfig(caller: AuthUser): Promise<EmailConfigDto> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId: caller.orgId!, provider: IntegrationProvider.EMAIL } },
    });
    return this.toEmailConfigDto(integration);
  }

  private toEmailConfigDto(integration: OrgIntegration | null): EmailConfigDto {
    if (!integration) return { method: null, status: IntegrationStatus.DISCONNECTED };

    const metadata = (integration.metadata ?? {}) as {
      method?: 'SMTP' | 'SES_DOMAIN';
      host?: string;
      port?: number;
      secure?: boolean;
      fromEmail?: string;
      domainVerificationToken?: string;
      dkimTokens?: string[];
    };
    const isSmtp = metadata.method === 'SMTP';

    return {
      method: metadata.method ?? null,
      status: integration.status,
      fromEmail: metadata.fromEmail ?? null,
      fromName: integration.accountName,
      host: isSmtp ? (metadata.host ?? null) : null,
      port: isSmtp ? (metadata.port ?? null) : null,
      secure: isSmtp ? (metadata.secure ?? null) : null,
      maskedUsername: isSmtp && integration.accountId ? `****${integration.accountId.slice(-4)}` : null,
      domain: !isSmtp ? integration.accountId : null,
      dnsRecords:
        !isSmtp && integration.accountId && metadata.domainVerificationToken && metadata.dkimTokens
          ? this.buildSesDnsRecords(integration.accountId, metadata.domainVerificationToken, metadata.dkimTokens)
          : undefined,
    };
  }

  private buildSesDnsRecords(domain: string, verificationToken: string, dkimTokens: string[]): DnsRecordDto[] {
    return [
      { type: 'TXT', name: `_amazonses.${domain}`, value: verificationToken },
      ...dkimTokens.map((token) => ({
        type: 'CNAME',
        name: `${token}._domainkey.${domain}`,
        value: `${token}.dkim.amazonses.com`,
      })),
    ];
  }

  /**
   * Best-effort SES identity cleanup — never blocks the caller's connect/disconnect on
   * failure, since an orphaned identity is just AWS-side clutter, not a functional break.
   */
  private async deleteSesIdentity(domain: string, orgId: string): Promise<void> {
    try {
      await this.ses.deleteIdentity({ Identity: domain }).promise();
    } catch (err) {
      this.logger.warn(
        `Failed to delete stale SES identity ${domain} for orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Validate the customer's own Razorpay Key ID/Secret with a live API call, then store
   * them so PaymentsService can collect payments from the org's students through the
   * org's own Razorpay account instead of GenXCRM's platform Razorpay (which stays
   * reserved for subscription billing — see BillingService, untouched by this). The
   * webhook secret is handled separately (see getRazorpayWebhookInfo) — it's generated by
   * us, not supplied by the customer, and survives a Key ID/Secret disconnect/reconnect.
   */
  async connectRazorpay(caller: AuthUser, dto: ConnectRazorpayDto): Promise<{ keyId: string }> {
    const orgId = caller.orgId!;

    try {
      const rzp = new Razorpay({ key_id: dto.keyId, key_secret: dto.keySecret });
      await rzp.payments.all({ count: 1 });
    } catch (err) {
      this.logger.error(
        `Razorpay credential validation failed for orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(ErrorMessages.integrations.razorpayCredentialsInvalid);
    }

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.RAZORPAY } },
      create: {
        orgId,
        provider: IntegrationProvider.RAZORPAY,
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.keySecret),
        accountId: dto.keyId,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.keySecret),
        accountId: dto.keyId,
      },
    });

    return { keyId: dto.keyId };
  }

  /**
   * Validate the customer's own Cashfree App ID / Secret Key with a live API call, then store
   * them so PaymentsService can collect payments through the org's own Cashfree account.
   * No webhook secret to manage: Cashfree signs webhooks with the Secret Key itself, and the
   * webhook URL is sent per-link (notify_url), so there is nothing extra to paste.
   */
  async connectCashfree(caller: AuthUser, dto: ConnectCashfreeDto): Promise<{ appId: string }> {
    const orgId = caller.orgId!;

    // Looking up a link that cannot exist: valid credentials answer 404 "link not found",
    // wrong ones answer 401/403 — so no real link or charge is created just to check keys.
    try {
      await axios.get(`${cashfreeBaseUrl(dto.appId, dto.secretKey)}/links/genxcrm-credential-check`, {
        headers: cashfreeHeaders(dto.appId, dto.secretKey),
      });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status !== 404) {
        this.logger.error(
          `Cashfree credential validation failed for orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new BadRequestException(ErrorMessages.integrations.cashfreeCredentialsInvalid);
      }
    }

    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.CASHFREE } },
      create: {
        orgId,
        provider: IntegrationProvider.CASHFREE,
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.secretKey),
        accountId: dto.appId,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        accessToken: encryptToken(dto.secretKey),
        accountId: dto.appId,
      },
    });

    return { appId: dto.appId };
  }

  /**
   * Save the "API Link" from TradeIndia's My Inquiry API page (it carries the user id, profile
   * id and key). Stays PENDING until the poller (see tradeindia-sync) fetches enquiries with it.
   */
  async connectTradeIndia(caller: AuthUser, dto: ConnectTradeIndiaDto): Promise<{ saved: true }> {
    const orgId = caller.orgId!;
    const accessToken = encryptToken(dto.apiLink);
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.TRADEINDIA } },
      create: { orgId, provider: IntegrationProvider.TRADEINDIA, status: IntegrationStatus.PENDING, accessToken, accountName: 'TradeIndia' },
      update: { status: IntegrationStatus.PENDING, accessToken, accountName: 'TradeIndia', disconnectedAt: null },
    });
    return { saved: true };
  }

  /**
   * URL + secret the org pastes into their Razorpay dashboard's webhook config. Unlike
   * WhatsApp's App Secret, this secret isn't supplied by the customer — we generate it
   * (like the generic-webhook and Google Ads webhook secrets) so it can be shown in full
   * and regenerated on demand.
   */
  async getRazorpayWebhookInfo(caller: AuthUser): Promise<{ webhookUrl: string; webhookSecret: string }> {
    const webhookSecret = await this.ensureRazorpayWebhookSecret(caller.orgId!);
    return { webhookUrl: this.buildRazorpayWebhookUrl(), webhookSecret };
  }

  /** Issue a fresh Razorpay webhook secret (invalidates the old one). */
  async regenerateRazorpayWebhookSecret(caller: AuthUser): Promise<{ webhookUrl: string; webhookSecret: string }> {
    const orgId = caller.orgId!;
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.RAZORPAY } },
      create: {
        orgId,
        provider: IntegrationProvider.RAZORPAY,
        status: IntegrationStatus.DISCONNECTED,
        webhookSecret,
      },
      update: { webhookSecret },
    });
    return { webhookUrl: this.buildRazorpayWebhookUrl(), webhookSecret };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Return the org's Google webhook key, generating one on first access. */
  private async ensureGoogleWebhookKey(orgId: string): Promise<string> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_ADS } },
      select: { webhookSecret: true },
    });
    if (integration?.webhookSecret) return integration.webhookSecret;

    const key = crypto.randomBytes(24).toString('hex');
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.GOOGLE_ADS } },
      create: {
        orgId,
        provider: IntegrationProvider.GOOGLE_ADS,
        status: IntegrationStatus.DISCONNECTED,
        webhookSecret: key,
      },
      update: { webhookSecret: key },
    });
    return key;
  }

  private buildGoogleWebhookUrl(orgWebhookToken: string): string {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
    return `${apiUrl}/api/v1/integrations/google/${orgWebhookToken}/webhook`;
  }

  /** Return the org's Razorpay webhook secret, generating one on first access. */
  private async ensureRazorpayWebhookSecret(orgId: string): Promise<string> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.RAZORPAY } },
      select: { webhookSecret: true },
    });
    if (integration?.webhookSecret) return integration.webhookSecret;

    const secret = crypto.randomBytes(32).toString('hex');
    await this.prisma.orgIntegration.upsert({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.RAZORPAY } },
      create: {
        orgId,
        provider: IntegrationProvider.RAZORPAY,
        status: IntegrationStatus.DISCONNECTED,
        webhookSecret: secret,
      },
      update: { webhookSecret: secret },
    });
    return secret;
  }

  // No per-org token in the path — Razorpay webhooks aren't per-org URLs, so every org
  // shares this endpoint; PaymentsService.handleWebhook resolves the owning org from the
  // payment link id in the payload before picking which org's secret to verify against.
  private buildRazorpayWebhookUrl(): string {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
    return `${apiUrl}/api/v1/payments/webhook/RAZORPAY`;
  }

  private buildWhatsAppWebhookUrl(orgWebhookToken: string): string {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
    return `${apiUrl}/api/v1/integrations/whatsapp/${orgWebhookToken}/webhook`;
  }

  private createOAuthState(orgId: string): string {
    const state = crypto.randomUUID();
    this.oauthStates.set(state, { orgId, expiresAt: Date.now() + 10 * 60 * 1000 });
    // Clean up expired states on each creation
    for (const [key, val] of this.oauthStates) {
      if (val.expiresAt < Date.now()) this.oauthStates.delete(key);
    }
    return state;
  }

  private consumeOAuthState(state: string): string {
    const entry = this.oauthStates.get(state);
    if (!entry) throw new BadRequestException(ErrorMessages.integrations.oauthStateInvalid);
    this.oauthStates.delete(state);
    if (entry.expiresAt < Date.now()) throw new UnauthorizedException(ErrorMessages.integrations.oauthStateExpired);
    return entry.orgId;
  }

  private async ensureOrgWebhookToken(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { orgWebhookToken: true },
    });
    if (!org) throw new NotFoundException(ErrorMessages.integrations.orgNotFound);
    if (org.orgWebhookToken) return org.orgWebhookToken;
    const token = crypto.randomBytes(16).toString('hex');
    await this.prisma.organization.update({ where: { id: orgId }, data: { orgWebhookToken: token } });
    return token;
  }

  private buildWebhookUrl(orgWebhookToken: string): string {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
    return `${apiUrl}/api/v1/integrations/webhook/${orgWebhookToken}/ingest`;
  }

  // Exposed for use in GoogleService token refresh
  async refreshGoogleToken(orgIntegrationId: string, refreshToken: string): Promise<string> {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new InternalServerErrorException(ErrorMessages.integrations.googleCredsMissing);

    const { data } = await axios.post<{ access_token: string; expires_in: number }>(
      'https://oauth2.googleapis.com/token',
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret },
    );
    const tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
    await this.prisma.orgIntegration.update({
      where: { id: orgIntegrationId },
      data: { accessToken: encryptToken(data.access_token), tokenExpiry },
    });
    return data.access_token;
  }
}
