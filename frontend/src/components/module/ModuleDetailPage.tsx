import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Archive, Link2, MoreHorizontal } from "lucide-react";
import { Header } from "../layout/Header";
import { StatusBadge } from "../shared/StatusBadge";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { RecordSummaryRail } from "./RecordSummaryRail";
import { LookupName } from "../../lib/lookupNames";
import { splitActions } from "../../lib/moduleActions";
import { useViewportMode } from "../../hooks/useViewportMode";
import { StageStepper } from "../mfg/StageStepper";
import { useModuleRecord } from "../../hooks/useModuleRecord";
import { REGISTRY, type ModuleAction } from "../../modules/registry";
import type { ModuleRecord } from "../../api/modules";
import { FieldsTab } from "./FieldsTab";
import { RelatedTab } from "./RelatedTab";
import { ActionDialog } from "./ActionDialog";
import { TableTab } from "./TableTab";
import { EventsTab } from "./EventsTab";
import { LinesTab } from "./LinesTab";
import { SlaTab, type RecordSla } from "./SlaTab";
import { DocumentsTab } from "./DocumentsTab";
import { AuditTab } from "./AuditTab";
import { displayId, formatDate, formatMoney } from "../../lib/moduleCells";
import { apiErrorMessage } from "../../lib/apiError";
import { cn } from "../../lib/utils";

interface ModuleDetailPageProps {
  moduleKey: string;
  id: string;
  onEdit: () => void;
  // What the signed-in role may do here; Edit / Archive are hidden when a right is missing (the server refuses them anyway).
  canEdit?: boolean;
  canArchive?: boolean;
  onSpecialAction?: (action: string, record: ModuleRecord, value?: string) => void;
  onRelatedRowClick?: (moduleKey: string, record: ModuleRecord) => void;
  hasModuleAccess?: boolean;
  onArchived?: () => void;
}

interface KeyFact {
  readonly label: string;
  readonly value: ReactNode;
}

function isActionVisible(action: ModuleAction, currentStatus: string): boolean {
  if (action.when) return action.when.includes(currentStatus);
  if (action.notWhen) return !action.notWhen.includes(currentStatus);
  return true;
}

export function ModuleDetailPage({
  moduleKey, id, onEdit, canEdit = true, canArchive = true, onSpecialAction, onRelatedRowClick, hasModuleAccess = true, onArchived,
}: ModuleDetailPageProps) {
  const moduleDef = REGISTRY[moduleKey];
  const { record, loading, error, forbidden, notFound, runAction, archive, patchRecord } = useModuleRecord(moduleKey, id);
  const [pendingAction, setPendingAction] = useState<ModuleAction | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<ModuleAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const viewport = useViewportMode();
  const mobile = viewport === "drawer";
  const wide = viewport === "full";

  if (moduleDef.restricted && !hasModuleAccess) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {moduleDef.title} is restricted.
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        You don&apos;t have access to {moduleDef.title.toLowerCase()}. Ask your admin if you need it.
      </div>
    );
  }

  if (notFound) {
    return <div className="p-6 text-sm text-muted-foreground">This {(moduleDef.singular ?? moduleDef.title).toLowerCase()} wasn&apos;t found. It may have been removed, or you may not have access to it.</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-destructive">Couldn&apos;t load this record.</div>;
  }

  if (loading || !record) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  // Assigning to a non-nullable const (rather than relying on the `!record` guard above)
  // keeps `record` typed as `ModuleRecord` inside the closures below — TS control-flow
  // narrowing from an `if` guard doesn't carry into nested function bodies.
  const currentRecord: ModuleRecord = record;
  const statusKey = moduleDef.statusKey ?? "status";
  const currentStatus = String(currentRecord[statusKey] ?? "");
  const statusTone = moduleDef.statuses.find((s) => s.value === currentStatus)?.tone ?? "gray";
  // A handover that is already acknowledged has nothing left to acknowledge.
  const alreadyAcknowledged = currentRecord.ackStatus === "Acknowledged";
  // A revised quotation version is read-only; changes go on the latest version.
  const canEditRecord = canEdit && !(moduleKey === "quotes" && currentStatus === "Revised");
  const visibleActions = (moduleDef.actions ?? []).filter((a) => isActionVisible(a, currentStatus) && !(a.special === "ack" && alreadyAcknowledged));
  const { primary, secondary, menu } = splitActions(visibleActions, !mobile);
  const canLogActivity = (moduleDef.actions ?? []).some((a) => a.special === "logActivity");

  const moneyField = moduleDef.fields.find((f) => f.type === "money" && !f.restricted && currentRecord[f.key]);
  const accountField = moduleKey === "accounts" ? undefined : moduleDef.fields.find((f) => f.type === "ref" && f.ref === "accounts" && currentRecord[f.key]);
  const dateField = moduleDef.fields.find((f) => f.type === "date" && currentRecord[f.key] && !["created", "nextDate"].includes(f.key));
  const ownerField = moduleDef.fields.find((f) => f.type === "owner" && currentRecord[f.key]);
  const keyFacts: KeyFact[] = [];
  if (moneyField) keyFacts.push({ label: moneyField.label, value: <span className="font-mono font-semibold">{formatMoney(currentRecord[moneyField.key])}</span> });
  if (accountField) keyFacts.push({ label: "Account", value: <LookupName source="accounts" id={currentRecord[accountField.key]} /> });
  if (dateField) keyFacts.push({ label: dateField.label, value: formatDate(currentRecord[dateField.key]) });
  if (ownerField) keyFacts.push({ label: ownerField.label, value: <LookupName source="owner" id={currentRecord[ownerField.key]} /> });

  const runFromMenu = (action: ModuleAction) => {
    setMenuOpen(false);
    handleActionClick(action);
  };
  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };
  const itemClass = "flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted max-[767px]:min-h-11";
  const moreMenu = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" aria-label="More actions" className="max-[767px]:h-11 max-[767px]:w-11">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 max-h-[300px] overflow-y-auto p-1">
        {menu.map((action) => (
          <button
            key={action.label}
            type="button"
            className={cn(itemClass, action.danger && "text-destructive")}
            onClick={() => runFromMenu(action)}
          >
            <span className="truncate" title={action.label}>{action.label}</span>
          </button>
        ))}
        <button type="button" className={itemClass} onClick={() => void copyLink()}>
          <Link2 className="w-4 h-4" /> Copy link
        </button>
        {canArchive && (
          <button type="button" className={cn(itemClass, "text-destructive")} onClick={() => { setMenuOpen(false); setConfirmingArchive(true); }}>
            <Archive className="w-4 h-4" /> Archive
          </button>
        )}
      </PopoverContent>
    </Popover>
  );

  async function handleArchive() {
    try {
      await archive();
      onArchived?.();
    } catch (err) {
      console.error(`Failed to archive ${moduleKey}/${id}`, err);
    }
  }

  async function handleRunAction(action: ModuleAction) {
    setActionError(null);
    try {
      await runAction(action.label);
    } catch (err) {
      setActionError(apiErrorMessage(err, `Couldn't ${action.label.toLowerCase()}.`));
    }
  }

  function handleActionClick(action: ModuleAction) {
    if (action.ask) {
      setPendingAction(action);
      return;
    }
    if (action.special) {
      onSpecialAction?.(action.special, currentRecord, undefined);
      return;
    }
    if (action.confirm) {
      setConfirmingAction(action);
      return;
    }
    void handleRunAction(action);
  }

  async function handleConfirmPendingAction(pending: ModuleAction, value: string, extra?: Record<string, string>) {
    if (pending.special) {
      onSpecialAction?.(pending.special, currentRecord, value);
      setPendingAction(null);
      return;
    }
    setActionError(null);
    try {
      await runAction(pending.label, { ...extra, [pending.ask!.key]: value });
    } catch (err) {
      setActionError(apiErrorMessage(err, `Couldn't ${pending.label.toLowerCase()}.`));
    } finally {
      setPendingAction(null);
    }
  }

  // A module labelled by its id (costing, dispatch, payments…) shows the readable id (CS-C76EEF), not the UUID.
  const title = moduleDef.label && moduleDef.label !== "id" ? String(currentRecord[moduleDef.label] ?? currentRecord.id) : displayId(currentRecord, moduleDef);
  // The label field's value is already shown as the page title above, and the status
  // field's value is already shown via the pill/progress bar above — hide just those two
  // fields (by key) from the generic fields grid so their values don't render twice.
  // Only the individual fields are excluded, not their whole section, so sibling fields
  // in the same section (e.g. a lead's phone/email alongside its company name) stay visible.
  const fieldsTabExcludeKeys = [statusKey, moduleDef.label].filter((key): key is string => Boolean(key));

  return (
    <div className="flex flex-col h-full">
      <Header
        title={title}
        subtitle={`${moduleDef.title} / ${displayId(currentRecord, moduleDef)}`}
        actions={
          mobile ? undefined : (
            <>
              {secondary && (
                <Button size="sm" variant="outline" onClick={() => handleActionClick(secondary)}>
                  {secondary.label}
                </Button>
              )}
              {canEditRecord && (
                <Button size="sm" variant="outline" onClick={onEdit}>
                  Edit
                </Button>
              )}
              {moreMenu}
              {primary && (
                <Button size="sm" onClick={() => handleActionClick(primary)}>
                  {primary.label}
                </Button>
              )}
            </>
          )
        }
      />

      <div className={cn("p-[clamp(14px,3.5vw,24px)] flex-1 min-h-0 overflow-y-auto", mobile && "pb-24")}>
      <div className={cn("flex gap-4", wide ? "items-start" : "flex-col")}>
      <div className="min-w-0 flex-1 space-y-4">
        {keyFacts.length > 0 && (
          <dl data-testid="key-facts" className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            {keyFacts.map((fact) => (
              <div key={fact.label} className="flex min-w-0 items-baseline gap-1.5">
                <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 truncate font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {actionError && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </p>
        )}
        {/* When the module has a flow, the progress bar below already conveys the current
            status (and its label) — showing this pill too would duplicate that text on
            screen, so it's reserved for flow-less modules. */}
        {(!moduleDef.flow || !moduleDef.flow.includes(currentStatus)) && (
          <div data-testid="status-badge" className="flex items-center gap-3">
            <StatusBadge status={currentStatus} tone={statusTone as never} />
          </div>
        )}

        {moduleDef.flow && <StageStepper flow={moduleDef.flow} status={currentStatus} />}

        {!wide && (
          <RecordSummaryRail
            moduleKey={moduleKey}
            moduleDef={moduleDef}
            record={currentRecord}
            layout="row"
            onLogActivity={canLogActivity ? () => onSpecialAction?.("logActivity", currentRecord) : undefined}
          />
        )}

        <Tabs defaultValue={moduleDef.tabs[0]?.key}>
          <TabsList>
            {moduleDef.tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="__sla">SLA</TabsTrigger>
            {moduleDef.hasDocs && <TabsTrigger value="__documents">Documents</TabsTrigger>}
            <TabsTrigger value="__audit">Audit trail</TabsTrigger>
          </TabsList>

          {moduleDef.tabs.map((tab) => (
            <TabsContent key={tab.key} value={tab.key}>
              {tab.kind === "fields" && (
                <FieldsTab
                  moduleDef={moduleDef}
                  record={currentRecord}
                  sections={tab.sections}
                  excludeSections={tab.excludeSections}
                  excludeKeys={fieldsTabExcludeKeys}
                  hideSectionHeadingIfEquals={title}
                />
              )}
              {tab.kind === "related" && (
                <RelatedTab
                  parentModuleKey={moduleKey}
                  parentId={id}
                  tab={tab}
                  onRowClick={(r) => onRelatedRowClick?.(tab.relatedModule!, r)}
                  onNewRelated={tab.createAction ? () => onSpecialAction?.(tab.createAction!, currentRecord) : undefined}
                />
              )}
              {tab.kind === "table" && <TableTab moduleKey={moduleKey} id={id} tabKey={tab.key} tab={tab} />}
              {tab.kind === "events" && <EventsTab moduleKey={moduleKey} id={id} tabKey={tab.key} label={tab.label} />}
              {tab.kind === "lines" && (
                <LinesTab
                  moduleKey={moduleKey}
                  id={id}
                  tab={tab}
                  // Quotation lines can only change while the quotation is a Draft (the server refuses otherwise).
                  readOnly={!canEdit || (moduleKey === "quotes" && currentStatus !== "Draft")}
                  initialRows={Array.isArray(currentRecord[tab.key]) ? (currentRecord[tab.key] as Record<string, unknown>[]) : []}
                  onSaved={(rows) => patchRecord({ [tab.key]: rows })}
                />
              )}
            </TabsContent>
          ))}
          <TabsContent value="__sla">
            <SlaTab sla={currentRecord.sla as RecordSla | null | undefined} />
          </TabsContent>
          {moduleDef.hasDocs && (
            <TabsContent value="__documents">
              <DocumentsTab moduleKey={moduleKey} id={id} />
            </TabsContent>
          )}
          <TabsContent value="__audit">
            <AuditTab moduleKey={moduleKey} id={id} />
          </TabsContent>
        </Tabs>
      </div>
      {wide && (
        <RecordSummaryRail
          moduleKey={moduleKey}
          moduleDef={moduleDef}
          record={currentRecord}
          layout="column"
          onLogActivity={canLogActivity ? () => onSpecialAction?.("logActivity", currentRecord) : undefined}
        />
      )}
      </div>
      </div>

      {mobile && (
        <div
          data-testid="mobile-action-bar"
          className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {moreMenu}
          {canEditRecord && (
            <Button variant="outline" className="h-11 flex-1" onClick={onEdit}>
              Edit
            </Button>
          )}
          {primary && (
            <Button className="h-11 flex-1" onClick={() => handleActionClick(primary)}>
              {primary.label}
            </Button>
          )}
        </div>
      )}

      {pendingAction && (
        <ActionDialog
          action={pendingAction}
          open={!!pendingAction}
          onClose={() => setPendingAction(null)}
          onConfirm={(value, extra) => handleConfirmPendingAction(pendingAction, value, extra)}
        />
      )}

      <Dialog open={confirmingAction !== null} onOpenChange={(next) => !next && setConfirmingAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmingAction?.label}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmingAction?.confirm}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmingAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmingAction?.danger ? "destructive" : "default"}
              onClick={() => {
                const action = confirmingAction;
                setConfirmingAction(null);
                if (action) void handleRunAction(action);
              }}
            >
              {confirmingAction?.label}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingArchive} onOpenChange={setConfirmingArchive}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive this {(moduleDef.singular ?? moduleDef.title).toLowerCase()}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It will be hidden from lists but kept for reports and the audit trail.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmingArchive(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingArchive(false);
                void handleArchive();
              }}
            >
              Archive
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
