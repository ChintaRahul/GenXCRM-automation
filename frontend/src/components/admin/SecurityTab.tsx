import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsRow, SwitchRow } from "../settings/SettingsRow";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { MfaStatusCard } from "../shared/MfaStatusCard";
import { ComingSoonBadge } from "../shared/AdminStatusBadges";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { SecuritySettings, SsoProvider } from "../../types";

const SESSION_TIMEOUT_MIN_MINUTES = 5;
const SESSION_TIMEOUT_MAX_MINUTES = 7 * 24 * 60; // 7 days

type TimeoutUnit = "minutes" | "hours" | "days";

const TIMEOUT_UNIT_MINUTES: Record<TimeoutUnit, number> = { minutes: 1, hours: 60, days: 1440 };

const TIMEOUT_UNITS: { value: TimeoutUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

// Rounds to 2 decimals so switching units on an oddly-sized stored value
// (e.g. a legacy 90-minute setting viewed in Days) doesn't show long
// floating-point noise.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const SSO_PROVIDERS: { value: SsoProvider; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "GOOGLE_WORKSPACE", label: "Google Workspace" },
  { value: "MICROSOFT_ENTRA", label: "Microsoft Entra ID" },
  { value: "OKTA_SAML", label: "Okta (SAML)" },
];

interface SecurityTabProps {
  security: SecuritySettings;
  canEdit: boolean;
  onSave: (value: SecuritySettings) => Promise<void>;
}

export function SecurityTab({ security, canEdit, onSave }: SecurityTabProps) {
  const [form, setForm] = useState(security);
  const [savingPolicy, setSavingPolicy] = useState(false);
  // Opens in the largest unit that shows the stored value as a whole number (60 min -> 1 hour, not 0.04 days).
  const [timeoutUnit, setTimeoutUnit] = useState<TimeoutUnit>(() =>
    security.sessionTimeoutMinutes % TIMEOUT_UNIT_MINUTES.days === 0
      ? "days"
      : security.sessionTimeoutMinutes % TIMEOUT_UNIT_MINUTES.hours === 0
        ? "hours"
        : "minutes",
  );

  async function savePolicy() {
    if (
      form.sessionTimeoutMinutes < SESSION_TIMEOUT_MIN_MINUTES ||
      form.sessionTimeoutMinutes > SESSION_TIMEOUT_MAX_MINUTES
    ) {
      toast.error(Messages.admin.invalidSessionTimeout);
      return;
    }
    setSavingPolicy(true);
    try {
      await onSave(form);
      toast.success(Messages.admin.securitySaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveMfa(next: Partial<SecuritySettings>) {
    const merged = { ...form, ...next };
    setForm(merged);
    try {
      await onSave(merged);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Password policy"
        description="Rules applied whenever someone sets a password."
        footer={
          <Button onClick={savePolicy} disabled={!canEdit || savingPolicy}>
            {savingPolicy ? "Saving…" : "Save changes"}
          </Button>
        }
      >
        <SettingsRow label="Minimum length" htmlFor="pw-min-length">
          <Input
            id="pw-min-length"
            type="number"
            min={6}
            className="w-20"
            value={form.passwordMinLength}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, passwordMinLength: Number(e.target.value) }))}
          />
          <span className="text-[12.5px] text-muted-foreground">characters</span>
        </SettingsRow>
        <SettingsRow label="Session timeout" htmlFor="session-timeout" helper="Between 5 minutes and 7 days.">
          <Input
            id="session-timeout"
            type="number"
            min={round2(SESSION_TIMEOUT_MIN_MINUTES / TIMEOUT_UNIT_MINUTES[timeoutUnit])}
            max={round2(SESSION_TIMEOUT_MAX_MINUTES / TIMEOUT_UNIT_MINUTES[timeoutUnit])}
            value={round2(form.sessionTimeoutMinutes / TIMEOUT_UNIT_MINUTES[timeoutUnit])}
            disabled={!canEdit}
            className="w-20"
            onChange={(e) => {
              const minutes = Math.round(Number(e.target.value) * TIMEOUT_UNIT_MINUTES[timeoutUnit]);
              setForm((f) => ({ ...f, sessionTimeoutMinutes: minutes }));
            }}
          />
          <Select value={timeoutUnit} disabled={!canEdit} onValueChange={(v) => setTimeoutUnit(v as TimeoutUnit)}>
            <SelectTrigger className="w-[92px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEOUT_UNITS.map((u) => (
                <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SwitchRow
          label="Require a number"
          checked={form.requireNumber}
          disabled={!canEdit}
          onCheckedChange={(v) => setForm((f) => ({ ...f, requireNumber: v }))}
        />
        <SwitchRow
          label="Require a symbol"
          checked={form.requireSymbol}
          disabled={!canEdit}
          onCheckedChange={(v) => setForm((f) => ({ ...f, requireSymbol: v }))}
        />
      </SettingsCard>

      <SettingsCard title="Multi-factor authentication" description="An authenticator-app code as a second step at login.">
        <SettingsRow label="Your account" helper="Personal to your own login.">
          <div className="w-full">
            <MfaStatusCard inlineSetup />
          </div>
        </SettingsRow>
        <SwitchRow
          label="Enable MFA"
          helper="Users can turn on an authenticator app for their own login"
          checked={form.mfaEnabled}
          disabled={!canEdit}
          onCheckedChange={(v) => saveMfa({ mfaEnabled: v, mfaEnforced: v ? form.mfaEnforced : false })}
        />
        <SwitchRow
          label="Enforce MFA for all users"
          helper="Block login until MFA is set up. Requires MFA enabled above."
          checked={form.mfaEnforced}
          disabled={!canEdit || !form.mfaEnabled}
          onCheckedChange={(v) => saveMfa({ mfaEnforced: v })}
        />
      </SettingsCard>

      <SettingsCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            Single sign-on <ComingSoonBadge />
          </span>
        }
        description="Sign in with Google Workspace, Microsoft Entra ID, or Okta (SAML) isn't available yet — it needs a connection to your identity provider. Contact support to be notified when it ships."
      >
        <SettingsRow label="Identity provider">
          <Select value={form.ssoProvider} disabled>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SSO_PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled>Connect</Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
