import { loadErrorMessage } from "../lib/loadError";
import { useEffect, useState } from "react";
import { getModuleEvents, type EventItem } from "../api/modules";

export function useModuleEvents(moduleKey: string, id: string, tabKey: string) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleEvents(moduleKey, id, tabKey);
        if (!cancelled) setEvents(result);
      } catch (err) {
        if (!cancelled) setError(loadErrorMessage(err, "Failed to load events"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, id, tabKey]);

  return { events, loading, error };
}
