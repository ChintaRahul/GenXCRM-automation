import { LoadError } from "../shared/LoadError";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import { usePipeline } from "../../hooks/useReports";
import type { PipelinePeriod } from "../../hooks/useReports";

const PERIODS: PipelinePeriod[] = ["30d", "90d", "YTD"];

interface PipelineRow {
  stage: string;
  name: string;
  value: number;
}

interface PipelineFunnelCardProps {
  stageColorVars: Record<string, string>;
}

export function PipelineFunnelCard({ stageColorVars }: PipelineFunnelCardProps) {
  const [period, setPeriod] = useState<PipelinePeriod>("30d");
  const { data: raw, loading, error, refetch } = usePipeline(period);

  const rows: PipelineRow[] = (
    (raw as { stage: string; _count: { stage: number } }[] | null) ?? []
  ).map((s) => ({
    stage: s.stage,
    name: s.stage
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    value: s._count.stage,
  }));

  const stageMax = rows.length > 0 ? Math.max(...rows.map((r) => r.value)) : 1;
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  const periodLabel = period === "YTD" ? "year to date" : `last ${period}`;

  const heroRow = rows.find((r) => r.value === stageMax) ?? null;
  const restRows = heroRow ? rows.filter((r) => r !== heroRow) : [];
  const restMax = restRows.length > 0 ? Math.max(...restRows.map((r) => r.value)) : 1;
  const heroCv = heroRow ? (stageColorVars[heroRow.stage] ?? "--chart-1") : "--chart-1";
  const heroPct = heroRow && total > 0 ? (heroRow.value / total) * 100 : 0;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Pipeline by stage
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            All teams · {periodLabel} · {total.toLocaleString()} leads
          </p>
        </div>
        <div className="flex gap-0.5 p-0.5 bg-muted rounded-md">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2.5 py-1 max-[767px]:px-3 max-[767px]:py-2 text-[11px] font-semibold rounded transition-colors",
                period === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={refetch} className="h-48 justify-center" />
      ) : rows.length === 0 || !heroRow ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          No data yet
        </div>
      ) : (
        <>
          <div
            className="rounded-[10px] p-3.5 flex items-center justify-between mb-4"
            style={{
              background: `hsl(var(${heroCv}) / 0.12)`,
              border: `1px solid hsl(var(${heroCv}) / 0.25)`,
            }}
          >
            <div>
              <p className="text-xs font-semibold text-foreground">
                {heroRow.name}
              </p>
              <p className="text-[10.5px] text-muted-foreground mt-0.5">
                Dominant stage, shown separately so it doesn't flatten the
                rest
              </p>
            </div>
            <div className="text-right flex-shrink-0 whitespace-nowrap pl-3">
              <p
                className="text-[22px] font-bold tabular-nums"
                style={{ color: `hsl(var(${heroCv}))` }}
              >
                {heroRow.value.toLocaleString()}
              </p>
              <p className="text-[10.5px] text-muted-foreground">
                {heroPct.toFixed(0)}% of pipeline
              </p>
            </div>
          </div>

          {restRows.length > 0 && (
            <>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
                Other stages, relative to each other
              </p>
              <div className="flex flex-col gap-3">
                {restRows.map((row) => {
                  const pct = (row.value / restMax) * 100;
                  const totalPct = total > 0 ? (row.value / total) * 100 : 0;
                  const cv = stageColorVars[row.stage] ?? "--chart-1";
                  return (
                    <div key={row.stage}>
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <span
                          title={row.name}
                          className="min-w-0 truncate text-xs text-foreground"
                        >
                          {row.name}
                        </span>
                        <span
                          className="flex-shrink-0 tabular-nums text-xs text-muted-foreground"
                          title="Share of all leads in this period"
                        >
                          <span className="font-semibold text-foreground">
                            {row.value.toLocaleString()}
                          </span>
                          {` · ${totalPct.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, hsl(var(${cv}) / 0.8), hsl(var(${cv})))`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
