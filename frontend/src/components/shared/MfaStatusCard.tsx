import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MfaInlineSetup } from "./MfaInlineSetup";
import { useAuth } from "../../context/AuthContext";
import { disableMfa } from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";

interface MfaStatusCardProps {
  // Called right before navigating to /mfa-setup — e.g. to close a dialog
  // this card is rendered inside, so it isn't left open over the new route.
  onBeforeSetup?: () => void;
  // Run the 3-step setup inline instead of navigating to the full /mfa-setup page.
  inlineSetup?: boolean;
}

// Self-contained "your own two-factor authentication" status + enable/disable
// control. Reads the signed-in user directly via useAuth() rather than props,
// so it can be dropped into both the Account dialog and Administration's
// Security tab without prop drilling.
export function MfaStatusCard({ onBeforeSetup, inlineSetup }: MfaStatusCardProps) {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  const handleDisable = async () => {
    setBusy(true);
    try {
      await disableMfa(code);
      updateUser({ ...(user as NonNullable<typeof user>), mfaConfigured: false });
      toast.success(Messages.mfa.disabled);
      setDisabling(false);
      setCode("");
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.mfa.disableFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-foreground">{user?.mfaConfigured ? "Enabled" : "Not enabled"}</p>
          <p className="text-xs text-muted-foreground">
            {user?.mfaConfigured
              ? "Your account requires an authenticator code to sign in."
              : "Add an authenticator app code as a second step at login."}
          </p>
        </div>
        {user?.mfaConfigured ? (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40"
            onClick={() => setDisabling((v) => !v)}
          >
            Disable
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (inlineSetup) {
                setSettingUp(true);
                return;
              }
              onBeforeSetup?.();
              navigate("/mfa-setup");
            }}
          >
            Set up
          </Button>
        )}
      </div>
      {settingUp && <MfaInlineSetup onCancel={() => setSettingUp(false)} />}
      {disabling && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            placeholder="Current 6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="flex-1 min-w-[160px]"
          />
          <Button variant="destructive" size="sm" disabled={busy || code.length !== 6} onClick={handleDisable}>
            {busy ? "Disabling…" : "Confirm disable"}
          </Button>
        </div>
      )}
    </div>
  );
}
