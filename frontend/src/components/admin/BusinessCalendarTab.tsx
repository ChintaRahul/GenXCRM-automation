import { useEffect, useState } from "react";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";
import { SettingsCard } from "../settings/SettingsCard";
import { useBusinessCalendar, type BusinessCalendarDay } from "../../hooks/useBusinessCalendar";
import { AdminModuleTab } from "./AdminModuleTab";

interface BusinessCalendarTabProps {
  readonly canEdit: boolean;
}

// README §3.6 "Business hours & holidays": per-day on/off + from/to times, plus the holiday
// list. "Business hours"-calendar SLAs (sla-duration.util.ts) skip closed days and holidays.
export function BusinessCalendarTab({ canEdit }: BusinessCalendarTabProps) {
  const { calendar, loading, error, save } = useBusinessCalendar();
  const [days, setDays] = useState<BusinessCalendarDay[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (calendar) setDays(calendar.days);
  }, [calendar]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!calendar) return <p className="text-sm text-muted-foreground">No business calendar configured yet.</p>;

  function updateDay(index: number, patch: Partial<BusinessCalendarDay>) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await save(days);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title={`Business hours (${calendar.timezone})`}
        description="Business-hours SLAs skip closed days and holidays."
        footer={
          canEdit && (
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save business hours"}
            </Button>
          )
        }
      >
          {days.map((day, i) => (
            <div key={day.day} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <span className="w-10 text-sm font-medium">{day.day}</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={day.isOpen}
                  onChange={(e) => updateDay(i, { isOpen: e.target.checked })}
                />
                Open
              </label>
              {/* Times sit on their own line on a phone so both stay readable. */}
              <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-1">
              <input
                type="time"
                aria-label={`${day.day} opens at`}
                disabled={!canEdit || !day.isOpen}
                value={day.from}
                onChange={(e) => updateDay(i, { from: e.target.value })}
                className="h-8 min-w-0 max-[767px]:h-11 flex-1 rounded-md border border-input-border bg-card px-2 text-xs text-foreground"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="time"
                aria-label={`${day.day} closes at`}
                disabled={!canEdit || !day.isOpen}
                value={day.to}
                onChange={(e) => updateDay(i, { to: e.target.value })}
                className="h-8 min-w-0 max-[767px]:h-11 flex-1 rounded-md border border-input bg-background px-2 text-xs"
              />
              </div>
            </div>
          ))}
      </SettingsCard>

      <SettingsCard title="Holidays" description="Days when business-hours SLA clocks pause.">
        <AdminModuleTab moduleKey="holidays" canEdit={canEdit} />
      </SettingsCard>
    </div>
  );
}
