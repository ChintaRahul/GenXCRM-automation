import { useEffect, useState } from "react";
import { getModuleList } from "../api/modules";

// This month's Manufacturing leads for the sidebar badge. Refetches when `refreshKey` changes
// (the sidebar passes the route) so the count follows leads created or archived while navigating.
export function useMfgLeadsMtd(enabled: boolean, refreshKey: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      try {
        const result = await getModuleList("leads", { page: 1, limit: 1, datePreset: "mtd" });
        if (!cancelled) setCount(result.total);
      } catch {
        /* keep the last-known count on a transient error or a 403 */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  return count;
}
