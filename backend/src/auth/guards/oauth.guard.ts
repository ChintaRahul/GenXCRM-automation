import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

declare module 'express-session' {
  interface SessionData {
    // Set on the initial /auth/:provider request when the mobile app launched it
    // (?platform=native), read back in the /callback handler — express-session's
    // cookie is the only thing that survives the full redirect chain out to
    // Google/Facebook/Twitter and back, so it's how we thread this one bit through.
    oauthPlatform?: 'native';
  }
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// Deep link scheme the Android app registers (AndroidManifest.xml intent-filter) —
// lets the OAuth callback hand control back to the app instead of stranding the
// user in the system browser it was opened in (see SCRUM native SSO fix).
const APP_SCHEME = process.env.APP_SCHEME ?? 'com.genxcrm.app://';

function markNativeIfRequested(req: Request): void {
  if (req.query?.platform === 'native') {
    req.session.oauthPlatform = 'native';
  }
}

function ssoErrorRedirect(req: Request, res: Response): void {
  const target =
    req.session?.oauthPlatform === 'native'
      ? `${APP_SCHEME}auth/callback?error=sso`
      : `${FRONTEND_URL}/login?error=sso`;
  res.redirect(target);
}

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleOAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    markNativeIfRequested(req);
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      this.logger.error('Google OAuth error', err);
      ssoErrorRedirect(req, context.switchToHttp().getResponse<Response>());
      return false;
    }
  }
}

@Injectable()
export class FacebookOAuthGuard extends AuthGuard('facebook') {
  private readonly logger = new Logger(FacebookOAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    markNativeIfRequested(req);
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      this.logger.error('Facebook OAuth error', err);
      ssoErrorRedirect(req, context.switchToHttp().getResponse<Response>());
      return false;
    }
  }
}

@Injectable()
export class TwitterOAuthGuard extends AuthGuard('twitter') {
  private readonly logger = new Logger(TwitterOAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    markNativeIfRequested(req);
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      this.logger.error('Twitter OAuth error', err);
      ssoErrorRedirect(req, context.switchToHttp().getResponse<Response>());
      return false;
    }
  }
}
