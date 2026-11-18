import { loadErrorMessage } from "../lib/loadError";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getModuleList, performModuleAction, updateModuleRecord, type ModuleListParams, type ModuleRecord } from "../api/modules";
import { REGISTRY, type ModuleAction } from "../modules/registry";

function isActionVisible(action: ModuleAction, currentStatus: string): boolean {
  if (action.when) return action.when.includes(currentStatus);
  if (action.notWhen) return !action.notWhen.includes(currentStatus);
  return true;
}

export function useModuleBoard(moduleKey: string, params: Partial<ModuleListParams> = {}) {
  const moduleDef = REGISTRY[moduleKey];
  const [records, setRecords] = useState<ModuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // Serialised so a new-but-equal params object doesn't refetch on every render.
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleList(moduleKey, { ...(JSON.parse(paramsKey) as Partial<ModuleListParams>), page: 1, limit: 1000 });
        if (!cancelled) setRecords(result.data);
      } catch (err) {
        if (!cancelled) setError(loadErrorMessage(err, "Failed to load board"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, refreshTick, paramsKey]);

  const statusKey = moduleDef.statusKey ?? "status";
  const flowStatuses = moduleDef.flow ?? moduleDef.statuses.map((s) => s.value);
  const extraStatuses = moduleDef.statuses.map((s) => s.value).filter((v) => !flowStatuses.includes(v));
  const statusOrder = [...flowStatuses, ...extraStatuses];

  const columns = statusOrder.map((status) => ({
    status,
    records: records.filter((r) => String(r[statusKey] ?? "") === status),
  }));

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  const moveRecord = useCallback(
    async (record: ModuleRecord, targetStatus: string): Promise<{ needsAsk: ModuleAction } | void> => {
      const currentStatus = String(record[statusKey] ?? "");
      if (currentStatus === targetStatus) return;

      const matchedAction = (moduleDef.actions ?? []).find((a) => a.to === targetStatus);

      if (matchedAction) {
        if (!isActionVisible(matchedAction, currentStatus)) {
          toast.error(`Can't move to ${targetStatus} from ${currentStatus}.`);
          return;
        }
        if (matchedAction.ask) return { needsAsk: matchedAction };
        try {
          await performModuleAction(moduleKey, record.id, matchedAction.label, undefined);
          setRefreshTick((t) => t + 1);
        } catch {
          toast.error("Couldn't complete that action.");
        }
        return;
      }

      try {
        await updateModuleRecord(moduleKey, record.id, { [statusKey]: targetStatus });
        setRefreshTick((t) => t + 1);
      } catch {
        toast.error("Couldn't complete that action.");
      }
    },
    [moduleDef, moduleKey, statusKey],
  );

  const confirmMove = useCallback(
    async (record: ModuleRecord, action: ModuleAction, value: string, extra?: Record<string, string>) => {
      try {
        await performModuleAction(moduleKey, record.id, action.label, { ...extra, [action.ask!.key]: value });
      } catch {
        toast.error("Couldn't complete that action.");
      } finally {
        setRefreshTick((t) => t + 1);
      }
    },
    [moduleKey],
  );

  return { columns, loading, error, moveRecord, confirmMove, refresh };
}
