import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMfaSetup } from "../hooks/useMfaSetup";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Spinner } from "../components/ui/Spinner";
import { saveFile } from "../lib/platform";

function AuthShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="relative bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel and close"
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

// Handles two entry paths with one page:
//  - forced enrollment at login (no session yet; setupToken comes via
//    location.state, set by Login.tsx when the org enforces MFA)
//  - self-service enrollment (already signed in; navigated here from
//    AccountDialog, calls initMfaSetup itself to get a token + QR)
export default function MfaSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const { init, getSetupInfo, verify, loading, error } = useMfaSetup();
  const [code, setCode] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const forcedState = location.state as
    | { setupToken?: string; qrCodeDataUrl?: string; secret?: string }
    | null;
  const forcedSetupToken = forcedState?.setupToken ?? null;
  const [setupToken, setSetupToken] = useState<string | null>(forcedSetupToken);

  // Forced (org-enforced, reached from login — no session was ever granted):
  // cancelling just abandons setup and returns to the login screen; the next
  // login attempt hits the same gate again, nothing was bypassed. Self-service
  // (already signed in, reached via a button click from wherever the user
  // was — Account dialog, Administration, etc.): cancelling goes back to that
  // page rather than always landing on the dashboard — nothing was persisted
  // since verify() never ran.
  const handleCancel = () => (forcedSetupToken ? navigate("/login", { replace: true }) : navigate(-1));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedSetupToken]);

  useEffect(() => {
    if (forcedSetupToken) {
      // login() already minted the secret + QR for the forced path — use them
      // directly instead of calling init() again, which would mint a different secret.
      // The OAuth redirect path only carries the setupToken itself (no route-state
      // payload — see auth.controller.ts's oauthRedirectTarget), so fetch the rest.
      if (forcedState?.qrCodeDataUrl) {
        setQrCodeDataUrl(forcedState.qrCodeDataUrl);
        setSecret(forcedState.secret ?? null);
        return;
      }
      let cancelled = false;
      void getSetupInfo(forcedSetupToken).then((result) => {
        if (cancelled || !result) return;
        setQrCodeDataUrl(result.qrCodeDataUrl);
        setSecret(result.secret);
      });
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    void init().then((result) => {
      if (cancelled || !result) return;
      setSetupToken(result.setupToken);
      setQrCodeDataUrl(result.qrCodeDataUrl);
      setSecret(result.secret);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!setupToken) return;
    const result = await verify(setupToken, code);
    if (result) {
      signIn(result.token, result.user);
      setRecoveryCodes(result.recoveryCodes);
    }
  }

  // Forced enrollment has nowhere to go back to (no session existed before
  // this page) — land on the dashboard. Self-service enrollment came from
  // somewhere (Security tab, Account dialog) — return there.
  function finishSetup() {
    if (forcedSetupToken) {
      navigate("/", { replace: true });
    } else {
      navigate(-1);
    }
  }

  async function downloadRecoveryCodes() {
    if (!recoveryCodes) return;
    const csv = ["Recovery code", ...recoveryCodes].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    await saveFile(blob, "genxcrm-recovery-codes.csv");
  }

  if (!setupToken || (loading && !qrCodeDataUrl && !forcedState?.qrCodeDataUrl)) {
    return (
      <AuthShell onClose={handleCancel}>
        <div className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      </AuthShell>
    );
  }

  if (recoveryCodes) {
    return (
      <AuthShell onClose={finishSetup}>
        <h1 className="text-xl font-semibold text-foreground mb-1">Save your recovery codes</h1>
        <p className="text-sm text-muted-foreground mb-6">
          If you lose access to your authenticator app, you can use one of these one-time codes to
          sign in instead. Save them somewhere safe — you won't be able to see them again.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-6 font-mono text-sm bg-muted/40 border border-card-border rounded-lg p-4">
          {recoveryCodes.map((rc) => (
            <span key={rc} className="text-foreground">{rc}</span>
          ))}
        </div>
        <div className="space-y-3">
          <Button type="button" variant="outline" className="w-full" onClick={() => void downloadRecoveryCodes()}>
            <Download className="w-4 h-4 mr-2" />
            Download codes (.csv)
          </Button>
          <Button type="button" className="w-full" onClick={finishSetup}>
            Continue
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell onClose={handleCancel}>
      <h1 className="text-xl font-semibold text-foreground mb-1">Set up two-factor authentication</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {forcedSetupToken
          ? "Your organization requires two-factor authentication. Scan this QR code with an authenticator app (like Google Authenticator or Authy), then enter the 6-digit code it shows."
          : "Scan this QR code with an authenticator app (like Google Authenticator or Authy), then enter the 6-digit code it shows to finish setup."}
      </p>

      {qrCodeDataUrl ? (
        <div className="flex justify-center mb-4">
          <img src={qrCodeDataUrl} alt="Two-factor authentication QR code" className="w-40 h-40" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">
          Open your authenticator app and scan the QR code shown when you started this setup.
        </p>
      )}
      {secret && (
        <p className="text-xs text-muted-foreground text-center mb-4 break-all">
          Can't scan it? Enter this code manually: <span className="font-mono">{secret}</span>
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
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
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
          {loading ? "Verifying…" : "Verify and enable"}
        </Button>
        <button
          type="button"
          onClick={handleCancel}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          {forcedSetupToken ? "Cancel and back to sign in" : "Cancel"}
        </button>
      </form>
    </AuthShell>
  );
}
