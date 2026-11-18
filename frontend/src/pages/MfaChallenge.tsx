import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLocation, useNavigate, Navigate, Link } from "react-router-dom";
import { useMfaChallenge } from "../hooks/useMfaChallenge";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function AuthShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="relative bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground hover:bg-muted rounded p-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
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

export default function MfaChallengePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const { verify, loading, error } = useMfaChallenge();
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  // No session was ever granted at this point (login() withheld it pending
  // this code) — cancelling just returns to the login screen, nothing to undo.
  const handleCancel = () => navigate("/login", { replace: true });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const challengeToken = (location.state as { challengeToken?: string } | null)?.challengeToken;
  if (!challengeToken) return <Navigate to="/login" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await verify(challengeToken as string, code);
    if (result) {
      signIn(result.token, result.user);
      navigate("/", { replace: true });
    }
  }

  return (
    <AuthShell onClose={handleCancel}>
      <h1 className="text-xl font-semibold text-foreground mb-1">Two-factor verification</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter the 6-digit code from your authenticator app to finish signing in.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">{useRecoveryCode ? "Recovery code" : "Verification code"}</Label>
          {useRecoveryCode ? (
            <Input
              id="code"
              autoComplete="off"
              maxLength={9}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-1234"
              className="tracking-widest text-center text-lg"
            />
          ) : (
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="tracking-widest text-center text-lg"
            />
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={loading || (useRecoveryCode ? code.length !== 9 : code.length !== 6)}
        >
          {loading ? "Verifying…" : "Verify and sign in"}
        </Button>
        <button
          type="button"
          onClick={() => { setUseRecoveryCode((v) => !v); setCode(""); }}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          {useRecoveryCode ? "Use an authenticator code instead" : "Use a recovery code instead"}
        </button>
        <Link
          to="/mfa-reset-request"
          className="block w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Lost access to your authenticator?
        </Link>
        <button
          type="button"
          onClick={handleCancel}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Cancel and back to sign in
        </button>
      </form>
    </AuthShell>
  );
}
