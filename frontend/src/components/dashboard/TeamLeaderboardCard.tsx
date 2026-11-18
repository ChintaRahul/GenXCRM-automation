import { LoadError } from "../shared/LoadError";
import { cn } from "../../lib/utils";
import { useTeamLeaderboard } from "../../hooks/useReports";
import { rupeeShort } from "../../lib/format";
import { progressColor } from "../../lib/reports";
import { Skeleton } from "../ui/skeleton";

interface LeaderboardEntry {
  teamId: string;
  teamName: string;
  total: number;
  enrolled: number;
  conversionRate: number;
  target?: number;
  revenueCollected?: number;
}

export function TeamLeaderboardCard() {
  const { data, loading, error, refetch } = useTeamLeaderboard();
  const entries = (data as LeaderboardEntry[] | null) ?? [];

  const monthLabel = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Team leaderboard
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Enrolled this month
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary">
          {monthLabel}
        </span>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={refetch} className="py-8" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No team data yet
        </p>
      ) : (
        <div className="space-y-3.5">
          {entries.map((entry, i) => {
            // A target of 0 means "no target configured" (schema default) — fall back to
            // total leads as the denominator and show conversion rate, same as when the
            // field is entirely absent.
            const hasTarget = (entry.target ?? 0) > 0;
            const denominator = hasTarget ? (entry.target as number) : entry.total;
            const pct = Math.min(
              denominator > 0 ? (entry.enrolled / denominator) * 100 : 0,
              100,
            );
            return (
              <div key={entry.teamId}>
                <div className="flex items-center gap-2.5 mb-1.5">
                  <div
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0",
                      i === 0
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </div>
                  <p className="flex-1 text-xs font-medium text-foreground truncate">
                    {entry.teamName}
                  </p>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <span className="font-semibold text-foreground">
                      {entry.enrolled}
                    </span>
                    /{denominator}
                  </span>
                </div>
                <div className="ml-7 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      progressColor(pct),
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="ml-7 mt-1 flex justify-between items-center">
                  <p className="text-[10px] text-muted-foreground/70">
                    {pct.toFixed(0)}%{" "}
                    {hasTarget ? "to target" : "conversion rate"}
                  </p>
                  {entry.revenueCollected !== undefined && (
                    <p className="text-[10px] text-muted-foreground/70 tabular-nums">
                      {rupeeShort(entry.revenueCollected)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
