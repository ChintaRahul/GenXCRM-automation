import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useProductivity,
  useSourcePerformance,
  useTeamLeaderboard,
} from "../../../hooks/useReports";
import { useTeams } from "../../../hooks/useTeams";
import { rupeeShort, productivityToCSV } from "../../../lib/format";
import { saveFile } from "../../../lib/platform";
import { progressColor, repHealth, REP_HEALTH_LABEL, REP_HEALTH_CLASSES } from "../../../lib/reports";
import { cn } from "../../../lib/utils";
import { StatCard } from "../../shared/StatCard";
import { Skeleton } from "../../ui/skeleton";
import { Avatar, AvatarFallback } from "../../ui/avatar";
import { MobileCard, MobileCardRow } from "../../shared/DataCards";
import { TeamPerformanceFilterBar, quickRange, type TeamPerformanceFilters } from "./TeamPerformanceFilterBar";

// Builds a deep link into /leads scoped to a rep and, optionally, one of the
// quick filters that mirror this table's metrics (see leads.service.ts).
// Carries the report's own date range through so the Leads page count for
// the quick filter matches the number shown in this table — without this,
// following a column count while a date range is applied lands on an
// unfiltered Leads view, showing a different (larger) count.
function repLeadsLink(
  repId: string,
  dateRange: { from?: string; to?: string },
  quickFilter?: "notEngaged" | "untouched" | "followupOverdue",
) {
  const params = new URLSearchParams({ assignedToId: repId });
  if (quickFilter) params.set(quickFilter, "1");
  if (dateRange.from) params.set("createdAfter", dateRange.from);
  if (dateRange.to) params.set("createdBefore", dateRange.to);
  return `/leads?${params.toString()}`;
}

// Every rep's leaking leads (untouched or still open) — same definition as the productivity table.
function leadsLeakingLink(dateRange: { from?: string; to?: string }) {
  const params = new URLSearchParams({ leaking: "1" });
  if (dateRange.from) params.set("createdAfter", dateRange.from);
  if (dateRange.to) params.set("createdBefore", dateRange.to);
  return `/leads?${params.toString()}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--popover-border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--popover-foreground))",
};
const tooltipTextStyle = { color: "hsl(var(--popover-foreground))" };

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  void saveFile(blob, filename);
}

export function TeamPerformanceSection() {
  const [filters, setFiltersState] = useState<TeamPerformanceFilters>({ repSearch: "", ...quickRange("month") });
  const setFilters = (next: Partial<TeamPerformanceFilters>) =>
    setFiltersState((prev) => ({ ...prev, ...next }));

  const { teams } = useTeams();
  const query = { from: filters.from, to: filters.to, teamId: filters.teamId };
  const { data: productivityData, loading: productivityLoading } = useProductivity(query);
  const { data: sourcePerfData, loading: sourceLoading } = useSourcePerformance(query);
  const { data: leaderboardData, loading: leaderboardLoading } = useTeamLeaderboard(query);

  const loading = productivityLoading || sourceLoading || leaderboardLoading;
  const productivity = productivityData ?? [];
  const sourcePerf = sourcePerfData ?? [];
  const leaderboard = leaderboardData ?? [];

  const search = filters.repSearch.trim().toLowerCase();
  const filteredProductivity = search
    ? productivity.filter((r) => r.repName.toLowerCase().includes(search))
    : productivity;

  const teamsWithTarget = leaderboard.filter((t) => t.target > 0);
  const avgTargetPct =
    teamsWithTarget.length > 0
      ? teamsWithTarget.reduce((sum, t) => sum + Math.min((t.revenueCollected / t.target) * 100, 100), 0) /
        teamsWithTarget.length
      : 0;
  const totalRevenue = leaderboard.reduce((sum, t) => sum + t.revenueCollected, 0);
  const revenueGoal = leaderboard.reduce((sum, t) => sum + t.target, 0);
  const totalLeadsAll = leaderboard.reduce((sum, t) => sum + t.total, 0);
  const totalEnrolledAll = leaderboard.reduce((sum, t) => sum + t.enrolled, 0);
  const avgConversion = totalLeadsAll > 0 ? (totalEnrolledAll / totalLeadsAll) * 100 : 0;
  const leadsLeaking = productivity.reduce((sum, r) => sum + r.leaking, 0);

  const handleExport = () => {
    downloadCSV(
      productivityToCSV(filteredProductivity),
      `team-productivity-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  return (
    <div className="space-y-6">
      <TeamPerformanceFilterBar filters={filters} setFilters={setFilters} teams={teams} onExport={handleExport} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Team Target"
          value={`${Math.round(avgTargetPct)}%`}
          icon={null}
          loading={loading}
          subtitle="avg across teams"
          progress={{ pct: avgTargetPct, colorClass: "bg-primary" }}
          topBorderColor="border-t-primary"
        />
        <StatCard
          title="Revenue MTD"
          value={rupeeShort(totalRevenue)}
          icon={null}
          loading={loading}
          subtitle={revenueGoal > 0 ? `${rupeeShort(revenueGoal)} goal` : "no target set"}
          progress={{ pct: revenueGoal > 0 ? (totalRevenue / revenueGoal) * 100 : 0, colorClass: "bg-success" }}
          topBorderColor="border-t-success"
        />
        <StatCard
          title="Avg Conversion"
          value={`${avgConversion.toFixed(1)}%`}
          icon={null}
          loading={loading}
          subtitle="leads → enrolled"
          progress={{ pct: avgConversion, colorClass: "bg-[hsl(var(--chart-1))]" }}
          topBorderColor="border-t-[hsl(var(--chart-1))]"
        />
        <StatCard
          title="Leads Leaking"
          value={leadsLeaking}
          icon={null}
          loading={loading}
          subtitle="untouched + overdue"
          progress={{ pct: Math.min(leadsLeaking, 100), colorClass: "bg-destructive" }}
          topBorderColor="border-t-destructive"
          to={leadsLeakingLink({ from: filters.from, to: filters.to })}
        />
      </div>

      {/* Productivity Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Sales Rep Productivity</h3>
          <span className="text-xs text-muted-foreground">{filteredProductivity.length} reps</span>
        </div>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Rep", "Status", "Total", "Not Engaged", "Untouched", "Overdue", "7-day trend", "Target"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading && filteredProductivity.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No data available
                  </td>
                </tr>
              )}
              {!loading &&
                filteredProductivity.map((r) => {
                  const health = repHealth(r);
                  const maxTrend = Math.max(...r.trend, 1);
                  const targetPct = r.target > 0 ? Math.min((r.revenueCollected / r.target) * 100, 100) : 0;
                  return (
                    <tr key={r.repId} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={repLeadsLink(r.repId, { from: filters.from, to: filters.to })} className="flex items-center gap-2 group w-fit">
                          <Avatar className="w-7 h-7 flex-shrink-0">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                              {initials(r.repName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground whitespace-nowrap group-hover:underline group-hover:text-primary">
                            {r.repName}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-[10.5px] font-bold px-2 py-1 rounded-full whitespace-nowrap",
                            REP_HEALTH_CLASSES[health],
                          )}
                        >
                          {REP_HEALTH_LABEL[health]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground tabular-nums">
                        <Link to={repLeadsLink(r.repId, { from: filters.from, to: filters.to })} className="hover:underline hover:text-primary">
                          {r.total}
                        </Link>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {r.notEngaged > 0 ? (
                          <Link
                            to={repLeadsLink(r.repId, { from: filters.from, to: filters.to }, "notEngaged")}
                            className="text-warning font-medium hover:underline"
                          >
                            {r.notEngaged}
                          </Link>
                        ) : (
                          <span className="text-foreground">{r.notEngaged}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {r.untouched > 0 ? (
                          <Link
                            to={repLeadsLink(r.repId, { from: filters.from, to: filters.to }, "untouched")}
                            className="text-destructive font-medium hover:underline"
                          >
                            {r.untouched}
                          </Link>
                        ) : (
                          <span className="text-foreground">{r.untouched}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground tabular-nums">
                        {r.followupOverdue > 0 ? (
                          <Link
                            to={repLeadsLink(r.repId, { from: filters.from, to: filters.to }, "followupOverdue")}
                            className="hover:underline hover:text-primary"
                          >
                            {r.followupOverdue}
                          </Link>
                        ) : (
                          r.followupOverdue
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-end gap-[2px] h-[22px]">
                          {r.trend.map((v, i) => (
                            <div
                              key={i}
                              className="w-[5px] rounded-[1px] bg-primary/60"
                              style={{ height: `${Math.max((v / maxTrend) * 100, 6)}%` }}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 min-w-[120px]">
                        {r.target > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", progressColor(targetPct))}
                                style={{ width: `${targetPct}%` }}
                              />
                            </div>
                            <span className="text-[10.5px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {targetPct.toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10.5px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Mobile productivity cards — same data as the table above */}
        <div className="md:hidden p-4 space-y-2">
          {loading &&
            [...Array(4)].map((_, i) => (
              <MobileCard key={i}>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-full mt-2" />
              </MobileCard>
            ))}
          {!loading && filteredProductivity.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No data available</p>
          )}
          {!loading &&
            filteredProductivity.map((r) => {
              const health = repHealth(r);
              return (
                <MobileCard key={r.repId}>
                  <div className="flex items-center justify-between">
                    <Link to={repLeadsLink(r.repId, { from: filters.from, to: filters.to })} className="flex items-center gap-2 group w-fit min-w-0">
                      <Avatar className="w-7 h-7 flex-shrink-0">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                          {initials(r.repName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground truncate group-hover:underline group-hover:text-primary">
                        {r.repName}
                      </span>
                    </Link>
                    <span
                      className={cn(
                        "text-[10.5px] font-bold px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0",
                        REP_HEALTH_CLASSES[health],
                      )}
                    >
                      {REP_HEALTH_LABEL[health]}
                    </span>
                  </div>
                  <MobileCardRow label="Total Leads">
                    <Link to={repLeadsLink(r.repId, { from: filters.from, to: filters.to })} className="hover:underline hover:text-primary">
                      {r.total}
                    </Link>
                  </MobileCardRow>
                  <MobileCardRow label="Not Engaged">
                    {r.notEngaged > 0 ? (
                      <Link to={repLeadsLink(r.repId, { from: filters.from, to: filters.to }, "notEngaged")} className="text-warning font-medium hover:underline">
                        {r.notEngaged}
                      </Link>
                    ) : (
                      <span className="text-foreground">{r.notEngaged}</span>
                    )}
                  </MobileCardRow>
                  <MobileCardRow label="Untouched">
                    {r.untouched > 0 ? (
                      <Link
                        to={repLeadsLink(r.repId, { from: filters.from, to: filters.to }, "untouched")}
                        className="text-destructive font-medium hover:underline"
                      >
                        {r.untouched}
                      </Link>
                    ) : (
                      <span className="text-foreground">{r.untouched}</span>
                    )}
                  </MobileCardRow>
                  <MobileCardRow label="Followup Overdue">
                    {r.followupOverdue > 0 ? (
                      <Link
                        to={repLeadsLink(r.repId, { from: filters.from, to: filters.to }, "followupOverdue")}
                        className="hover:underline hover:text-primary"
                      >
                        {r.followupOverdue}
                      </Link>
                    ) : (
                      r.followupOverdue
                    )}
                  </MobileCardRow>
                  {r.target > 0 && (
                    <MobileCardRow label="Target">
                      {Math.min((r.revenueCollected / r.target) * 100, 100).toFixed(0)}%
                    </MobileCardRow>
                  )}
                </MobileCard>
              );
            })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        {/* Conversion by Source */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Conversion by Source</h3>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : sourcePerf.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {sourcePerf.map((s) => {
                const maxTotal = Math.max(...sourcePerf.map((r) => r.total), 1);
                const totalPct = Math.round((s.total / maxTotal) * 100);
                const enrolledOfTotalPct = s.total > 0 ? Math.round((s.enrolled / s.total) * 100) : 0;
                return (
                  <div key={s.source}>
                    <div className="flex justify-between mb-1 text-[11.5px]">
                      <span className="font-semibold text-foreground">{s.source}</span>
                      <span className="font-mono text-muted-foreground">
                        {s.enrolled} / {s.total}
                      </span>
                    </div>
                    <div className="h-[9px] rounded-full bg-muted overflow-hidden flex">
                      <div className="h-full bg-chart-1" style={{ width: `${totalPct}%` }} />
                    </div>
                    <div
                      className="h-[5px] mt-[3px] rounded-full bg-muted overflow-hidden"
                      style={{ width: `${totalPct}%` }}
                    >
                      <div className="h-full bg-chart-2" style={{ width: `${enrolledOfTotalPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
              No source data yet
            </div>
          )}
        </div>

        {/* Team Leaderboard */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Team Leaderboard</h3>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No team data yet</p>
          ) : (
            <div className="space-y-0">
              {[...leaderboard]
                .sort((a, b) => b.enrolled - a.enrolled)
                .map((t, i) => {
                  const denominator = t.target > 0 ? t.target : t.total;
                  const pct = denominator > 0 ? Math.min((t.enrolled / denominator) * 100, 100) : 0;
                  return (
                    <div key={t.teamId} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                      <span
                        className={cn(
                          "text-lg font-bold w-6 text-center flex-shrink-0",
                          i === 0 ? "text-amber-500" : "text-muted-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">{t.teamName}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.total} leads · {t.enrolled} enrolled
                        </p>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                          <div
                            className={cn("h-full rounded-full", progressColor(pct))}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-sm text-foreground tabular-nums">
                          {rupeeShort(t.revenueCollected)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">MTD</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

