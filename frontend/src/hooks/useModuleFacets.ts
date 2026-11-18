import { useEffect, useState } from "react";
import { getModuleFacets, type ModuleFacets } from "../api/modules";

// Live filter-option counts for a module list, over the search-filtered set. `facets` stays null
// when the module has no filters (the backend 404s), which hides the Filters UI entirely.
export function useModuleFacets(moduleKey: string, search: string) {
  const [facets, setFacets] = useState<ModuleFacets | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getModuleFacets(moduleKey, { search: search || undefined });
        if (!cancelled) setFacets(result);
      } catch {
        if (!cancelled) setFacets(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, search]);

  return { facets };
}
