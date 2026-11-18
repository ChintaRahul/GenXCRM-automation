import { LoadError } from "../shared/LoadError";
import { useSourceStats } from "../../hooks/useReports";
import { Skeleton } from "../ui/skeleton";

const CHART_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];

interface LeadSourcesCardProps {
  dailyInflow?: number[];
}

function spark(values: number[], w = 200, h = 36, pad = 2): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function inflowDelta(
  values: number[],
): { pct: string; up: boolean } | null {
  if (values.length < 14) return null;
  const recent = values.slice(-7).reduce((a, b) => a + b, 0);
  const prev = values.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (prev === 0) return null;
  const change = ((recent - prev) / prev) * 100;
  return { pct: `${Math.abs(change).toFixed(1)}%`, up: change >= 0 };
}

export function LeadSourcesCard({ dailyInflow = [] }: LeadSourcesCardProps) {
  const { data: rawSources, loading, error, refetch } = useSourceStats();

  const sources = (
    (
      rawSources as
        | { source: string; _count: { source: number } }[]
        | null
    ) ?? []
  ).map((s, i) => ({
    name: s.source
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    value: s._count.source,
    cv: CHART_VARS[i % CHART_VARS.length],
  }));

  const total = sources.reduce((acc, s) => acc + s.value, 0);

  let cumPct = 0;
  const segments = sources.map((s) => {
    const pct = total > 0 ? (s.value / total) * 100 : 0;
    const offset = 25 - cumPct;
    cumPct += pct;
    return { ...s, pct, offset };
  });

  const sparkPath = spark(dailyInflow);
  const sparkFill = sparkPath
    ? `${sparkPath} L200,36 L0,36 Z`
    : "";
  const delta = inflowDelta(dailyInflow);

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <p className="text-sm font-semibold text-foreground">Lead sources</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-4">
        Last 30 days
      </p>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error ? (
        <LoadError message={error} onRetry={refetch} className="h-48 justify-center" />
      ) : sources.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          No data yet
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <svg
              width="120"
              height="120"
              viewBox="0 0 42 42"
              className="flex-shrink-0"
            >
              {segments.map((s) => (
                <circle
                  key={s.name}
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="transparent"
                  stroke={`hsl(var(${s.cv}))`}
                  strokeWidth="6"
                  strokeDasharray={`${s.pct} ${100 - s.pct}`}
                  strokeDashoffset={s.offset}
                />
              ))}
              <text
                x="21"
                y="20"
                textAnchor="middle"
                fontSize="6"
                fill="hsl(var(--foreground))"
                fontWeight="700"
              >
                {total.toLocaleString()}
              </text>
              <text
                x="21"
                y="25.5"
                textAnchor="middle"
                fontSize="3"
                fill="hsl(var(--muted-foreground))"
              >
                total
              </text>
            </svg>

            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              {segments.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ background: `hsl(var(${s.cv}))` }}
                  />
                  <span className="text-xs text-foreground flex-1 truncate">
                    {s.name}
                  </span>
                  <span className="text-xs text-muted-foreground font-semibold tabular-nums">
                    {Math.round(s.pct)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {dailyInflow.length > 0 && (
            <div className="mt-4 pt-3.5 border-t border-card-border">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[11px] text-muted-foreground">
                  Daily inflow
                </span>
                {delta && (
                  <span
                    className={
                      delta.up
                        ? "text-[11px] font-semibold text-green-600 dark:text-green-400"
                        : "text-[11px] font-semibold text-red-600 dark:text-red-400"
                    }
                  >
                    {delta.up ? "↑" : "↓"} {delta.pct}
                  </span>
                )}
              </div>
              <svg
                width="100%"
                height="36"
                viewBox="0 0 200 36"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="sparkGrad"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity="0.4"
                    />
                    <stop
                      offset="100%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                {sparkFill && (
                  <path d={sparkFill} fill="url(#sparkGrad)" />
                )}
                <path
                  d={sparkPath}
                  stroke="hsl(var(--primary))"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </div>
          )}
        </>
      )}
    </div>
  );
}
