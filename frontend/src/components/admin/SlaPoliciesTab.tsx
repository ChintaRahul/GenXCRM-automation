import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { REGISTRY } from "../../modules/registry";
import { Switch } from "../settings/Switch";
import { SettingsCard } from "../settings/SettingsCard";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { apiErrorMessage } from "../../lib/apiError";
import { useSlaPolicies, type SlaPolicyRow, type SlaTargetRow } from "../../hooks/useSlaPolicies";

interface SlaPoliciesTabProps {
  readonly canEdit: boolean;
}

// Editable target row: time value + unit (minutes / hours / days), saved per policy.
function TargetsEditor({ policy, canEdit, onSave }: { policy: SlaPolicyRow; canEdit: boolean; onSave: (targets: SlaTargetRow[]) => Promise<void> }) {
  const [rows, setRows] = useState<SlaTargetRow[]>(policy.targets);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(rows) !== JSON.stringify(policy.targets);
  const update = (i: number, patch: Partial<SlaTargetRow>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setSaving(true);
    try {
      await onSave(rows);
      toast.success("SLA target saved.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't save the SLA target."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">Targets</div>
      <ul className="text-xs space-y-1.5">
        {rows.map((t, i) => (
          <li key={i} className="flex items-center gap-2 flex-wrap">
            <span className="min-w-0 max-w-[10rem] truncate" title={t.cond}>{t.cond}:</span>
            <Input
              type="number"
              min={1}
              className="h-8 w-20"
              value={t.val}
              disabled={!canEdit}
              aria-label={`${t.cond} target value`}
              onChange={(e) => update(i, { val: Number(e.target.value) })}
            />
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={t.unit}
              disabled={!canEdit}
              aria-label={`${t.cond} target unit`}
              onChange={(e) => update(i, { unit: e.target.value })}
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </li>
        ))}
      </ul>
      {canEdit && (
        <Button size="sm" className="mt-2" disabled={!changed || saving || rows.some((r) => !(r.val > 0))} onClick={() => void save()}>
          {saving ? "Saving…" : "Save targets"}
        </Button>
      )}
    </div>
  );
}

// README §3.6 "SLA policies": grouped-by-module rows showing name, start -> stop, target
// count, escalation-level count, and an Active switch. The full targets/escalation-level
// editor described in the design (add/remove rows, per-level channel toggles) is not built
// in this pass — policies are seeded with the 22 defaults and can be viewed and activated/
// deactivated here; editing their targets/escalation levels is a follow-up.
export function SlaPoliciesTab({ canEdit }: SlaPoliciesTabProps) {
  const { policies, loading, error, toggleActive, saveTargets, runChecksNow } = useSlaPolicies();
  const [expanded, setExpanded] = useState<string | null>(null);

  const runChecks = async (policy: SlaPolicyRow) => {
    try {
      await runChecksNow(policy);
      toast.success("SLA checks done.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't run the SLA checks."));
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  const byModule = new Map<string, SlaPolicyRow[]>();
  for (const p of policies) {
    const list = byModule.get(p.moduleKey) ?? [];
    list.push(p);
    byModule.set(p.moduleKey, list);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{policies.length}</span> policies ·{" "}
          <span className="font-medium text-foreground">{policies.filter((p) => p.isActive).length}</span> active
        </p>
        {canEdit && policies[0] && (
          <Button
            size="sm"
            variant="outline"
            title="Checks for breached SLA targets and sends the escalations now, instead of waiting for the 5-minute / hourly schedule."
            onClick={() => void runChecks(policies[0])}
          >
            Run SLA checks now
          </Button>
        )}
      </div>

      {Array.from(byModule.entries()).map(([moduleKey, list]) => (
        <SettingsCard key={moduleKey} title={REGISTRY[moduleKey]?.title ?? moduleKey}>
            {list.map((policy) => {
              const isOpen = expanded === policy.id;
              return (
                <div key={policy.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : policy.id)}
                      className="relative text-muted-foreground before:absolute before:-inset-3.5 before:content-['']"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{policy.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {policy.startEvent} → {policy.stopEvent} · {policy.calendarType}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {policy.targets.length} target{policy.targets.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {policy.escalationLevels.length} level{policy.escalationLevels.length === 1 ? "" : "s"}
                    </span>
                    <Switch
                      checked={policy.isActive}
                      disabled={!canEdit}
                      aria-label={`${policy.isActive ? "Deactivate" : "Activate"} ${policy.name}`}
                      onCheckedChange={() => void toggleActive(policy)}
                    />
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 space-y-3 bg-card-subtle">
                      <TargetsEditor policy={policy} canEdit={canEdit} onSave={(targets) => saveTargets(policy, targets)} />
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1">Escalation levels</div>
                        <ul className="text-xs space-y-0.5">
                          {policy.escalationLevels.map((l, i) => (
                            <li key={i}>
                              At {l.at}% → {l.who} ({l.channels.join(", ")})
                            </li>
                          ))}
                        </ul>
                      </div>
                      {policy.pauseStatuses.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Pauses while: {policy.pauseStatuses.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </SettingsCard>
      ))}
    </div>
  );
}
