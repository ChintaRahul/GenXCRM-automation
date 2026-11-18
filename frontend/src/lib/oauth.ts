import { getMe } from "../api/client";
import type { User } from "../types";

export interface OAuthCallbackParams {
  token: string | null;
  needsSetup: boolean;
  error: string | null;
  // Set instead of `token` when the SSO user still needs to clear the MFA gate
  // (see backend auth.controller.ts's oauthRedirectTarget) — mfaChallengeToken
  // for an already-enrolled user, mfaSetupToken when the org enforces MFA and
  // they haven't enrolled yet.
  mfaChallengeToken: string | null;
  mfaSetupToken: string | null;
}

// Shared by the web /auth/callback route and the native deep-link listener —
// both receive the same query params, just delivered via a different URL
// (https://app.genxcrm.co.in/auth/callback vs com.genxcrm.app://auth/callback).
export function parseOAuthCallbackUrl(url: string): OAuthCallbackParams {
  const params = new URL(url).searchParams;
  return {
    token: params.get("token"),
    needsSetup: params.get("setup") === "1",
    error: params.get("error"),
    mfaChallengeToken: params.get("mfa") === "challenge" ? params.get("challengeToken") : null,
    mfaSetupToken: params.get("mfa") === "setup" ? params.get("setupToken") : null,
  };
}

// Exchanges the token for the signed-in user, or throws if it's invalid. Storing
// the token in localStorage before the /me call matches the API client's existing
// convention of reading the bearer token from there.
export async function completeOAuthSignIn(token: string): Promise<User> {
  localStorage.setItem("token", token);
  try {
    const user = await getMe();
    if (!user) throw new Error("no user");
    return user;
  } catch (err) {
    localStorage.removeItem("token");
    throw err;
  }
}
