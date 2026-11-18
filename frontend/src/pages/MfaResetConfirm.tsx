import { useSearchParams, Link } from "react-router-dom";
import { useMfaResetConfirm } from "../hooks/useMfaResetConfirm";
import { Button } from "../components/ui/button";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <div className="flex items-center gap-3 mb-8">
            <img src="/logo-mark.png" alt="GenX CRM" className="w-14 h-14 object-contain" />
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

export default function MfaResetConfirmPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { submit, loading, error, success } = useMfaResetConfirm();

  if (!token) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground mb-1">Invalid link</h1>
        <p className="text-sm text-muted-foreground mb-6">
          This reset link is missing or malformed. Please request a new one.
        </p>
        <Link to="/mfa-reset-request" className="text-sm text-primary hover:underline font-medium">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground mb-1">Two-factor authentication turned off</h1>
        <p className="text-sm text-muted-foreground mb-6">
          You can now sign in with your password. You'll be able to set up two-factor authentication
          again from Account settings.
        </p>
        <Link to="/login" className="text-sm text-primary hover:underline font-medium">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold text-foreground mb-1">Reset two-factor authentication</h1>
      <p className="text-sm text-muted-foreground mb-6">
        This turns off two-factor authentication on your account so you can sign in without it,
        then set it up again.
      </p>
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      <Button className="w-full" disabled={loading} onClick={() => void submit(token)}>
        {loading ? "Resetting…" : "Reset two-factor authentication"}
      </Button>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="text-primary hover:underline font-medium">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
