import { loadErrorMessage } from "../lib/loadError";
import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import {
  getModuleRecord, performModuleAction, archiveModuleRecord, updateModuleRecord, type ModuleRecord,
} from "../api/modules";

export function useModuleRecord(moduleKey: string, id: string) {
  const [record, setRecord] = useState<ModuleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setForbidden(false);
      setNotFound(false);
      try {
        const result = await getModuleRecord(moduleKey, id);
        if (!cancelled) setRecord(result);
      } catch (err) {
        if (cancelled) return;
        setForbidden(axios.isAxiosError(err) && err.response?.status === 403);
        setNotFound(axios.isAxiosError(err) && err.response?.status === 404);
        setError(loadErrorMessage(err, "Failed to load record"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, id, refreshTick]);

  // An action/save response is the bare row: it lacks derived fields such as the SLA state, which
  // the record read adds. Show the response straight away, then swap in the full record.
  const showUpdated = useCallback(
    async (updated: ModuleRecord) => {
      setRecord(updated);
      try {
        setRecord(await getModuleRecord(moduleKey, id));
      } catch {
        // the response is already on screen; a failed re-read must not undo a successful action
      }
    },
    [moduleKey, id],
  );

  const runAction = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      await showUpdated(await performModuleAction(moduleKey, id, action, payload));
    },
    [moduleKey, id, showUpdated],
  );

  const archive = useCallback(async () => {
    await archiveModuleRecord(moduleKey, id);
  }, [moduleKey, id]);

  const save = useCallback(
    async (data: Record<string, unknown>) => {
      await showUpdated(await updateModuleRecord(moduleKey, id, data));
    },
    [moduleKey, id, showUpdated],
  );

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // Fold fields the page already knows into the loaded record (e.g. just-saved line items), without a reload.
  const patchRecord = useCallback((fields: Record<string, unknown>) => setRecord((r) => (r ? { ...r, ...fields } : r)), []);

  return { record, loading, error, forbidden, notFound, runAction, archive, save, refresh, patchRecord };
}
