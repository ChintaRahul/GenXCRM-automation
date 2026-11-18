import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type VerifyCallback } from 'passport-google-oauth20';

export interface OAuthProfile {
  provider: 'google' | 'facebook' | 'twitter';
  providerId: string;
  email: string;
  name: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID ?? 'not-configured',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? 'not-configured',
      callbackURL: `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: { id: string; displayName: string; emails?: { value: string }[] },
    done: VerifyCallback,
  ) {
    const oauthProfile: OAuthProfile = {
      provider: 'google',
      providerId: profile.id,
      email: profile.emails?.[0]?.value ?? '',
      name: profile.displayName,
    };
    done(null, oauthProfile);
  }
}
