import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsRow, SwitchRow } from "../settings/SettingsRow";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { RoutingSettings, Team } from "../../types";

const SOURCES: { key: keyof RoutingSettings["sourceRouting"]; label: string }[] = [
  { key: "facebookInstagram", label: "Facebook / Instagram" },
  { key: "googleAds", label: "Google Ads" },
  { key: "website", label: "Website" },
  { key: "referral", label: "Referral" },
  { key: "walkIn", label: "Walk-in" },
];

const UNASSIGNED = "__unassigned__";

interface RoutingTabProps {
  routing: RoutingSettings;
  teams: Team[];
  canEdit: boolean;
  onSave: (value: RoutingSettings) => Promise<void>;
}

export function RoutingTab({ routing, teams, canEdit, onSave }: RoutingTabProps) {
  const [form, setForm] = useState(routing);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
      toast.success(Messages.admin.routingSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof RoutingSettings>(key: K, value: RoutingSettings[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Assignment engine"
        description="How new leads are handed to your sales reps."
        footer={
          <Button onClick={save} disabled={!canEdit || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      >
        <SwitchRow
          label="Auto-assign new leads"
          helper="Leads sit unassigned without it"
          checked={form.autoAssign}
          disabled={!canEdit}
          onCheckedChange={(v) => set("autoAssign", v)}
        />
        <SwitchRow label="Skip weekends" checked={form.skipWeekends} disabled={!canEdit} onCheckedChange={(v) => set("skipWeekends", v)} />
        <SwitchRow
          label="Always on (24 hours)"
          helper="Assign leads any time of day — ignores the hours below"
          checked={form.alwaysOn}
          disabled={!canEdit}
          onCheckedChange={(v) => set("alwaysOn", v)}
        />
        <SettingsRow label="Working hours start" htmlFor="working-start">
          <Input
            id="working-start"
            type="time"
            className="w-[120px]"
            value={form.workingHoursStart}
            disabled={!canEdit || form.alwaysOn}
            onChange={(e) => set("workingHoursStart", e.target.value)}
          />
        </SettingsRow>
        <SettingsRow label="Working hours end" htmlFor="working-end">
          <Input
            id="working-end"
            type="time"
            className="w-[120px]"
            value={form.workingHoursEnd}
            disabled={!canEdit || form.alwaysOn}
            onChange={(e) => set("workingHoursEnd", e.target.value)}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Source → team routing" description="Send leads from each source to a specific team.">
        {SOURCES.map((source) => (
          <SettingsRow key={source.key} label={source.label}>
            <Select
              value={form.sourceRouting[source.key] || UNASSIGNED}
              disabled={!canEdit}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  sourceRouting: { ...f.sourceRouting, [source.key]: v === UNASSIGNED ? "" : v },
                }))
              }
            >
              <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned pool</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        ))}
      </SettingsCard>
    </div>
  );
}
