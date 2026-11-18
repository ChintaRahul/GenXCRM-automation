import type { ReactNode } from "react";
import { StatusBadge, type BadgeTone } from "../shared/StatusBadge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { LookupName } from "../../lib/lookupNames";
import { formatDate } from "../../lib/moduleCells";
import { useModuleRelated } from "../../hooks/useModuleRelated";
import { REGISTRY, type ModuleDef } from "../../modules/registry";
import type { ModuleRecord } from "../../api/modules";
import type { RecordSla } from "./SlaTab";

interface RecordSummaryRailProps {
  readonly moduleKey: string;
  readonly moduleDef: ModuleDef;
  readonly record: ModuleRecord;
  // "column" is the 300px right-hand panel; "row" wraps the cards above the tabs.
  readonly layout: "column" | "row";
  readonly onLogActivity?: () => void;
}

// True once a date has passed (before the start of today); unparsable / missing dates are not overdue.
export const isPastDate = (value: unknown, now: Date = new Date()): boolean => {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const Card = ({ title, className, children }: { title: string; className?: string; children: ReactNode }) => (
  <section className={cn("rounded-xl border border-border bg-card p-3", className)}>
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);

const NextActionCard = ({ moduleDef, record, onLogActivity }: Pick<RecordSummaryRailProps, "moduleDef" | "record" | "onLogActivity">) => {
  const next = String(record.next ?? "").trim();
  const dateKey = moduleDef.fields.some((f) => f.key === "nextDate") ? "nextDate" : null;
  const overdue = dateKey !== null && isPastDate(record[dateKey]);
  const alert = !next || overdue;
  return (
    <Card title="Next action" className={cn(alert && "border-destructive/30 bg-destructive/10")}>
      <p className={cn("text-sm font-medium", !next && "text-destructive")} title={next}>
        {next || "No next action set"}
      </p>
      {dateKey && (
        <p className={cn("mt-0.5 text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
          {record[dateKey] ? `${overdue ? "Overdue · " : ""}${formatDate(record[dateKey])}` : "Add a date so it shows in My day"}
        </p>
      )}
      {onLogActivity && (
        <Button size="sm" variant="outline" className="mt-2 max-[767px]:h-11" onClick={onLogActivity}>
          Log activity
        </Button>
      )}
    </Card>
  );
};

const RecentActivity = ({ moduleKey, moduleDef, record }: Pick<RecordSummaryRailProps, "moduleKey" | "moduleDef" | "record">) => {
  const tab = moduleDef.tabs.find((t) => t.kind === "related" && t.relatedModule === "activities");
  const { records } = useModuleRelated(moduleKey, record.id, tab?.key ?? "");
  if (!tab) return null;
  const labelKey = REGISTRY.activities?.label ?? "id";
  const recent = records.slice(0, 4);
  return (
    <Card title="Recent activity">
      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing logged yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {recent.map((a) => (
            <li key={a.id} className="min-w-0 text-xs">
              <p className="truncate font-medium" title={String(a[labelKey] ?? a.id)}>
                {String(a[labelKey] ?? a.id)}
              </p>
              <p className="truncate text-muted-foreground">
                {String(a.type ?? "")}
                {a.due ? ` · ${formatDate(a.due)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// Next action / SLA / People / Recent activity for a record page.
export const RecordSummaryRail = ({ moduleKey, moduleDef, record, layout, onLogActivity }: RecordSummaryRailProps) => {
  const sla = record.sla as RecordSla | null | undefined;
  // The first owner is already in the page's key facts line, so only further people are listed here.
  const [, ...people] = moduleDef.fields.filter((f) => f.type === "owner" && typeof record[f.key] === "string" && record[f.key]);
  const hasNext = moduleDef.fields.some((f) => f.key === "next");
  return (
    <div
      data-testid="summary-rail"
      className={cn(
        layout === "column" ? "flex w-[300px] shrink-0 flex-col gap-3" : "flex flex-wrap gap-3 [&>*]:min-w-[240px] [&>*]:flex-1 max-[767px]:flex-nowrap max-[767px]:snap-x max-[767px]:overflow-x-auto max-[767px]:[scrollbar-width:none] max-[767px]:[&::-webkit-scrollbar]:hidden max-[767px]:pb-1 max-[767px]:[&>*]:min-w-[80%] max-[767px]:[&>*]:snap-start",
      )}
    >
      {hasNext && <NextActionCard moduleDef={moduleDef} record={record} onLogActivity={onLogActivity} />}
      {sla?.l && (
        <Card title="SLA">
          <StatusBadge status={sla.l} tone={(sla.t ?? "gray") as BadgeTone} />
        </Card>
      )}
      {people.length > 0 && (
        <Card title="People">
          <ul className="space-y-1">
            {people.map((f) => (
              <li key={f.key} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="shrink-0 text-muted-foreground">{f.label}</span>
                <span className="truncate font-medium">
                  <LookupName source="owner" id={record[f.key]} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <RecentActivity moduleKey={moduleKey} moduleDef={moduleDef} record={record} />
    </div>
  );
};
