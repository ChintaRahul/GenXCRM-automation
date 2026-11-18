import { Link } from "react-router-dom";
import { StatCard } from "../../shared/StatCard";
import { Skeleton } from "../../ui/skeleton";
import { cn } from "../../../lib/utils";
import { rupeeShort } from "../../../lib/format";
import { useMfgTeam } from "../../../hooks/useMfgDashboard";
import { REGISTRY } from "../../../modules/registry";

// Every lead status, so the list shows finished leads too (a bare Leads list hides them) and its
// count equals the dashboard's "created this month".
const ALL_LEAD_STATUSES = (REGISTRY.leads.statuses ?? []).map((s) => s.value).join(",");
const LEADS_THIS_MONTH = `/leads?datePreset=mtd&status=${encodeURIComponent(ALL_LEAD_STATUSES)}`;

function pctColor(pct: number): string {
  return pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-primary" : "bg-amber-500";
}

export function TeamView() {
  const { data, loading, error } = useMfgTeam();

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error || !data) return <p className="text-sm text-destructive py-8 text-center">{error ?? "Couldn't load the team view."}</p>;

  const { kpis, funnel, aging, teamPerformance, pendingApprovals, overduePayments } = data;
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="space-y-5">
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))" }}>
        <StatCard
          title="Target vs achieved (month)"
          to="/opportunities?status=Won"
          value={kpis.targetVsAchievement.month.target > 0 ? `${kpis.targetVsAchievement.month.pct}%` : "No target"}
          icon={null}
          subtitle={`${rupeeShort(kpis.targetVsAchievement.month.achieved)} of ${rupeeShort(kpis.targetVsAchievement.month.target)} · quarter ${kpis.targetVsAchievement.quarter.pct}%`}
        />
        <StatCard title="New leads" to={LEADS_THIS_MONTH} value={kpis.newLeads} icon={null} subtitle={`${kpis.qualificationRatePct}% qualification rate`} />
        <StatCard title="Qualified leads" to="/leads?status=Qualified&datePreset=mtd" value={kpis.qualifiedLeads} icon={null} />
        <StatCard title="Active pipeline" to="/opportunities" value={rupeeShort(kpis.activePipeline)} icon={null} />
        <StatCard title="Weighted pipeline" to="/opportunities" value={rupeeShort(kpis.weightedPipeline)} icon={null} subtitle="Value × stage probability" />
        <StatCard title="Quotations issued" to="/quotations?datePreset=mtd" value={kpis.quotationsIssued.count} icon={null} subtitle={`${kpis.quotationsIssued.revised} revised`} />
        <StatCard title="PO booked" to="/purchase-orders" value={rupeeShort(kpis.poBooked.value)} icon={null} subtitle={`${kpis.poBooked.count} PO(s)`} />
        <StatCard
          title="Won / Lost"
          to="/opportunities?status=Won"
          value={`${kpis.wonLost.won} / ${kpis.wonLost.lost}`}
          icon={null}
          subtitle={`${kpis.wonLost.winRatePct}% win rate · ${rupeeShort(kpis.wonLost.wonValue)} won`}
        />
        <StatCard
          title="Outstanding"
          to="/payments"
          value={rupeeShort(kpis.outstanding.amount)}
          icon={null}
          subtitle={`${rupeeShort(kpis.outstanding.overdueAmount)} overdue (${kpis.outstanding.overdueCount})`}
        />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,520px),1fr))" }}>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <h3 className="text-sm font-semibold">Conversion funnel</h3>
          <p className="text-xs text-muted-foreground mb-3">This month only: leads created this month, and the deals created this month that reached each step. The lists show all time, so their counts are higher.</p>
          <div className="space-y-2">
            {funnel.map((step) => (
              <div key={step.label} className="flex items-center gap-2 text-xs">
                {step.label === "Leads" ? (
                  <Link to={LEADS_THIS_MONTH} className="w-28 truncate text-muted-foreground underline-offset-2 hover:underline" title="Open this month's leads">
                    {step.label}
                  </Link>
                ) : (
                  <span className="w-28 truncate text-muted-foreground">{step.label}</span>
                )}
                <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded flex items-center justify-end pr-1.5 text-[10px] text-primary-foreground"
                    style={{ width: `${Math.max(12, Math.round((step.count / maxFunnel) * 100))}%` }}
                  >
                    {step.count}
                  </div>
                </div>
                <span className="w-10 text-right text-muted-foreground">{step.conversionPct !== null ? `${step.conversionPct}%` : ""}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-3">Opportunity aging</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium pb-2">Stage group</th>
                {aging[0]?.buckets.map((b) => (
                  <th key={b.bucket} className="text-center font-medium pb-2">{b.bucket}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aging.map((row) => (
                <tr key={row.group}>
                  <td className="py-1 pr-2 truncate max-w-[140px]" title={row.group}>{row.group}</td>
                  {row.buckets.map((b, i) => (
                    <td key={b.bucket} className="text-center py-1">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-7 h-7 rounded",
                          b.count === 0 ? "bg-muted/40 text-muted-foreground" : i >= 2 ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary",
                        )}
                      >
                        {b.count || ""}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Team performance</h3>
          </div>
          <div className="divide-y divide-card-border max-h-[360px] overflow-y-auto">
            {teamPerformance.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No reps with a target set.</p>}
            {teamPerformance.map((rep) => (
              <div key={rep.userId} className="px-4 py-2.5 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{rep.name}</span>
                  <span className="text-xs text-muted-foreground">{rep.overdueCount ? `${rep.overdueCount} overdue` : "None"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full", pctColor(rep.pct))} style={{ width: `${Math.min(100, rep.pct)}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono text-xs">{rep.pct}%</span>
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                  <span>Pipeline {rupeeShort(rep.pipeline)} · {rep.quotesOut} quotes out</span>
                  <span>{rupeeShort(rep.booked)} / {rupeeShort(rep.target)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Pending approvals</h3>
          </div>
          <div className="divide-y divide-card-border">
            {pendingApprovals.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing pending.</p>}
            {pendingApprovals.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={a.title}>{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.type} · {a.currentApprover ?? "Unassigned"}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(a.requestedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Overdue payments</h3>
          </div>
          <div className="divide-y divide-card-border">
            {overduePayments.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing overdue.</p>}
            {overduePayments.map((p) => (
              <Link key={p.id} to="/payments" className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.accountName} · {p.milestone}</p>
                  <p className="text-xs text-muted-foreground">Due {new Date(p.dueDate).toLocaleDateString()}</p>
                </div>
                <span className="font-mono text-destructive shrink-0">{rupeeShort(p.amount)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
