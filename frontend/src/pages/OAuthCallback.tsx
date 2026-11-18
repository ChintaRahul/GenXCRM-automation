import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { parseOAuthCallbackUrl, completeOAuthSignIn } from "../lib/oauth";

export default function OAuthCallbackPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const { token, needsSetup, error, mfaChallengeToken, mfaSetupToken } = parseOAuthCallbackUrl(window.location.href);

    if (mfaChallengeToken) {
      navigate("/mfa-challenge", { state: { challengeToken: mfaChallengeToken }, replace: true });
      return;
    }
    if (mfaSetupToken) {
      navigate("/mfa-setup", { state: { setupToken: mfaSetupToken }, replace: true });
      return;
    }

    if (error || !token) {
      navigate("/login?error=sso", { replace: true });
      return;
    }

    completeOAuthSignIn(token)
      .then((user) => {
        signIn(token, user);
        navigate(needsSetup ? "/signup/complete" : "/", { replace: true });
      })
      .catch(() => {
        navigate("/login?error=sso", { replace: true });
      });
  }, [navigate, signIn]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <img src="/logo-mark.png" alt="GenX CRM" className="w-9 h-9 object-contain animate-pulse" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
