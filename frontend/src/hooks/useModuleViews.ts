import { useCallback, useEffect, useState } from "react";
import { deleteModuleView, listModuleViews, saveModuleView } from "../api/modules";
import { normalizeStoredFilters, type ModuleFilters } from "../lib/moduleFilters";

export interface ModuleView {
  readonly id: string;
  readonly name: string;
  readonly filters: ModuleFilters;
}

// The user's own saved filter sets for a module list (stored server-side, per user).
export function useModuleViews(moduleKey: string) {
  const [views, setViews] = useState<ModuleView[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await listModuleViews(moduleKey);
        if (!cancelled) setViews(result.map((v) => ({ ...v, filters: normalizeStoredFilters(v.filters) })));
      } catch {
        if (!cancelled) setViews([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  const save = useCallback(
    async (name: string, filters: ModuleFilters) => {
      const saved = await saveModuleView(moduleKey, { name, filters: filters as unknown as Record<string, unknown> });
      const view = { ...saved, filters: normalizeStoredFilters(saved.filters) };
      setViews((prev) => [...prev.filter((v) => v.id !== view.id), view]);
    },
    [moduleKey],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteModuleView(moduleKey, id);
      setViews((prev) => prev.filter((v) => v.id !== id));
    },
    [moduleKey],
  );

  return { views, save, remove };
}
