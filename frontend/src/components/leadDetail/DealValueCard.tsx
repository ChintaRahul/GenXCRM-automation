import type { Lead } from "../../types";

function winProbability(lead: Lead): number {
  const activityCount = lead.activities?.length ?? 0;
  return Math.min(95, Math.round(lead.score * 0.8 + activityCount * 2));
}

function probabilityColor(pct: number): string {
  if (pct >= 70) return "bg-chart-2";
  if (pct >= 40) return "bg-chart-3";
  return "bg-muted-foreground";
}

export function DealValueCard({ lead }: { lead: Lead }) {
  const payment = lead.payments?.[0];
  const probability = winProbability(lead);
  // The `activities` include is capped at 50 rows server-side, so leads with a
  // longer history will under-count here — an accepted approximation, not a bug.

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <p className="text-xs font-medium text-muted-foreground mb-1">
        Deal value
      </p>
      {payment ? (
        <>
          <p className="font-mono text-2xl font-bold text-foreground tracking-tight">
            ₹{payment.amount.toLocaleString("en-IN")}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {payment.installments.length > 1
              ? `Full · or ${payment.installments.length} × ₹${(payment.amount / payment.installments.length).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
              : "Full payment"}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No payment created yet</p>
      )}

      <div className="mt-3 pt-3 border-t border-card-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-muted-foreground">
            Win probability
          </span>
          <span className="text-xs font-semibold text-chart-2">
            {probability}%
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${probabilityColor(probability)}`}
            style={{ width: `${probability}%` }}
          />
        </div>
      </div>
    </div>
  );
}
