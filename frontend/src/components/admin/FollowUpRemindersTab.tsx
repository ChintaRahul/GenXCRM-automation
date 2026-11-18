import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "../settings/Switch";
import { SettingsCard } from "../settings/SettingsCard";
import { Button } from "../ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { FollowUpReminderSettings, NotificationSettings } from "../../types";

type BooleanOption = Exclude<keyof FollowUpReminderSettings, "sendHour">;

const SEND_HOURS = [
  { value: 8, label: "8:00 AM" },
  { value: 9, label: "9:00 AM" },
  { value: 10, label: "10:00 AM" },
];

const GROUPS: { title: string; options: { key: BooleanOption; label: string }[] }[] = [
  {
    title: "Who receives it",
    options: [
      { key: "reps", label: "Sales reps (own leads)" },
      { key: "managers", label: "Managers (team summary)" },
    ],
  },
  {
    title: "Include",
    options: [
      { key: "overdue", label: "Overdue" },
      { key: "today", label: "Due today" },
    ],
  },
  {
    title: "Deliver by",
    options: [
      { key: "inApp", label: "App and phone push" },
      { key: "email", label: "Email" },
    ],
  },
];

interface FollowUpRemindersTabProps {
  notifications: NotificationSettings;
  canEdit: boolean;
  onSave: (value: NotificationSettings) => Promise<void>;
}

export function FollowUpRemindersTab({ notifications, canEdit, onSave }: FollowUpRemindersTabProps) {
  const [form, setForm] = useState(notifications.followUpReminders);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(notifications.followUpReminders);
  const optionsLocked = !canEdit || !form.enabled;

  const set = (patch: Partial<FollowUpReminderSettings>) => setForm((prev) => ({ ...prev, ...patch }));

  async function save() {
    setSaving(true);
    try {
      await onSave({ ...notifications, followUpReminders: form });
      toast.success(Messages.admin.notificationsSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Follow-up reminders"
      description="Send your team a morning digest of the leads they need to follow up. This applies to the whole organization. Off by default."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted-foreground">Only admins can change this.</p>
          <Button onClick={() => void save()} disabled={!canEdit || saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground">Daily follow-up reminders</p>
          <p className="text-[12.5px] text-muted-foreground">
            {form.enabled
              ? `On. Reminders go out every day at ${SEND_HOURS.find((h) => h.value === form.sendHour)?.label ?? "9:00 AM"}.`
              : "Off by default. Turn on to start sending reminders."}
          </p>
        </div>
        <Switch
          checked={form.enabled}
          disabled={!canEdit || saving}
          onCheckedChange={(v) => set({ enabled: v })}
          aria-label="Daily follow-up reminders"
        />
      </div>

      <div className={`space-y-5 px-4 py-4 sm:px-5 ${form.enabled ? "" : "opacity-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="follow-up-send-at" className="text-[13.5px] font-medium text-foreground">
            Send at
          </label>
          <Select
            value={String(form.sendHour)}
            onValueChange={(v) => set({ sendHour: Number(v) })}
            disabled={optionsLocked || saving}
          >
            <SelectTrigger id="follow-up-send-at" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEND_HOURS.map((h) => (
                <SelectItem key={h.value} value={String(h.value)}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <fieldset key={group.title} className="min-w-0">
              <legend className="mb-1 text-[13.5px] font-medium text-foreground">{group.title}</legend>
              {group.options.map((option) => (
                <label
                  key={option.key}
                  className="flex min-h-[44px] items-center gap-3 text-[13.5px] text-foreground sm:min-h-[36px]"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form[option.key]}
                    disabled={optionsLocked || saving}
                    onChange={(e) => set({ [option.key]: e.target.checked })}
                  />
                  <span className="min-w-0 truncate" title={option.label}>
                    {option.label}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>

        <label className="flex min-h-[44px] items-center gap-3 text-[13.5px] text-foreground sm:min-h-[36px]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={form.skipSundays}
            disabled={optionsLocked || saving}
            onChange={(e) => set({ skipSundays: e.target.checked })}
          />
          Skip Sundays and days with nothing due
        </label>
      </div>
    </SettingsCard>
  );
}
