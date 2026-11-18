import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { getStageStats } from "../api/client";
import { startOfMonthISO } from "../lib/utils";

interface StageStat {
  stage: string;
  _count: { stage: number };
}

interface LeadStatsCtx {
  /** Per-stage counts scoped to whatever filters were last passed to refresh(). */
  stats: StageStat[];
  /** Sum of `stats` — reflects the same filters as `stats` (used by the stage chip row). */
  total: number;
  /** Always unfiltered — total org/role-scoped lead count. */
  orgTotal: number;
  /** Always scoped to the current calendar month, regardless of Leads page filters — used by the sidebar badge. */
  mtdTotal: number;
  loading: boolean;
  refresh: (params?: Record<string, unknown>) => void;
}

const LeadStatsContext = createContext<LeadStatsCtx>(null!);

export function LeadStatsProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<StageStat[]>([]);
  const [orgTotal, setOrgTotal] = useState(0);
  const [mtdTotal, setMtdTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (params?: Record<string, unknown>) => {
    setLoading(true);
    try {
      // Always fetch the unfiltered and MTD totals alongside the (possibly
      // filtered) stage stats — the sidebar badge must never move when the
      // Leads page filters do.
      const [filtered, unfiltered, mtd] = await Promise.all([
        getStageStats(params),
        getStageStats(),
        getStageStats({ createdAfter: startOfMonthISO() }),
      ]);
      setStats(Array.isArray(filtered) ? filtered : []);
      setOrgTotal(
        Array.isArray(unfiltered)
          ? unfiltered.reduce((sum, s) => sum + s._count.stage, 0)
          : 0,
      );
      setMtdTotal(
        Array.isArray(mtd) ? mtd.reduce((sum, s) => sum + s._count.stage, 0) : 0,
      );
    } catch {
      /* leave the last-known stats in place on a transient error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const total = stats.reduce((sum, s) => sum + s._count.stage, 0);

  return (
    <LeadStatsContext.Provider
      value={{ stats, total, orgTotal, mtdTotal, loading, refresh }}
    >
      {children}
    </LeadStatsContext.Provider>
  );
}

export const useLeadStats = () => useContext(LeadStatsContext);
