import { loadErrorMessage } from "../lib/loadError";
import { useEffect, useState } from "react";
import { getModuleRelated, type ModuleRecord } from "../api/modules";

export function useModuleRelated(parentModuleKey: string, parentId: string, tabKey: string) {
  const [records, setRecords] = useState<ModuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleRelated(parentModuleKey, parentId, tabKey, { page: 1, limit: 20 });
        if (!cancelled) setRecords(result.data);
      } catch (err) {
        if (!cancelled) setError(loadErrorMessage(err, "Failed to load related records"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [parentModuleKey, parentId, tabKey]);

  return { records, loading, error };
}
