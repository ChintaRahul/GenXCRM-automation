import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Spinner } from "../components/ui/Spinner";
import { useVerifyEmail } from "../hooks/useVerifyEmail";
import { useResendVerification } from "../hooks/useResendVerification";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <div className="flex items-center gap-3 mb-8">
            <img
              src="/logo-mark.png"
              alt="GenX CRM"
              className="w-14 h-14 object-contain"
            />
            <div>
              <p className="font-display font-bold text-foreground">GenX CRM</p>
              <p className="text-xs text-muted-foreground">Marketing Suite</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { verify, status, error } = useVerifyEmail();
  const {
    resend,
    loading: resending,
    success: resent,
    error: resendError,
  } = useResendVerification();
  const [resendEmail, setResendEmail] = useState("");

  // Auto-verify once on mount when a token is present.
  const startedRef = useRef(false);
  useEffect(() => {
    if (token && !startedRef.current) {
      startedRef.current = true;
      void verify(token);
    }
  }, [token, verify]);

  if (!token) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground mb-1">
          Invalid link
        </h1>
        <p className="text-sm text-muted-foreground">
          This verification link is missing a token.
        </p>
      </AuthShell>
    );
  }

  if (status === "verifying" || status === "idle") {
    return (
      <AuthShell>
        <div className="flex items-center gap-3">
          <Spinner size="sm" />
          <p className="text-sm text-muted-foreground">Verifying your email…</p>
        </div>
      </AuthShell>
    );
  }

  if (status === "success") {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground mb-1">
          Email verified
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your email address has been confirmed. You're all set.
        </p>
        <Link
          to="/login"
          className="text-sm text-primary hover:underline font-medium"
        >
          Continue to sign in →
        </Link>
      </AuthShell>
    );
  }

  // status === "error"
  return (
    <AuthShell>
      <h1 className="text-xl font-semibold text-foreground mb-1">
        Verification failed
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {error ?? "This link is invalid or has expired."} Enter your email to
        get a new verification link.
      </p>

      {resent ? (
        <p className="text-sm text-green-700 dark:text-green-400 p-3 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg">
          If that account exists and is unverified, a new link was sent.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void resend(resendEmail);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {resendError && <p className="text-sm text-destructive">{resendError}</p>}
          <Button type="submit" className="w-full" disabled={resending}>
            {resending ? "Sending…" : "Resend verification"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="text-primary hover:underline font-medium max-[767px]:inline-flex max-[767px]:min-h-11 max-[767px]:items-center">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
