import { useCallback, useEffect, useState } from "react";
import { getModuleList, performModuleAction, updateModuleRecord, type ModuleRecord } from "../api/modules";

export interface SlaTargetRow { cond: string; val: number; unit: string; }
export interface SlaEscalationRow { at: number; who: string; channels: string[]; }

export interface SlaPolicyRow extends ModuleRecord {
  moduleKey: string;
  name: string;
  startEvent: string;
  stopEvent: string;
  calendarType: string;
  targets: SlaTargetRow[];
  escalationLevels: SlaEscalationRow[];
  pauseStatuses: string[];
  isActive: boolean;
}

export function useSlaPolicies() {
  const [policies, setPolicies] = useState<SlaPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleList("slaPolicies", { page: 1, limit: 100 });
        if (cancelled) return;
        setPolicies(result.data as SlaPolicyRow[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load SLA policies");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const toggleActive = useCallback(
    async (policy: SlaPolicyRow) => {
      await performModuleAction("slaPolicies", policy.id, policy.isActive ? "Deactivate" : "Activate");
      refresh();
    },
    [refresh],
  );

  const saveTargets = useCallback(
    async (policy: SlaPolicyRow, targets: SlaTargetRow[]) => {
      await updateModuleRecord("slaPolicies", policy.id, { targets });
      refresh();
    },
    [refresh],
  );

  // Runs the escalation check and the date-based alerts now instead of waiting for the schedule.
  const runChecksNow = useCallback(async (policy: SlaPolicyRow) => {
    await performModuleAction("slaPolicies", policy.id, "Run checks now");
  }, []);

  return { policies, loading, error, toggleActive, saveTargets, runChecksNow };
}
