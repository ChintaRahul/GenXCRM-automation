import { loadErrorMessage } from "../lib/loadError";
import { useEffect, useState } from "react";
import { getModuleAudit, type AuditEntry } from "../api/modules";

export function useModuleAudit(moduleKey: string, id: string) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleAudit(moduleKey, id);
        if (!cancelled) setEntries(result);
      } catch (err) {
        if (!cancelled) setError(loadErrorMessage(err, "Failed to load audit trail"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, id]);

  return { entries, loading, error };
}
