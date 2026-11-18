import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { MfaStatusCard } from "../shared/MfaStatusCard";
import { CallLogSyncCard } from "../shared/CallLogSyncCard";
import { updateMe } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { isNative } from "../../lib/platform";
import { initials } from "../../lib/utils";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountDialog({ open, onClose }: Props) {
  const { user, updateUser, signIn } = useAuth();

  // Directors manage MFA from Administration > Security (single source of
  // truth there). Managers and Sales Reps have no other route to it yet
  // (Administration nav is Director/Manager only, and Sales Reps can't reach
  // it at all) — kept here for them as a stopgap. GST number and the
  // assignment-notification toggle live in Administration > Organization now.
  const isDirector = user?.role === "DIRECTOR";

  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setCurrentPassword("");
      setNewPassword("");
    }
  }, [open, user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Parameters<typeof updateMe>[0] = { name };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const { token, ...updatedUser } = await updateMe(payload);
      // Changing a password reissues a token (it invalidates every other
      // outstanding session) — sign back in with it so this tab isn't logged out too.
      if (token) {
        signIn(token, { ...updatedUser, org: user?.org });
      } else {
        updateUser({ ...updatedUser, org: user?.org });
      }

      toast.success(Messages.account.saved);
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.account.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 py-1">
          <Avatar className="w-11 h-11 flex-shrink-0">
            <AvatarFallback className="text-sm font-semibold bg-primary text-primary-foreground">
              {user ? initials(user.name) : "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              {user?.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {user?.role.replace(/_/g, " ")}
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Name</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">Email</Label>
            <Input
              id="acc-email"
              type="email"
              value={user?.email ?? ""}
              readOnly
              disabled
              className="cursor-not-allowed opacity-70"
            />
          </div>
        </div>

        {!isDirector && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Two-Factor Authentication
              </p>
              <MfaStatusCard onBeforeSetup={onClose} />
            </div>
          </>
        )}

        {isNative() && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Call Log Sync
              </p>
              <CallLogSyncCard />
            </div>
          </>
        )}

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Change Password
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="acc-current-pw">Current Password</Label>
            <Input
              id="acc-current-pw"
              type="password"
              autoComplete="off"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Required to set a new password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-new-pw">New Password</Label>
            <Input
              id="acc-new-pw"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
