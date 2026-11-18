import { LoadError } from "../shared/LoadError";
import { useRevenueMonthly } from "../../hooks/usePayments";
import { rupeeShort } from "../../lib/format";
import { Skeleton } from "../ui/skeleton";

export function RevenueChartCard() {
  const { data: months, loading, error, refetch } = useRevenueMonthly(6);

  const total = (months ?? []).reduce((sum, m) => sum + m.revenue, 0);
  const max = Math.max(1, ...(months ?? []).map((m) => m.revenue));

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Revenue · last 6 months
          </p>
          <p className="font-mono text-[28px] font-bold text-foreground mt-1 tracking-tight">
            {error ? "—" : rupeeShort(total)}
          </p>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-44 w-full" />
      ) : error ? (
        <LoadError message={error} onRetry={refetch} className="h-44 justify-center" />
      ) : !months || months.length === 0 ? (
        <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
          No revenue yet
        </div>
      ) : (
        <div className="flex items-end gap-3 h-44 mt-4">
          {months.map((m) => (
            <div
              key={m.month}
              className="flex-1 flex flex-col items-center justify-end gap-1.5"
            >
              <span
                className={
                  m.isCurrent
                    ? "text-[11px] font-semibold text-chart-2"
                    : "text-[11px] font-semibold text-foreground"
                }
              >
                {rupeeShort(m.revenue)}
              </span>
              <div
                className="w-full rounded-md"
                style={{
                  height: `${Math.max(4, (m.revenue / max) * 130)}px`,
                  background: m.isCurrent
                    ? "linear-gradient(to top, hsl(var(--chart-2) / 0.5), hsl(var(--chart-2) / 0.95))"
                    : "linear-gradient(to top, hsl(var(--primary) / 0.4), hsl(var(--primary) / 0.9))",
                }}
              />
              <span className="text-[10px] text-muted-foreground">
                {m.month.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
