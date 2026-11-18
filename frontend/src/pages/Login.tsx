import { useState } from "react";
import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { login } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { useResendVerification } from "../hooks/useResendVerification";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { isNative, openExternal } from "../lib/platform";

function GoogleIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MetaIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
        fill="#1877F2"
      />
    </svg>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // On the Android app a first-time user arrives from the welcome carousel and can go back to it.
  const fromWelcome = isNative() && (location.state as { from?: string } | null)?.from === "welcome";
  const [searchParams] = useSearchParams();
  const {
    resend,
    loading: resending,
    success: resent,
  } = useResendVerification();

  const ssoError = searchParams.get("error") === "sso";
  const registered = searchParams.get("registered") === "true";
  const reset = searchParams.get("reset") === "true";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedsVerify(false);
    setLoading(true);
    try {
      const data = await login(email, password);
      if ("mfaRequired" in data) {
        navigate("/mfa-challenge", { state: { challengeToken: data.challengeToken } });
        return;
      }
      if ("mustSetupMfa" in data) {
        navigate("/mfa-setup", {
          state: { setupToken: data.setupToken, qrCodeDataUrl: data.qrCodeDataUrl, secret: data.secret },
        });
        return;
      }
      signIn(data.token, data.user);
      navigate("/");
    } catch (err) {
      const msg = apiErrorMessage(err, Messages.auth.invalidCredentials);
      if (msg.toLowerCase().includes("verify your email")) setNeedsVerify(true);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      {fromWelcome && (
        <Link
          to="/welcome"
          aria-label="Back"
          className="fixed left-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10 flex h-11 w-11 items-center justify-center rounded-[10px] text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      <div className="w-full max-w-sm">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <a href="https://genxcrm.co.in" className="flex items-center gap-3 mb-8">
            <img
              src="/logo-mark.png"
              alt="GenX CRM"
              className="w-14 h-14 object-contain"
            />
            <div>
              <p className="font-display font-bold text-foreground">GenX CRM</p>
              <p className="text-xs text-muted-foreground">Marketing Suite</p>
            </div>
          </a>

          <h1 className="text-xl font-semibold text-foreground mb-1">
            Sign in
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Welcome back — continue to your workspace
          </p>

          {registered && (
            <p className="text-sm text-green-700 dark:text-green-400 mb-4 p-3 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg">
              Account created! Sign in to continue.
            </p>
          )}

          {reset && (
            <p className="text-sm text-green-700 dark:text-green-400 mb-4 p-3 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg">
              Password updated. Sign in with your new password.
            </p>
          )}

          {ssoError && (
            <p className="text-sm text-destructive mb-4 p-3 bg-destructive/10 rounded-lg">
              SSO sign-in failed. Please try again or use email and password.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="max-[767px]:h-11 max-[767px]:text-base"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-primary hover:underline font-medium max-[767px]:inline-flex max-[767px]:min-h-11 max-[767px]:items-center"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10 max-[767px]:h-11 max-[767px]:text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors p-0.5 max-[767px]:p-3 max-[767px]:-mr-3"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {needsVerify &&
              (resent ? (
                <p className="text-sm text-muted-foreground">
                  A new verification link is on its way — check your inbox.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void resend(email)}
                  disabled={resending}
                  className="text-sm text-primary hover:underline font-medium disabled:opacity-50"
                >
                  {resending ? "Sending…" : "Resend verification email"}
                </button>
              ))}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">
                or continue with
              </span>
            </div>
          </div>

          {/* SSO buttons — Google/Facebook/X refuse to authenticate inside an embedded
              WebView, so on native this opens the system browser instead of navigating
              the app's own WebView; the OAuth callback then deep-links back into the
              app (see useNativeOAuthCallback) instead of stranding the user in the
              browser tab. Plain links on web, where in-page navigation is correct. */}
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { provider: "google", title: "Continue with Google", Icon: GoogleIcon },
                { provider: "twitter", title: "Continue with X", Icon: XIcon },
                { provider: "facebook", title: "Continue with Meta", Icon: MetaIcon },
              ] as const
            ).map(({ provider, title, Icon }) =>
              isNative() ? (
                <button
                  key={provider}
                  type="button"
                  title={title}
                  onClick={() => void openExternal(`${API_BASE}/auth/${provider}?platform=native`)}
                  className="flex items-center justify-center h-9 max-[767px]:h-11 rounded-md border border-input bg-background hover:bg-muted transition-colors"
                >
                  <Icon />
                </button>
              ) : (
                <a
                  key={provider}
                  href={`${API_BASE}/auth/${provider}`}
                  title={title}
                  className="flex items-center justify-center h-9 max-[767px]:h-11 rounded-md border border-input bg-background hover:bg-muted transition-colors"
                >
                  <Icon />
                </a>
              ),
            )}
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link
              to="/signup"
              className="text-primary hover:underline font-medium max-[767px]:inline-flex max-[767px]:min-h-11 max-[767px]:items-center"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
