import { loadErrorMessage } from "../lib/loadError";
import { useEffect, useState } from "react";
import { getModuleTable, type TableTabData } from "../api/modules";

export function useModuleTable(moduleKey: string, id: string, tabKey: string) {
  const [data, setData] = useState<TableTabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleTable(moduleKey, id, tabKey);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(loadErrorMessage(err, "Failed to load table data"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, id, tabKey]);

  return { data, loading, error, setData };
}
