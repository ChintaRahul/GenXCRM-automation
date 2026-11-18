import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, Clock, Users, FileText, Package, Target } from "lucide-react";
import { StatCard } from "../../shared/StatCard";
import { Skeleton } from "../../ui/skeleton";
import { Button } from "../../ui/button";
import { ActionDialog } from "../../module/ActionDialog";
import { REGISTRY } from "../../../modules/registry";
import { apiErrorMessage } from "../../../lib/apiError";
import { cn } from "../../../lib/utils";
import { rupeeShort } from "../../../lib/format";
import { useMfgMyDay } from "../../../hooks/useMfgDashboard";
import { useReadableModules } from "../../../hooks/useReadableModules";

const STATE_LABEL: Record<string, string> = { overdue: "Overdue", today: "Today", soon: "Tomorrow", later: "Later" };
const STATE_TONE: Record<string, string> = {
  overdue: "bg-destructive/10 text-destructive",
  today: "bg-amber-500/10 text-amber-600",
  soon: "bg-primary/10 text-primary",
  later: "bg-muted text-muted-foreground",
};

// A link only when the role can open the target; otherwise the same row without navigation.
function MaybeLink({ enabled, to, className, children }: { enabled: boolean; to: string; className: string; children: React.ReactNode }) {
  return enabled ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className.replace("hover:bg-accent", "")}>{children}</div>
  );
}

export function MyDayView() {
  const { data, loading, error, completeTask } = useMfgMyDay();
  const [completing, setCompleting] = useState<string | null>(null);
  // A card only links to a module this role can open (otherwise the link lands on a 403 page).
  const readable = useReadableModules();
  const canOpenDeals = !readable || readable.includes("opps");
  const linkTo = (moduleKey: string, to: string) => (!readable || readable.includes(moduleKey) ? to : undefined);
  const completeAction = REGISTRY.activities.actions?.find((a) => a.label === "Complete");

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error || !data) return <p className="text-sm text-destructive py-8 text-center">{error ?? "Couldn't load your day."}</p>;

  const { kpis, actionQueue, dealsNeedingAttention, visitsAndTrials, pipelineByPhase } = data;

  return (
    <div className="space-y-5">
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,168px),1fr))" }}>
        <StatCard
          title="Due today"
          value={kpis.dueToday}
          icon={<Clock className="w-4 h-4" />}
          subtitle={`${kpis.overdueCount} overdue`}
          to={linkTo("activities", "/activities")}
        />
        <StatCard
          title="New leads to contact"
          value={kpis.newLeadsToContact}
          icon={<Users className="w-4 h-4" />}
          subtitle={`${kpis.leadsPastSla} past response SLA`}
          to={linkTo("leads", "/leads?datePreset=all")}
        />
        <StatCard
          title="Quotes awaiting reply"
          value={kpis.quotesAwaitingReply.count}
          icon={<FileText className="w-4 h-4" />}
          subtitle={`${rupeeShort(kpis.quotesAwaitingReply.value)} in value`}
          to={linkTo("quotes", "/quotations")}
        />
        <StatCard
          title="POs expected this month"
          value={rupeeShort(kpis.posExpectedThisMonth.value)}
          icon={<Package className="w-4 h-4" />}
          subtitle={`${kpis.posExpectedThisMonth.count} deal(s)`}
          to={linkTo("opps", "/opportunities")}
        />
        <StatCard
          title="Quarter target"
          value={`${kpis.quarterTarget.pct}%`}
          icon={<Target className="w-4 h-4" />}
          subtitle={`${rupeeShort(kpis.quarterTarget.booked)} of ${rupeeShort(kpis.quarterTarget.target)} booked`}
          progress={{ pct: Math.min(100, kpis.quarterTarget.pct), colorClass: "bg-primary" }}
        />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,520px),1fr))" }}>
        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Action queue</h3>
          </div>
          <div className="divide-y divide-card-border max-h-[420px] overflow-y-auto">
            {actionQueue.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing open right now.</p>}
            {actionQueue.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium", STATE_TONE[item.state])}>
                  {STATE_LABEL[item.state]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={item.subject}>{item.subject}</p>
                  <p className="truncate text-xs text-muted-foreground" title={`${item.type} · ${item.accountName ?? ""} · ${item.opportunityTitle ?? ""}`}>
                    {item.type}
                    {item.accountName ? ` · ${item.accountName}` : ""}
                    {item.opportunityTitle ? ` · ${item.opportunityTitle}` : ""}
                  </p>
                </div>
                {completeAction?.ask && (
                  <Button size="sm" variant="outline" className="shrink-0 max-[767px]:h-11" onClick={() => setCompleting(item.id)}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Mark done
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Deals needing attention</h3>
          </div>
          <div className="divide-y divide-card-border">
            {dealsNeedingAttention.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No deals flagged.</p>}
            {dealsNeedingAttention.map((deal) => (
              <MaybeLink key={deal.id} enabled={canOpenDeals} to={`/opportunities/${deal.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={deal.title}>{deal.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{deal.accountName} · {deal.stage}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-sm">{rupeeShort(deal.value)}</p>
                  <p className="text-[10px] text-destructive">{deal.reason}</p>
                </div>
              </MaybeLink>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Visits &amp; trials this week</h3>
          </div>
          <div className="divide-y divide-card-border">
            {visitsAndTrials.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing scheduled this week.</p>}
            {visitsAndTrials.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={item.title}>{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.accountName} · {item.kind === "visit" ? "Site visit" : "Trial"}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(item.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Pipeline by stage</h3>
          </div>
          <div className="p-4 space-y-4">
            {pipelineByPhase.map((phase) => (
              <div key={phase.phase}>
                <div className="flex items-center justify-between text-xs font-medium mb-1.5">
                  <span>{phase.phase}</span>
                  <span className="font-mono text-muted-foreground">{rupeeShort(phase.total)}</span>
                </div>
                <div className="space-y-1">
                  {phase.stages.map((s) => {
                    const maxValue = Math.max(1, ...phase.stages.map((x) => x.value));
                    return (
                      <MaybeLink
                        key={s.stage}
                        enabled={canOpenDeals}
                        to={`/opportunities?status=${encodeURIComponent(s.stage)}`}
                        className="flex items-center gap-2 text-xs rounded hover:bg-accent max-[767px]:min-h-11"
                      >
                        <span className="w-32 truncate text-muted-foreground" title={s.stage}>{s.stage}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((s.value / maxValue) * 100)}%` }} />
                        </div>
                        <span className="w-16 text-right font-mono">{s.value ? rupeeShort(s.value) : "—"}</span>
                      </MaybeLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {completing && completeAction?.ask && (
        <ActionDialog
          action={completeAction}
          open
          onClose={() => setCompleting(null)}
          onConfirm={async (outcome) => {
            try {
              await completeTask(completing, outcome);
              toast.success("Marked done.");
            } catch (err) {
              toast.error(apiErrorMessage(err, "Couldn't mark that done."));
            } finally {
              setCompleting(null);
            }
          }}
        />
      )}
    </div>
  );
}
