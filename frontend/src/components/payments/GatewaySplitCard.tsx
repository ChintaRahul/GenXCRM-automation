import { LoadError } from "../shared/LoadError";
import { usePaymentDashboard } from "../../hooks/usePayments";
import { rupeeShort } from "../../lib/format";
import { Skeleton } from "../ui/skeleton";

const CHART_VARS = ["--chart-1", "--chart-2", "--chart-3"];

interface GatewaySplit {
  gateway: string;
  total: number;
  pct: number;
}

export function GatewaySplitCard() {
  const { data, loading, error, refetch } = usePaymentDashboard();
  const byGateway = ((data as { byGateway?: GatewaySplit[] } | null)?.byGateway ?? [])
    .slice()
    .sort((a, b) => b.total - a.total);

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <p className="text-sm font-semibold text-foreground mb-2.5">
        Gateway split (MTD)
      </p>

      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : error ? (
        <LoadError message={error} onRetry={refetch} />
      ) : byGateway.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No payments collected yet
        </p>
      ) : (
        <>
          <div className="flex h-2 rounded overflow-hidden mb-2.5">
            {byGateway.map((g, i) => (
              <div
                key={g.gateway}
                style={{
                  flex: g.pct || 0.001,
                  background: `hsl(var(${CHART_VARS[i % CHART_VARS.length]}))`,
                }}
              />
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {byGateway.map((g, i) => (
              <div key={g.gateway} className="flex items-center gap-2 py-1">
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{
                    background: `hsl(var(${CHART_VARS[i % CHART_VARS.length]}))`,
                  }}
                />
                <span className="flex-1 text-xs text-foreground">
                  {g.gateway.charAt(0) + g.gateway.slice(1).toLowerCase()}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {rupeeShort(g.total)}
                </span>
                <span className="text-[10px] text-muted-foreground/70 w-9 text-right">
                  {g.pct}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
