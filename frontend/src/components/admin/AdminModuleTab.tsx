import { useState } from "react";
import { toast } from "sonner";
import { ModuleListPage } from "../module/ModuleListPage";
import { ModuleFormDrawer } from "../module/ModuleFormDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { archiveModuleRecord, type ModuleRecord } from "../../api/modules";
import { useModuleRights } from "../../hooks/useModuleRights";
import { apiErrorMessage } from "../../lib/apiError";
import { REGISTRY } from "../../modules/registry";
import { AutomationRunHistory } from "./AutomationRunHistory";
import { ErpSyncPanel } from "./ErpSyncPanel";

interface AdminModuleTabProps {
  readonly moduleKey: string;
  readonly canEdit: boolean;
}

// Flat Administration config modules (approval rules, automation rules, masters, holidays,
// document templates) all share the same shape: a list you click into to edit, plus a "New"
// button. No detail page — these are config records, not workflow entities with their own
// SLA/audit surfaces, so editing happens straight from the drawer. A role with the Delete right
// also gets a "Delete" button in the drawer (a soft delete: hidden from lists, kept for audit).
export function AdminModuleTab({ moduleKey, canEdit }: AdminModuleTabProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ModuleRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rights = useModuleRights(moduleKey);
  const singular = (REGISTRY[moduleKey]?.singular ?? REGISTRY[moduleKey]?.title ?? "record").toLowerCase();

  function openEdit(record: ModuleRecord) {
    if (!canEdit) return;
    setEditingRecord(record);
    setDrawerOpen(true);
  }

  function openNew() {
    setEditingRecord(null);
    setDrawerOpen(true);
  }

  function handleSaved() {
    setDrawerOpen(false);
    setEditingRecord(null);
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!editingRecord) return;
    setDeleting(true);
    try {
      await archiveModuleRecord(moduleKey, editingRecord.id);
      toast.success(`The ${singular} was deleted.`);
      setConfirmingDelete(false);
      handleSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, `Couldn't delete this ${singular}.`));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <ModuleListPage
        key={refreshKey}
        moduleKey={moduleKey}
        embedded
        onRowClick={openEdit}
        onNew={canEdit ? openNew : undefined}
      />
      <ModuleFormDrawer
        moduleKey={moduleKey}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
        initialValues={editingRecord ?? undefined}
        editingId={editingRecord?.id}
        onDelete={rights.delete ? () => setConfirmingDelete(true) : undefined}
        extra={
          editingRecord && moduleKey === "automationRules" ? (
            <AutomationRunHistory ruleId={editingRecord.id} />
          ) : editingRecord && moduleKey === "erp" ? (
            <ErpSyncPanel connectionId={editingRecord.id} />
          ) : undefined
        }
      />
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this {singular}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">It will be hidden from lists but kept for reports and the audit trail.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
