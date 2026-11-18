import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { useMfaSetup } from "../../hooks/useMfaSetup";
import { cn } from "../../lib/utils";

interface MfaInlineSetupProps {
  readonly onCancel: () => void;
}

interface SetupInfo {
  readonly setupToken: string;
  readonly qrCodeDataUrl: string;
  readonly secret: string;
}

// Inline 3-step two-factor enrolment: install an app → scan the QR → confirm a 6-digit code.
// Uses the same /auth/mfa/setup endpoints as the full-page flow; on success it swaps in the
// fresh session (signIn) and shows the one-time recovery codes.
export const MfaInlineSetup = ({ onCancel }: MfaInlineSetupProps) => {
  const { signIn } = useAuth();
  const { init, verify, loading, error } = useMfaSetup();
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void init().then((result) => {
      if (!cancelled && result) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, [init]);

  const handleVerify = async () => {
    if (!info) return;
    const result = await verify(info.setupToken, code);
    if (!result) return;
    signIn(result.token, result.user);
    setRecoveryCodes(result.recoveryCodes);
  };

  if (recoveryCodes) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-card-subtle p-4">
        <p className="text-sm font-semibold text-foreground">Two-factor is on — save your recovery codes</p>
        <p className="text-xs text-muted-foreground">
          Each code works once if you lose your authenticator. You won't be able to see them again.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-3 font-mono text-sm text-foreground">
          {recoveryCodes.map((rc) => (
            <span key={rc}>{rc}</span>
          ))}
        </div>
        <Button size="sm" onClick={onCancel}>
          Done
        </Button>
      </div>
    );
  }

  const steps = [
    {
      title: "Install an authenticator app",
      body: <p className="text-xs text-muted-foreground">Google Authenticator, Authy or Microsoft Authenticator all work.</p>,
    },
    {
      title: "Scan this QR code",
      body: info ? (
        <div className="space-y-2">
          <img src={info.qrCodeDataUrl} alt="Two-factor authentication QR code" className="h-36 w-36 rounded-lg bg-white p-1" />
          <p className="break-all text-xs text-muted-foreground">
            Can't scan? Enter this key: <span className="font-mono text-foreground">{info.secret}</span>
          </p>
        </div>
      ) : (
        <Spinner size="sm" />
      ),
    },
    {
      title: "Enter the 6-digit code",
      body: (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              aria-label="6-digit code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-[120px] font-mono tracking-widest"
            />
            <Button size="sm" disabled={loading || !info || code.length !== 6} onClick={() => void handleVerify()}>
              {loading ? "Verifying…" : "Verify & turn on"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ),
    },
  ];

  return (
    <ol className="rounded-lg border border-border bg-card-subtle p-4">
      {steps.map(({ title, body }, i) => (
        <li key={title} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-[11px] font-semibold text-primary-text">
              {i + 1}
            </span>
            <span className={cn("w-0.5 flex-1 bg-border", i === steps.length - 1 && "bg-transparent")} />
          </div>
          <div className={cn("min-w-0 flex-1 space-y-1.5", i < steps.length - 1 && "pb-4")}>
            <p className="pt-1 text-[13.5px] font-medium text-foreground">{title}</p>
            {body}
          </div>
        </li>
      ))}
    </ol>
  );
};
