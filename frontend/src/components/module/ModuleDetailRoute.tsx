import { apiErrorMessage } from "../../lib/apiError";
import { todayIso } from "../../lib/utils";
import { useState } from "react";
import { ModuleAccessGate } from "./ModuleAccessGate";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ModuleDetailPage } from "./ModuleDetailPage";
import { ModuleFormDrawer } from "./ModuleFormDrawer";
import { ConvertLeadDialog } from "./ConvertLeadDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useModuleRecord } from "../../hooks/useModuleRecord";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useModuleRights } from "../../hooks/useModuleRights";
import { useReadableModules } from "../../hooks/useReadableModules";
import { pathForModuleKey } from "../../modules/modulePaths";
import { REGISTRY } from "../../modules/registry";
import { performModuleAction, updateModuleRecord, getModulePdf, getModuleIcs, getModuleCsv, type ModuleRecord } from "../../api/modules";
import { downloadBlob } from "../../lib/utils";

// Modules with a real server-side PDF generator (see backend ModuleAdapter.getPdf) — everything
// else still falls back to window.print() since no generator exists for it.
const MODULES_WITH_PDF = new Set(["quotes", "visits", "reports", "sorders"]);
// Only reports has a real CSV generator (ModuleAdapter.getCsv) backing "Export Excel".
const MODULES_WITH_CSV = new Set(["reports"]);

interface ModuleDetailRouteProps {
  readonly moduleKey: string;
}

// Cross-module "create, prefilled from this record" actions (Tier 1: pure frontend, no backend
// special-action support needed — just opens the target module's normal create drawer). Extend
// this map when a module gains a similar "spin off a related record" action.
const CROSS_MODULE_ACTIONS: Record<string, { targetModuleKey: string; prefill: (record: ModuleRecord) => Record<string, unknown> }> = {
  logActivity: { targetModuleKey: "activities", prefill: (r) => ({ opportunityId: r.id, accountId: r.accountId }) },
  createQuotation: { targetModuleKey: "quotes", prefill: (r) => ({ opportunityId: r.id, accountId: r.accountId }) },
  createDispatch: { targetModuleKey: "dispatch", prefill: (r) => ({ salesOrderId: r.id, accountId: r.accountId }) },
  raiseTicket: { targetModuleKey: "service", prefill: (r) => ({ assetId: r.id, accountId: r.accountId }) },
  createAmc: { targetModuleKey: "amc", prefill: (r) => ({ assetId: r.id, accountId: r.accountId }) },
};

// performAction() on every service dispatches on the action's real *label* ("Submit", "Accept
// PO", ...), never on registry.ts's shorter `special` key — so any direct backend call needs the
// label, not the key. Looking it up from the registry (rather than hand-maintaining a second
// key->label table) keeps this correct automatically as registry.ts changes.
function actionLabelFor(moduleKey: string, special: string): string {
  return REGISTRY[moduleKey].actions?.find((a) => a.special === special)?.label ?? special;
}

function ModuleDetailRouteInner({ moduleKey }: ModuleDetailRouteProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [crossModuleDrawer, setCrossModuleDrawer] = useState<{ targetModuleKey: string; initialValues: Record<string, unknown> } | null>(null);
  const [advanceStageRecord, setAdvanceStageRecord] = useState<ModuleRecord | null>(null);
  const [serialPromptRecord, setSerialPromptRecord] = useState<ModuleRecord | null>(null);
  const [convertLeadRecord, setConvertLeadRecord] = useState<ModuleRecord | null>(null);
  const { record: editingRecord } = useModuleRecord(moduleKey, id ?? "");
  const { hasAccess } = useModuleAccess(moduleKey);
  const rights = useModuleRights(moduleKey);
  const readableModules = useReadableModules();

  if (!id) return null;

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function handleSpecialAction(action: string, record: ModuleRecord, value?: string) {
    try {
      if (action === "reassign") {
        // accounts' "Reassign owner" special action has no backend performAction support yet —
        // a plain field update accomplishes the same thing and IS supported.
        await updateModuleRecord(moduleKey, id!, { ownerId: value });
        toast.success("Owner reassigned.");
        refresh();
        return;
      }
      if (action === "receipt") {
        await performModuleAction(moduleKey, id!, "Record receipt", { amt: Number(value) });
        toast.success("Receipt recorded.");
        refresh();
        return;
      }
      if (action === "renewalOpp") {
        const opportunity = await performModuleAction(moduleKey, id!, actionLabelFor(moduleKey, action));
        toast.success("Renewal opportunity created.");
        // A Service Manager has no Opportunities access: stay on the coverage (it now shows the renewal link) instead of landing on a 403.
        // Same list ModuleAccessGate uses to decide whether the Opportunities page opens (null = unrestricted / still loading).
        const canOpenOpportunity = !readableModules || readableModules.includes("opps");
        if (canOpenOpportunity) navigate(`/${pathForModuleKey("opps")}/${opportunity.id}`);
        else refresh();
        return;
      }
      if (action === "revise" && moduleKey === "quotes") {
        const child = await performModuleAction(moduleKey, id!, actionLabelFor(moduleKey, action));
        toast.success("New version created.");
        navigate(`/${pathForModuleKey(moduleKey)}/${child.id}`);
        return;
      }
      if (action in CROSS_MODULE_ACTIONS) {
        const { targetModuleKey, prefill } = CROSS_MODULE_ACTIONS[action];
        setCrossModuleDrawer({ targetModuleKey, initialValues: prefill(record) });
        return;
      }
      if (action === "convert" && moduleKey === "leads") {
        setConvertLeadRecord(record);
        return;
      }
      if (action === "advance" && moduleKey === "opps") {
        setAdvanceStageRecord(record);
        return;
      }
      if (action === "advance" && moduleKey === "sorders") {
        try {
          await performModuleAction(moduleKey, id!, actionLabelFor(moduleKey, action));
          refresh();
        } catch (err) {
          // The one transition that needs extra input is Commissioned's required `serial` — the
          // backend is the source of truth for when that applies, so retry once the user
          // supplies it rather than duplicating ORDER_FLOW's shape on the frontend.
          if (apiErrorMessage(err, "").toLowerCase().includes("serial")) {
            setSerialPromptRecord(record);
          } else {
            throw err;
          }
        }
        return;
      }
      if (action === "pdf") {
        if (MODULES_WITH_PDF.has(moduleKey)) {
          const { blob, filename } = await getModulePdf(moduleKey, id!);
          downloadBlob(blob, filename);
        } else {
          // No PDF generator exists for this module yet — printing the current page is a real,
          // working stand-in rather than a dead button.
          window.print();
        }
        return;
      }
      if (action === "ics") {
        const { blob, filename } = await getModuleIcs(moduleKey, id!);
        downloadBlob(blob, filename);
        return;
      }
      if (action === "export") {
        if (MODULES_WITH_CSV.has(moduleKey)) {
          const { blob, filename } = await getModuleCsv(moduleKey, id!);
          downloadBlob(blob, filename);
        } else {
          window.print();
        }
        return;
      }
      // Everything else — submitCosting/submitQuote/acceptPo/ack (already working on the
      // backend) and rfqs/costing "New revision", payments "Send reminder" (genuinely not
      // implemented server-side) — dispatches by the action's real label and lets whatever the
      // backend actually does (success or a real error) happen, instead of a placeholder toast.
      const label = actionLabelFor(moduleKey, action);
      await performModuleAction(moduleKey, id!, label);
      toast.success(`${label} done.`);
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err, `Couldn't complete "${action}".`));
    }
  }

  return (
    <>
      <ModuleDetailPage
        key={refreshKey}
        moduleKey={moduleKey}
        id={id}
        onEdit={() => setDrawerOpen(true)}
        canEdit={rights.update}
        canArchive={rights.delete}
        onSpecialAction={(action, record, value) => void handleSpecialAction(action, record, value)}
        onRelatedRowClick={(relatedModuleKey, relatedRecord) => navigate(`/${pathForModuleKey(relatedModuleKey)}/${relatedRecord.id}`)}
        hasModuleAccess={hasAccess}
        onArchived={() => navigate(`/${pathForModuleKey(moduleKey)}`)}
      />
      <ModuleFormDrawer
        moduleKey={moduleKey}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editingId={id}
        initialValues={editingRecord ?? undefined}
        onSaved={() => {
          setDrawerOpen(false);
          refresh();
        }}
      />
      {crossModuleDrawer && (
        <ModuleFormDrawer
          moduleKey={crossModuleDrawer.targetModuleKey}
          open
          onClose={() => setCrossModuleDrawer(null)}
          initialValues={crossModuleDrawer.initialValues}
          onSaved={(created) => {
            setCrossModuleDrawer(null);
            toast.success(`${REGISTRY[crossModuleDrawer.targetModuleKey].singular ?? "Record"} created.`);
            navigate(`/${pathForModuleKey(crossModuleDrawer.targetModuleKey)}/${created.id}`);
          }}
        />
      )}
      {advanceStageRecord && (
        <AdvanceStageDialog
          record={advanceStageRecord}
          onClose={() => setAdvanceStageRecord(null)}
          onAdvanced={() => {
            setAdvanceStageRecord(null);
            refresh();
          }}
        />
      )}
      {convertLeadRecord && (
        <ConvertLeadDialog
          lead={convertLeadRecord}
          onClose={() => setConvertLeadRecord(null)}
          onConverted={(opportunityId) => {
            setConvertLeadRecord(null);
            navigate(`/${pathForModuleKey("opps")}/${opportunityId}`);
          }}
        />
      )}
      {serialPromptRecord && (
        <SerialPromptDialog
          onClose={() => setSerialPromptRecord(null)}
          onConfirm={async (serial) => {
            try {
              await performModuleAction(moduleKey, id!, "Advance status", { serial });
              setSerialPromptRecord(null);
              refresh();
            } catch (err) {
              toast.error(apiErrorMessage(err, "Couldn't advance to Commissioned."));
            }
          }}
        />
      )}
    </>
  );
}

// The generic action-ask dialog only collects one field; "Advance stage" needs both a next
// action and its date (update()'s own validation requires both whenever an opportunity's stage
// changes), so it gets its own small dialog rather than stretching ActionDialog to fit.
function AdvanceStageDialog({
  record, onClose, onAdvanced,
}: {
  record: ModuleRecord;
  onClose: () => void;
  onAdvanced: () => void;
}) {
  const flow = REGISTRY.opps.flow ?? [];
  const currentIndex = flow.indexOf(String(record.stage ?? ""));
  const nextStage = currentIndex >= 0 ? flow[currentIndex + 1] : undefined;
  const [nextAction, setNextAction] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canConfirm = Boolean(nextStage) && nextAction.trim().length > 0 && nextActionDate.length > 0 && nextActionDate >= todayIso();

  async function handleConfirm() {
    if (!nextStage) return;
    setSubmitting(true);
    try {
      await updateModuleRecord("opps", record.id, { stage: nextStage, nextAction, nextActionDate });
      onAdvanced();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't advance this opportunity's stage.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Advance stage</DialogTitle>
        </DialogHeader>
        {!nextStage ? (
          <p className="text-sm text-muted-foreground">This opportunity has no further stage to advance to.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Moving to <span className="font-medium text-foreground">{nextStage}</span>.
            </p>
            <div className="space-y-1">
              <Label htmlFor="advance-next-action">
                Next action <span className="text-destructive">*</span>
              </Label>
              <Input id="advance-next-action" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="advance-next-action-date">
                Next action date <span className="text-destructive">*</span>
              </Label>
              <Input id="advance-next-action-date" type="date" min={todayIso()} value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {nextStage && (
            <Button disabled={!canConfirm || submitting} onClick={() => void handleConfirm()}>
              {submitting ? "Advancing…" : "Advance"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Sales orders only need this when advancing into "Commissioned" — triggered reactively off the
// backend's own rejection rather than the frontend duplicating ORDER_FLOW's shape.
function SerialPromptDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (serial: string) => void | Promise<void> }) {
  const [serial, setSerial] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(serial);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Serial number required</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Commissioning this order creates its installed asset record — enter the unit&apos;s serial number.
        </p>
        <div className="space-y-1">
          <Label htmlFor="commission-serial">
            Serial no. <span className="text-destructive">*</span>
          </Label>
          <Input id="commission-serial" value={serial} onChange={(e) => setSerial(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!serial.trim() || submitting} onClick={() => void handleConfirm()}>
            {submitting ? "Advancing…" : "Advance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ModuleDetailRoute(props: ModuleDetailRouteProps) {
  return (
    <ModuleAccessGate moduleKey={props.moduleKey}>
      <ModuleDetailRouteInner {...props} />
    </ModuleAccessGate>
  );
}
