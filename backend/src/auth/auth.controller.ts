import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Param,
  Header,
  UseGuards,
  ForbiddenException,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleOAuthGuard, FacebookOAuthGuard, TwitterOAuthGuard } from './guards/oauth.guard';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from '../common/guards/auth-rate-limit.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmRegistrationPaymentDto } from './dto/confirm-registration-payment.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaChallengeVerifyDto } from './dto/mfa-challenge-verify.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { MfaResetRequestDto } from './dto/mfa-reset-request.dto';
import { MfaResetConfirmDto } from './dto/mfa-reset-confirm.dto';
import { MfaService } from './mfa.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TrialService } from '../modules/trial/trial.service';
import type { AuthUser } from '../common/types/auth-user.type';
import type { OAuthProfile } from './strategies/google.strategy';
import { ErrorMessages } from '../common/constants/messages';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// Deep link scheme the Android app registers (AndroidManifest.xml intent-filter) —
// see guards/oauth.guard.ts for how a request originating from the app is flagged.
const APP_SCHEME = process.env.APP_SCHEME ?? 'com.genxcrm.app://';

type OAuthResult =
  | { mfaRequired: true; challengeToken: string }
  | { mustSetupMfa: true; setupToken: string; qrCodeDataUrl: string; secret: string }
  | { token: string; needsOrgSetup: boolean };

// Builds the redirect the browser lands on after a Google/Facebook/Twitter callback.
// Since OAuth completes via a full-page redirect (not a JSON response), an MFA gate
// can only carry its token through the URL — never the qrCodeDataUrl/secret payload
// (a multi-KB data: URI risks hitting proxy/CDN URL-length limits); MfaSetupPage
// instead fetches those fresh via GET /auth/mfa/setup-info using just the setupToken.
function oauthRedirectTarget(req: Request, result: OAuthResult): string {
  const base = req.session?.oauthPlatform === 'native' ? `${APP_SCHEME}auth/callback` : `${FRONTEND_URL}/auth/callback`;

  if ('mfaRequired' in result) return `${base}?mfa=challenge&challengeToken=${result.challengeToken}`;
  if ('mustSetupMfa' in result) return `${base}?mfa=setup&setupToken=${result.setupToken}`;

  const query = result.needsOrgSetup ? `token=${result.token}&setup=1` : `token=${result.token}`;
  return `${base}?${query}`;
}

function oauthErrorTarget(req: Request): string {
  return req.session?.oauthPlatform === 'native'
    ? `${APP_SCHEME}auth/callback?error=sso`
    : `${FRONTEND_URL}/login?error=sso`;
}

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'support@genxcrm.co.in';

// Public "how to delete your data" page for the Facebook **Data Deletion
// Instructions URL** field. A plain, self-contained HTML document (no app
// shell, no JS) so it renders even before the SPA is publicly hosted.
const DATA_DELETION_INSTRUCTIONS_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data Deletion Instructions — GenXCRM</title>
<style>
  body{margin:0;background:#eceff1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#27323b;line-height:1.6}
  .wrap{max-width:640px;margin:40px auto;padding:0 16px}
  .card{background:#fff;border:1px solid #e6ebec;border-radius:16px;padding:32px}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:#6b7884;margin:0 0 24px;font-size:14px}
  ol{padding-left:20px}li{margin:0 0 12px}
  a{color:#108e86}
  .foot{margin-top:24px;font-size:12.5px;color:#8a96a1}
</style></head>
<body><div class="wrap"><div class="card">
  <h1>Data Deletion Instructions</h1>
  <p class="sub">GenXCRM &mdash; how to delete data associated with your Facebook login</p>
  <p>If you signed in to GenXCRM with Facebook, you can have the personal data we
     received (your name, email, and phone) erased in either of these ways:</p>
  <ol>
    <li><strong>Remove the app on Facebook.</strong> Go to Facebook &rarr;
        <em>Settings &amp; privacy &rarr; Settings &rarr; Apps and Websites</em>,
        find <strong>GenXCRM</strong>, and remove it. Facebook notifies us
        automatically and we erase the associated profile data and disable the login.</li>
    <li><strong>Email us.</strong> Send a request to
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address on
        your account. We will erase your name, email, and phone and confirm within 30 days.</li>
  </ol>
  <p class="foot">This erases the personal data tied to your account. Records that
     must be retained for legal or accounting reasons are anonymized rather than deleted.</p>
</div></div></body></html>`;

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private trial: TrialService,
    private mfa: MfaService,
  ) {}

  @UseGuards(AuthRateLimitGuard)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // Public: lets the signup form flag an already-registered email on blur,
  // instead of the user discovering it only after finishing all three steps.
  @Get('check-email')
  async checkEmail(@Query() dto: CheckEmailDto) {
    const available = await this.auth.isEmailAvailable(dto.email);
    return { available };
  }

  // Public: no session exists yet for a paid signup. Trust boundary is the
  // Razorpay signature verified inside the service, not a guard here.
  @Post('register/confirm-payment')
  confirmRegistrationPayment(@Body() dto: ConfirmRegistrationPaymentDto) {
    return this.auth.confirmRegistrationPayment(dto);
  }

  @UseGuards(AuthRateLimitGuard)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // ── Email verification & password reset ───────────────────────────────────
  // POST + body keeps the raw token out of server logs and browser history.

  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.email);
    return { message: 'If that account exists and is unverified, a new link was sent.' };
  }

  @UseGuards(AuthRateLimitGuard)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'If that account exists, a reset link was sent.' };
  }

  @UseGuards(AuthRateLimitGuard)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Password updated. You can now sign in.' };
  }

  // Forced first-login password change — authenticated; returns a fresh token + user.
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser) {
    return this.auth.changePassword(user.id, dto.password);
  }

  // ── Two-factor authentication (TOTP) ───────────────────────────────────────

  // Self-service enrollment, step 1 — returns a QR code + pending setup token.
  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup/init')
  mfaSetupInit(@CurrentUser() user: AuthUser) {
    return this.mfa.initSetup(user);
  }

  // Re-fetches the QR code + secret for a setupToken already issued elsewhere
  // (the OAuth forced-enrollment redirect only carries the token itself — see
  // oauthRedirectTarget above). Public, same trust model as setup/verify below.
  @Get('mfa/setup-info')
  mfaSetupInfo(@Query('token') token: string) {
    return this.mfa.getSetupInfo(token);
  }

  // Enrollment step 2 — verifies the code, persists the secret. Public: the
  // setupToken itself is the trust boundary (needed for the forced-enrollment
  // path at login, which has no session yet).
  @Post('mfa/setup/verify')
  mfaSetupVerify(@Body() dto: MfaVerifyDto) {
    return this.mfa.verifySetup(dto);
  }

  // Login-time challenge — public, the challengeToken is the trust boundary.
  @Post('mfa/challenge/verify')
  mfaChallengeVerify(@Body() dto: MfaChallengeVerifyDto) {
    return this.mfa.verifyChallenge(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  mfaDisable(@Body() dto: MfaDisableDto, @CurrentUser() user: AuthUser) {
    return this.mfa.disable(user, dto);
  }

  // Self-service "lost your authenticator" reset — public, same trust model
  // as forgot-password (always 200, no enumeration).
  @Post('mfa/reset/request')
  async mfaResetRequest(@Body() dto: MfaResetRequestDto) {
    await this.mfa.requestReset(dto.email);
    return { message: 'If that account has two-factor authentication enabled, a reset link was sent.' };
  }

  @Post('mfa/reset/confirm')
  async mfaResetConfirm(@Body() dto: MfaResetConfirmDto) {
    await this.mfa.confirmReset(dto.token);
    return { message: 'Two-factor authentication has been turned off. You can now sign in.' };
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  googleAuth() {
    /* redirects to Google */
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleCallback(@Req() req: Request & { user: OAuthProfile }, @Res() res: Response) {
    try {
      const result = await this.auth.findOrCreateFromOAuth(req.user);
      res.redirect(oauthRedirectTarget(req, result));
    } catch {
      res.redirect(oauthErrorTarget(req));
    }
  }

  // ── Facebook OAuth ────────────────────────────────────────────────────────

  @Get('facebook')
  @UseGuards(FacebookOAuthGuard)
  facebookAuth() {
    /* redirects to Facebook */
  }

  @Get('facebook/callback')
  @UseGuards(FacebookOAuthGuard)
  async facebookCallback(@Req() req: Request & { user: OAuthProfile }, @Res() res: Response) {
    try {
      const result = await this.auth.findOrCreateFromOAuth(req.user);
      res.redirect(oauthRedirectTarget(req, result));
    } catch {
      res.redirect(oauthErrorTarget(req));
    }
  }

  // Meta calls this (unauthenticated) when a user removes the app or requests
  // data deletion. Returns the { url, confirmation_code } JSON Meta requires.
  @Post('facebook/data-deletion')
  facebookDataDeletion(@Body() body: { signed_request?: string }) {
    return this.auth.deleteFacebookData(body?.signed_request ?? '');
  }

  // Status page Meta/users can visit to confirm a deletion request was handled.
  @Get('facebook/data-deletion/status')
  facebookDataDeletionStatus(@Query('code') code: string) {
    return { confirmation_code: code, status: 'completed' };
  }

  // Public instructions page for Meta's **Data Deletion Instructions URL** field.
  @Get('facebook/data-deletion/instructions')
  @Header('Content-Type', 'text/html; charset=utf-8')
  facebookDataDeletionInstructions() {
    return DATA_DELETION_INSTRUCTIONS_HTML;
  }

  // ── Twitter / X OAuth ─────────────────────────────────────────────────────

  @Get('twitter')
  @UseGuards(TwitterOAuthGuard)
  twitterAuth() {
    /* redirects to X */
  }

  @Get('twitter/callback')
  @UseGuards(TwitterOAuthGuard)
  async twitterCallback(@Req() req: Request & { user: OAuthProfile }, @Res() res: Response) {
    try {
      const result = await this.auth.findOrCreateFromOAuth(req.user);
      res.redirect(oauthRedirectTarget(req, result));
    } catch {
      res.redirect(oauthErrorTarget(req));
    }
  }

  // ── Post-OAuth org setup ──────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('complete-profile')
  completeProfile(@Body() dto: CompleteProfileDto, @CurrentUser() user: AuthUser) {
    return this.auth.completeProfile(user.id, dto);
  }

  // ── Session ───────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('trial')
  trialStatus(@CurrentUser() user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException(ErrorMessages.auth.noOrgLinked);
    return this.trial.getStatus(user.orgId);
  }

  // ── Impersonation ─────────────────────────────────────────────────────────
  // Personal admin capability, gated by email allowlist inside the service —
  // not restricted by @Roles since it isn't a general Director permission.
  // System-wide: not scoped to the caller's org.

  @UseGuards(JwtAuthGuard)
  @Get('impersonate/users')
  listImpersonatableUsers(@CurrentUser() user: AuthUser) {
    return this.auth.listImpersonatableUsers(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('impersonate/exit')
  exitImpersonation(@CurrentUser() user: AuthUser) {
    return this.auth.exitImpersonation(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('impersonate/:userId')
  impersonate(@Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.auth.impersonate(userId, user);
  }
}
