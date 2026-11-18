import { useCallback, useEffect, useState } from "react";
import { getColumnPrefs, saveColumnPrefs } from "../api/modules";
import type { ModuleColumn } from "../modules/registry";

export function useColumnPrefs(moduleKey: string, allColumns: readonly ModuleColumn[]) {
  const [visibleKeys, setVisibleKeys] = useState<string[]>(allColumns.map((c) => c.key));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const saved = await getColumnPrefs(moduleKey);
        // `null` means "no preference saved yet" (fall back to every column visible);
        // `[]` is a deliberately-saved "hide every column" and must be respected as-is.
        if (!cancelled) setVisibleKeys(saved === null ? allColumns.map((c) => c.key) : saved);
      } catch {
        if (!cancelled) setVisibleKeys(allColumns.map((c) => c.key));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allColumns is a stable module-def array, not per-render
  }, [moduleKey]);

  const persistColumnPrefs = useCallback(
    async (next: string[]) => {
      try {
        await saveColumnPrefs(moduleKey, next);
      } catch {
        // Best-effort persistence — visible state is already updated locally,
        // so a failed save just means the preference won't survive a reload.
      }
    },
    [moduleKey],
  );

  const toggleColumn = useCallback(
    (key: string) => {
      // Compute `next` outside the state updater and persist it separately —
      // calling saveColumnPrefs from inside setVisibleKeys' updater would fire
      // it twice under React StrictMode's dev-mode double-invocation.
      const next = visibleKeys.includes(key) ? visibleKeys.filter((k) => k !== key) : [...visibleKeys, key];
      setVisibleKeys(next);
      void persistColumnPrefs(next);
    },
    [visibleKeys, persistColumnPrefs],
  );

  return { visibleKeys, toggleColumn, loading };
}
