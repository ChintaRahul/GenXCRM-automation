import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsRow } from "../settings/SettingsRow";
import { updateMe } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";

// Your own profile (name, password), surfaced inside Administration for
// convenience — the same data as the Account dialog (header avatar menu),
// just reachable without leaving this page. Not gated by canEdit: it's
// personal, not org data. Two-factor authentication setup lives only in the
// Security tab (single source of truth) — not duplicated here.
export function ProfileTab() {
  const { user, updateUser, signIn } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Parameters<typeof updateMe>[0] = { name };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const { token, ...updatedUser } = await updateMe(payload);
      // A password change reissues a token (it invalidates other sessions) —
      // sign back in with it so this tab isn't logged out too.
      if (token) {
        signIn(token, { ...updatedUser, org: user?.org });
      } else {
        updateUser({ ...updatedUser, org: user?.org });
      }
      setCurrentPassword("");
      setNewPassword("");
      toast.success(Messages.account.saved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.account.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Your profile"
      description="Your name and password. Changing the password signs out your other sessions."
      footer={
        <Button onClick={handleSave} disabled={saving || !name}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      }
    >
      <SettingsRow label="Name" htmlFor="profile-name">
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
      </SettingsRow>
      <SettingsRow label="Email" htmlFor="profile-email">
        <Input id="profile-email" type="email" value={user?.email ?? ""} readOnly disabled className="cursor-not-allowed opacity-70" />
      </SettingsRow>
      <SettingsRow label="Current password" htmlFor="profile-current-pw">
        <Input
          id="profile-current-pw"
          type="password"
          autoComplete="off"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Required to set a new password"
        />
      </SettingsRow>
      <SettingsRow label="New password" htmlFor="profile-new-pw">
        <Input
          id="profile-new-pw"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Leave blank to keep current"
        />
      </SettingsRow>
    </SettingsCard>
  );
}
