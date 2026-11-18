import { useEffect, useState } from "react";
import { getModuleEvents } from "../../api/modules";

interface Run {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly description?: string;
}

// The "Run history" of one automation rule, shown under its edit form: when it ran, whether it
// worked, and what it did (or why it failed).
export function AutomationRunHistory({ ruleId }: { readonly ruleId: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setRuns(null);
    setFailed(false);
    getModuleEvents("automationRules", ruleId, "runs")
      .then((rows) => live && setRuns(rows as Run[]))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [ruleId]);

  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="run-history">
      <h3 className="mb-3 text-sm font-semibold">Run history</h3>
      {failed && <p className="text-sm text-destructive">Couldn't load the run history.</p>}
      {!failed && runs === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {runs?.length === 0 && <p className="text-sm text-muted-foreground">This rule hasn't run yet.</p>}
      <ul className="divide-y divide-border">
        {runs?.map((run) => (
          <li key={run.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <span className={run.label === "OK" ? "font-medium text-green-600" : "font-medium text-destructive"}>{run.label}</span>
              {run.description && (
                <p className="truncate text-xs text-muted-foreground" title={run.description}>
                  {run.description}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{new Date(run.at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
