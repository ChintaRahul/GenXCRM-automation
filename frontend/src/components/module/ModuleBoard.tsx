import { useEffect, useState } from "react";
import { useModuleBoard } from "../../hooks/useModuleBoard";
import type { ModuleListParams, ModuleRecord } from "../../api/modules";
import { REGISTRY, type ModuleAction } from "../../modules/registry";
import { formatMoney } from "../../lib/moduleCells";
import { cn } from "../../lib/utils";
import { useViewportMode } from "../../hooks/useViewportMode";
import { StatusBadge, type BadgeTone } from "../shared/StatusBadge";
import { LookupName } from "../../lib/lookupNames";
import { ActionDialog } from "./ActionDialog";

// The server sends an SLA as { l: label, t: tone }.
const sla = (value: unknown) => value as { l?: string; t?: string } | null | undefined;

interface ModuleBoardProps {
  readonly moduleKey: string;
  readonly onRowClick: (record: ModuleRecord) => void;
  // Same search and filters as the list view, so both views show the same records.
  readonly search?: string;
  readonly filterParams?: Partial<ModuleListParams>;
}

export function ModuleBoard({ moduleKey, onRowClick, search, filterParams }: ModuleBoardProps) {
  const moduleDef = REGISTRY[moduleKey];
  const { columns, loading, error, moveRecord, confirmMove } =
    useModuleBoard(moduleKey, { search, ...filterParams });
  const [pending, setPending] = useState<{
    action: ModuleAction;
    record: ModuleRecord;
  } | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Phones show one stage at a time, switched with the chips above the column.
  const singleColumn = useViewportMode() === "drawer";
  const [activeStatus, setActiveStatus] = useState<string | null>(null);

  const moneyColKey = moduleDef.cols.find((c) => c.type === "money")?.key;
  const slaColKey = moduleDef.cols.find((c) => c.type === "sla")?.key;
  const ownerFieldKey = moduleDef.fields.find((f) => f.type === "owner")?.key;
  const subtitleCol = moduleDef.cols.find(
    (c) => (c.type === "ref" || c.type === "text") && c.key !== moduleDef.label,
  );
  const subtitleColKey = subtitleCol?.key;
  // A reference column holds an id, so show the referenced record's name instead.
  const subtitleRefSource =
    subtitleCol?.type === "ref" ? moduleDef.fields.find((f) => f.key === subtitleCol.key)?.ref : undefined;

  useEffect(() => {
    if (!loading) setHasLoadedOnce(true);
  }, [loading]);

  if (error)
    return (
      <p className="text-sm text-destructive py-8 text-center">
        Couldn&apos;t load the board.
      </p>
    );
  // Only replace the whole board with a full-page loader on the very first
  // load — on subsequent refreshes (after a move) keep the existing board
  // mounted so the DOM doesn't get torn down and scroll position doesn't reset.
  if (loading && !hasLoadedOnce)
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
    );

  async function handleDrop(record: ModuleRecord, targetStatus: string) {
    // moveRecord never rejects — every internal branch catches its own errors
    // and surfaces a toast — so this await can't produce an unhandled rejection.
    const outcome = await moveRecord(record, targetStatus);
    if (outcome?.needsAsk) setPending({ action: outcome.needsAsk, record });
  }

  async function handleConfirmPending(value: string, extra?: Record<string, string>) {
    if (!pending) return;
    await confirmMove(pending.record, pending.action, value, extra);
    setPending(null);
  }

  const shownStatus = activeStatus ?? columns[0]?.status;
  const shownColumns = singleColumn
    ? columns.filter((c) => c.status === shownStatus)
    : columns;

  return (
    <div className={singleColumn ? "space-y-3" : undefined}>
      {singleColumn && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Stages"
        >
          {columns.map((col) => (
            <button
              key={col.status}
              type="button"
              role="tab"
              aria-selected={col.status === shownStatus}
              onClick={() => setActiveStatus(col.status)}
              className={cn(
                "h-11 px-4 rounded-full text-sm font-medium border shrink-0",
                col.status === shownStatus
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background border-border",
              )}
            >
              {col.status} ({col.records.length})
            </button>
          ))}
        </div>
      )}
      <div
        className={cn("flex gap-3 pb-2", !singleColumn && "overflow-x-auto")}
      >
        {shownColumns.map((col) => {
          const total = moneyColKey
            ? col.records.reduce(
                (sum, r) => sum + (Number(r[moneyColKey]) || 0),
                0,
              )
            : 0;
          return (
            <div
              key={col.status}
              data-testid={`board-column-${col.status}`}
              className={cn(
                "bg-muted rounded-xl p-2",
                singleColumn ? "w-full" : "w-[272px] shrink-0",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                const record =
                  col.records.find((r) => r.id === id) ??
                  columns.flatMap((c) => c.records).find((r) => r.id === id);
                if (record) void handleDrop(record, col.status);
              }}
            >
              <div className="flex items-center justify-between px-1 py-1 text-xs font-semibold text-muted-foreground">
                <span className="flex items-baseline gap-1">
                  <span>{col.status}</span>
                  <span className="font-normal">({col.records.length})</span>
                </span>
                {moneyColKey && <span>{formatMoney(total)}</span>}
              </div>
              <div className="space-y-2">
                {col.records.map((record) => (
                  <div
                    key={record.id}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", record.id)
                    }
                    onClick={() => onRowClick(record)}
                    className="bg-card rounded-lg border border-border p-2 cursor-pointer text-sm"
                  >
                    <div className="font-medium">
                      {String(record[moduleDef.label ?? "id"] ?? record.id)}
                    </div>
                    {subtitleColKey && (
                      <div className="text-xs text-muted-foreground">
                        {subtitleRefSource ? (
                          <LookupName source={subtitleRefSource} id={record[subtitleColKey]} />
                        ) : (
                          String(record[subtitleColKey] ?? "")
                        )}
                      </div>
                    )}
                    {moneyColKey && (
                      <div className="font-mono text-xs">
                        {formatMoney(record[moneyColKey])}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      {ownerFieldKey && (
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          <LookupName source="owner" id={record[ownerFieldKey]} />
                        </span>
                      )}
                      {slaColKey && sla(record[slaColKey])?.l && (
                        <StatusBadge
                          status={sla(record[slaColKey])?.l ?? ""}
                          tone={(sla(record[slaColKey])?.t ?? "gray") as BadgeTone}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {pending && (
          <ActionDialog
            action={pending.action}
            open={!!pending}
            onClose={() => setPending(null)}
            onConfirm={(value, extra) => handleConfirmPending(value, extra)}
          />
        )}
      </div>
    </div>
  );
}
