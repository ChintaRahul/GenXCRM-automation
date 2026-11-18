import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type StrategyOptions } from 'passport-oauth2';
import type { OAuthProfile } from './google.strategy';

export type XProfile = { id: string; name: string; email: string };

type XMeResponse = {
  data?: { id: string; name?: string; username?: string; confirmed_email?: string };
};

type ProfileDone = (error?: Error | null, profile?: XProfile) => void;

const ME_URL = 'https://api.x.com/2/users/me?user.fields=confirmed_email';

export const twitterStrategyOptions = (): StrategyOptions => {
  const clientID = process.env.TWITTER_CLIENT_ID ?? 'not-configured';
  const clientSecret = process.env.TWITTER_CLIENT_SECRET ?? 'not-configured';
  return {
    authorizationURL: 'https://x.com/i/oauth2/authorize',
    tokenURL: 'https://api.x.com/2/oauth2/token',
    clientID,
    clientSecret,
    callbackURL: `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1/auth/twitter/callback`,
    scope: ['users.read', 'tweet.read', 'users.email'],
    pkce: true,
    state: true,
    // X confidential clients authenticate the token call with HTTP Basic.
    customHeaders: { Authorization: `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString('base64')}` },
  };
};

@Injectable()
export class TwitterStrategy extends PassportStrategy(Strategy, 'twitter') {
  constructor() {
    super(twitterStrategyOptions());
  }

  // Only confirmed_email is trusted: findOrCreateFromOAuth links accounts by email
  // and marks it verified, so an unconfirmed address must never get that far.
  userProfile(accessToken: string, done: ProfileDone): void {
    const load = async () => {
      try {
        const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
          done(new Error(`X users/me responded ${res.status}`));
          return;
        }
        const { data } = (await res.json()) as XMeResponse;
        if (!data?.id) {
          done(new Error('X users/me returned no user'));
          return;
        }
        done(null, { id: data.id, name: data.name ?? data.username ?? '', email: data.confirmed_email ?? '' });
      } catch (err) {
        done(err instanceof Error ? err : new Error('X users/me request failed'));
      }
    };
    void load();
  }

  validate(_accessToken: string, _refreshToken: string, profile: XProfile): OAuthProfile {
    return { provider: 'twitter', providerId: profile.id, email: profile.email, name: profile.name };
  }
}
