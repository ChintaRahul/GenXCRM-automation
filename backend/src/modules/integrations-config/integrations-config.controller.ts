import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { IntegrationsConfigService } from './integrations-config.service';
import { ManualBackfillDto } from './dto/manual-backfill.dto';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { CompleteWhatsAppEmbeddedSignupDto } from './dto/complete-whatsapp-embedded-signup.dto';
import { ConnectEmailSmtpDto } from './dto/connect-email-smtp.dto';
import { ConnectEmailSesDomainDto } from './dto/connect-email-ses-domain.dto';
import { ConnectRazorpayDto } from './dto/connect-razorpay.dto';
import { ConnectCashfreeDto } from './dto/connect-cashfree.dto';
import { ConnectTradeIndiaDto } from './dto/connect-tradeindia.dto';
import { renderFacebookOAuthPopup } from './oauth-popup.template';
import { ErrorMessages } from '../../common/constants/messages';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role, IntegrationProvider } from '@prisma/client';

// Origin (scheme+host+port, no path) the popup is allowed to postMessage back to.
function frontendOrigin(): string {
  const raw = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

@Controller('integrations/config')
export class IntegrationsConfigController {
  constructor(private readonly service: IntegrationsConfigService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get()
  getStatuses(@CurrentUser() caller: AuthUser) {
    return this.service.getStatuses(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('facebook/oauth/init')
  initFacebookOAuth(@CurrentUser() caller: AuthUser) {
    return this.service.initFacebookOAuth(caller);
  }

  // No auth guard — this is a redirect from Facebook's OAuth server. We render an
  // HTML page INSIDE the popup that either confirms success, shows a Page picker,
  // or reports an error — then posts a message to the opener and closes itself.
  @Get('facebook/oauth/callback')
  async facebookOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.service.handleFacebookCallback(code, state);
    res.type('html').send(renderFacebookOAuthPopup(result, frontendOrigin()));
  }

  // No JWT guard — the popup has no app session. The one-time selectionToken
  // (issued in handleFacebookCallback) authorizes this call.
  @Post('facebook/oauth/select-page')
  async selectFacebookPage(
    @Body() body: { token?: string; pageId?: string },
    @Res() res: Response,
  ) {
    try {
      if (!body?.token || !body?.pageId) {
        return res.status(400).json({ status: 'error', message: 'Missing selection.' });
      }
      const { accountName } = await this.service.connectFacebookPage(body.token, body.pageId);
      return res.json({ status: 'success', account: accountName });
    } catch (e) {
      return res
        .status(400)
        .json({ status: 'error', message: e instanceof Error ? e.message : 'Failed to connect Page.' });
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('facebook/backfill')
  manualBackfillFacebook(@Body() dto: ManualBackfillDto, @CurrentUser() caller: AuthUser) {
    return this.service.manualBackfillFacebook(caller, new Date(dto.since));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('facebook/ad-accounts')
  listFacebookAdAccounts(@CurrentUser() caller: AuthUser) {
    return this.service.listAdAccounts(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('facebook/ad-account')
  connectFacebookAdAccount(@Body() body: { adAccountId: string }, @CurrentUser() caller: AuthUser) {
    return this.service.connectAdAccount(caller, body.adAccountId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('google/oauth/init')
  initGoogleOAuth(@CurrentUser() caller: AuthUser) {
    return this.service.initGoogleOAuth(caller);
  }

  // No auth guard — this is a redirect from Google's OAuth server
  @Get('google/oauth/callback')
  async googleOAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const redirectUrl = await this.service.handleGoogleCallback(code, state);
    res.redirect(redirectUrl);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete(':provider')
  disconnect(@Param('provider') provider: string, @CurrentUser() caller: AuthUser) {
    const normalized = provider.toUpperCase() as IntegrationProvider;
    if (!Object.values(IntegrationProvider).includes(normalized)) {
      throw new ForbiddenException(ErrorMessages.integrations.unknownProvider);
    }
    // WhatsApp, Email, and Razorpay hold the customer's own credentials (Meta App Secret /
    // API token, SMTP password, Razorpay Key Secret) — connect is DIRECTOR-only, so
    // disconnect must be too (a MANAGER could otherwise sever a credential they can't restore).
    if (
      (normalized === IntegrationProvider.WHATSAPP ||
        normalized === IntegrationProvider.EMAIL ||
        normalized === IntegrationProvider.RAZORPAY ||
        normalized === IntegrationProvider.CASHFREE) &&
      caller.role !== Role.DIRECTOR
    ) {
      throw new ForbiddenException(ErrorMessages.integrations.directorOnly);
    }
    return this.service.disconnect(normalized, caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('webhook/info')
  getWebhookInfo(@CurrentUser() caller: AuthUser) {
    return this.service.getWebhookInfo(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('webhook/regenerate-secret')
  regenerateWebhookSecret(@CurrentUser() caller: AuthUser) {
    return this.service.regenerateWebhookSecret(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('google/webhook/info')
  getGoogleWebhookInfo(@CurrentUser() caller: AuthUser) {
    return this.service.getGoogleWebhookInfo(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('google/webhook/regenerate-key')
  regenerateGoogleWebhookKey(@CurrentUser() caller: AuthUser) {
    return this.service.regenerateGoogleWebhookKey(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('whatsapp/connect')
  connectWhatsApp(@Body() dto: ConnectWhatsAppDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectWhatsApp(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Get('whatsapp/embedded-signup/config')
  getWhatsAppEmbeddedSignupConfig() {
    return this.service.getWhatsAppEmbeddedSignupConfig();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('whatsapp/embedded-signup/complete')
  completeWhatsAppEmbeddedSignup(@Body() dto: CompleteWhatsAppEmbeddedSignupDto, @CurrentUser() caller: AuthUser) {
    return this.service.completeWhatsAppEmbeddedSignup(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('whatsapp/webhook-info')
  getWhatsAppWebhookInfo(@CurrentUser() caller: AuthUser) {
    return this.service.getWhatsAppWebhookInfo(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('whatsapp/regenerate-verify-token')
  regenerateWhatsAppVerifyToken(@CurrentUser() caller: AuthUser) {
    return this.service.regenerateWhatsAppVerifyToken(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('email/config')
  getEmailConfig(@CurrentUser() caller: AuthUser) {
    return this.service.getEmailConfig(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('email/smtp')
  connectEmailSmtp(@Body() dto: ConnectEmailSmtpDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectEmailSmtp(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('email/ses-domain')
  connectEmailSesDomain(@Body() dto: ConnectEmailSesDomainDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectEmailSesDomain(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('email/check-status')
  checkEmailDomainStatus(@CurrentUser() caller: AuthUser) {
    return this.service.checkEmailDomainStatus(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('razorpay/connect')
  connectRazorpay(@Body() dto: ConnectRazorpayDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectRazorpay(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('cashfree/connect')
  connectCashfree(@Body() dto: ConnectCashfreeDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectCashfree(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Post('tradeindia/connect')
  connectTradeIndia(@Body() dto: ConnectTradeIndiaDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectTradeIndia(caller, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('razorpay/webhook-info')
  getRazorpayWebhookInfo(@CurrentUser() caller: AuthUser) {
    return this.service.getRazorpayWebhookInfo(caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('razorpay/regenerate-webhook-secret')
  regenerateRazorpayWebhookSecret(@CurrentUser() caller: AuthUser) {
    return this.service.regenerateRazorpayWebhookSecret(caller);
  }
}
