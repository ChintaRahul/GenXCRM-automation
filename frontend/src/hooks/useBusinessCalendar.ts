import { useCallback, useEffect, useState } from "react";
import { getModuleList, updateModuleRecord, type ModuleRecord } from "../api/modules";

export interface BusinessCalendarDay {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  isOpen: boolean;
  from: string;
  to: string;
}

export interface BusinessCalendarRecord extends ModuleRecord {
  timezone: string;
  days: BusinessCalendarDay[];
}

// One BusinessCalendar row per org (seeded by manufacturing-defaults). Fetches the first
// (only) row rather than exposing a list — there is nothing to paginate.
export function useBusinessCalendar() {
  const [calendar, setCalendar] = useState<BusinessCalendarRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleList("businessCalendar", { page: 1, limit: 1 });
        if (cancelled) return;
        setCalendar((result.data[0] as BusinessCalendarRecord) ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load the business calendar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const save = useCallback(
    async (days: BusinessCalendarDay[]) => {
      if (!calendar) return;
      await updateModuleRecord("businessCalendar", calendar.id, { days });
      refresh();
    },
    [calendar, refresh],
  );

  return { calendar, loading, error, save };
}
