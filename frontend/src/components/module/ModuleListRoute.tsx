import { toast } from "sonner";
import { useState } from "react";
import { ModuleAccessGate } from "./ModuleAccessGate";
import { useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { emptyModuleFilters, type ModuleFilters } from "../../lib/moduleFilters";
import { RANGE_PRESET_LABELS, type RangePreset } from "../filters/DateRangeSelect";
import { ModuleListPage } from "./ModuleListPage";
import { ModuleFormDrawer } from "./ModuleFormDrawer";
import { pathForModuleKey } from "../../modules/modulePaths";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useModuleRights } from "../../hooks/useModuleRights";
import type { ModuleRecord } from "../../api/modules";

interface ModuleListRouteProps {
  readonly moduleKey: string;
}

// Leads opens on this month (matching the sidebar's MTD badge) unless the link says otherwise:
// `?datePreset=all` (e.g. a dashboard card) shows everything, any other preset applies as-is.
function initialFiltersFor(moduleKey: string, datePreset: string | null, status: string | null): ModuleFilters | undefined {
  const base = emptyModuleFilters();
  // `?status=Qualified` (e.g. a dashboard pipeline row) opens the list on that status;
  // `?status=New,Assigned` on several (naming them all also shows finished leads, which a bare list hides).
  const withStatus: ModuleFilters = status ? { ...base, status: status.split(",").filter(Boolean) } : base;
  // Leads open on this month by default; any other module applies a period only when the link names it.
  const preset = datePreset ?? (moduleKey === "leads" ? "mtd" : "all");
  if (preset === "all" || !Object.hasOwn(RANGE_PRESET_LABELS, preset) || preset === "custom") return moduleKey === "leads" || status ? withStatus : undefined;
  return { ...withStatus, date: { preset: preset as RangePreset, from: "", to: "" } };
}

// The list-page half of a routed manufacturing module: /accounts, /opportunities, etc.
// Clicking a row navigates to that record's detail route; "New" opens the create drawer,
// then navigates to the newly created record once saved.
function ModuleListRouteInner({ moduleKey }: ModuleListRouteProps) {
  const navigate = useNavigate();
  // Back from a record restores the list as left; a fresh visit starts from the link's defaults.
  const restoreState = useNavigationType() === "POP";
  const [searchParams] = useSearchParams();
  const datePreset = searchParams.get("datePreset");
  const status = searchParams.get("status");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const basePath = pathForModuleKey(moduleKey);
  const { hasAccess } = useModuleAccess(moduleKey);
  const rights = useModuleRights(moduleKey);

  function handleSavedAndAddAnother() {
    setRefreshKey((k) => k + 1);
    toast.success("Saved. Add the next one.");
  }

  function handleSaved(record: ModuleRecord) {
    setDrawerOpen(false);
    setRefreshKey((k) => k + 1);
    navigate(`/${basePath}/${record.id}`);
  }

  return (
    <>
      <ModuleListPage
        key={`${refreshKey}:${datePreset ?? ""}:${status ?? ""}`}
        moduleKey={moduleKey}
        initialFilters={initialFiltersFor(moduleKey, datePreset, status)}
        restoreState={restoreState}
        onRowClick={(record) => navigate(`/${basePath}/${record.id}`)}
        onNew={rights.create ? () => setDrawerOpen(true) : undefined}
        hasModuleAccess={hasAccess}
      />
      <ModuleFormDrawer moduleKey={moduleKey} open={drawerOpen} onClose={() => setDrawerOpen(false)} onSaved={handleSaved} onSavedAndAddAnother={handleSavedAndAddAnother} />
    </>
  );
}

export function ModuleListRoute(props: ModuleListRouteProps) {
  return (
    <ModuleAccessGate moduleKey={props.moduleKey}>
      <ModuleListRouteInner {...props} />
    </ModuleAccessGate>
  );
}
