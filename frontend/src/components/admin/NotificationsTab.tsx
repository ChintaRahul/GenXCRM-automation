import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "../settings/Switch";
import { SettingsCard } from "../settings/SettingsCard";
import { ComingSoonBadge } from "../shared/AdminStatusBadges";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { NotificationSettings } from "../../types";

const ROWS: {
  key: Exclude<keyof NotificationSettings, "followUpReminders">;
  label: string;
  description: string;
  comingSoon?: boolean;
  emailOnly?: boolean;
}[] = [
  {
    key: "newLeadAssigned",
    label: "New lead assigned",
    description: "Notify when a lead is assigned to you",
  },
  {
    key: "dailyDigest",
    label: "Daily performance digest",
    description: "A daily summary of your team's activity",
    comingSoon: true,
  },
  {
    key: "paymentReceived",
    label: "Payment received alerts",
    description: "Notify when a payment is received",
  },
  {
    key: "leadIngestionFailures",
    label: "Lead import failures",
    description:
      "Email directors when Facebook/Instagram leads fail to import (at most every 8 hours)",
    emailOnly: true,
  },
  {
    key: "trialEndingReminders",
    label: "Trial ending reminders",
    description: "Reminders as your trial period ends",
    comingSoon: true,
  },
  {
    key: "weeklyPerformanceSummary",
    label: "Weekly performance summary",
    description: "A weekly rollup of team performance",
    comingSoon: true,
  },
];

interface NotificationsTabProps {
  notifications: NotificationSettings;
  canEdit: boolean;
  onSave: (value: NotificationSettings) => Promise<void>;
}

export function NotificationsTab({
  notifications,
  canEdit,
  onSave,
}: NotificationsTabProps) {
  const [form, setForm] = useState(notifications);
  const [saving, setSaving] = useState(false);

  async function toggle(
    key: Exclude<keyof NotificationSettings, "followUpReminders">,
    channel: "email" | "inApp",
    value: boolean,
  ) {
    const merged = { ...form, [key]: { ...form[key], [channel]: value } };
    setForm(merged);
    setSaving(true);
    try {
      await onSave(merged);
      toast.success(Messages.admin.notificationsSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Notification preferences"
      description="Choose how you hear about each event."
    >
      <div className="grid grid-cols-[1fr_56px_56px] sm:grid-cols-[1fr_72px_72px] items-center gap-x-2 bg-card-subtle px-4 py-2 text-xs sm:px-5 font-medium text-muted-foreground">
        <span>Event</span>
        <span className="text-center">Email</span>
        <span className="text-center">In-app</span>
      </div>
      {ROWS.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[1fr_56px_56px] sm:grid-cols-[1fr_72px_72px] items-center gap-x-2 px-4 py-3 sm:px-5"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13.5px] font-medium text-foreground">
                {row.label}
              </p>
              {row.comingSoon && <ComingSoonBadge />}
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              {row.description}
            </p>
          </div>
          {(["email", "inApp"] as const).map((channel) => (
            <div key={channel} className="flex justify-center">
              {!(row.emailOnly && channel === "inApp") && (
                <Switch
                  checked={form[row.key][channel]}
                  disabled={!canEdit || saving || row.comingSoon}
                  onCheckedChange={(v) => toggle(row.key, channel, v)}
                  aria-label={`${row.label} ${channel === "email" ? "email" : "in-app"}`}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </SettingsCard>
  );
}
