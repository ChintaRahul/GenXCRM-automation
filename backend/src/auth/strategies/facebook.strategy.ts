import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-facebook';
import type { OAuthProfile } from './google.strategy';

type Done = (error: unknown, user?: OAuthProfile) => void;

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor() {
    super({
      // SSO uses the dedicated consumer "Login" app (App 2). Falls back to the Lead Ads app
      // credentials for backward compatibility with single-app setups.
      clientID: process.env.FACEBOOK_SSO_APP_ID ?? process.env.FACEBOOK_APP_ID ?? 'not-configured',
      clientSecret:
        process.env.FACEBOOK_SSO_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? 'not-configured',
      callbackURL: `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/auth/facebook/callback`,
      scope: ['email'],
      profileFields: ['id', 'displayName', 'emails'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: Done) {
    const oauthProfile: OAuthProfile = {
      provider: 'facebook',
      providerId: profile.id,
      email: profile.emails?.[0]?.value ?? '',
      name: profile.displayName,
    };
    done(null, oauthProfile);
  }
}
