import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNative } from "../lib/platform";
import { parseOAuthCallbackUrl, completeOAuthSignIn } from "../lib/oauth";
import { useAuth } from "../context/AuthContext";

// Google/Facebook/X refuse to authenticate inside an embedded WebView, so SSO on
// the native app opens the system browser (see Login.tsx) and the backend's OAuth
// callback redirects to this custom scheme (com.genxcrm.app://auth/callback?...)
// instead of the web app's URL. Android hands that back to the running app as an
// "appUrlOpen" event rather than a page navigation, so it needs its own listener —
// the /auth/callback route (OAuthCallbackPage) only ever fires on the web build.
export function useNativeOAuthCallback(): void {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;

    const sub = CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      if (!url.includes("auth/callback")) return;

      void (async () => {
        const { token, needsSetup, error, mfaChallengeToken, mfaSetupToken } = parseOAuthCallbackUrl(url);
        try {
          if (mfaChallengeToken) {
            navigate("/mfa-challenge", { state: { challengeToken: mfaChallengeToken }, replace: true });
            return;
          }
          if (mfaSetupToken) {
            navigate("/mfa-setup", { state: { setupToken: mfaSetupToken }, replace: true });
            return;
          }
          if (error || !token) throw new Error(error ?? "missing token");
          const user = await completeOAuthSignIn(token);
          signIn(token, user);
          navigate(needsSetup ? "/signup/complete" : "/", { replace: true });
        } catch {
          navigate("/login?error=sso", { replace: true });
        } finally {
          // Dismiss the Custom Tab the OAuth flow ran in, now that the app has control back.
          await Browser.close().catch(() => undefined);
        }
      })();
    });

    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [navigate, signIn]);
}
