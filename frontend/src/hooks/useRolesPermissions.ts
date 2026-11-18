import { useCallback, useEffect, useState } from "react";
import { getModuleList, updateModuleRecord, type ModuleRecord } from "../api/modules";

// Mirrors backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts's
// ROLE_LABEL_TO_ENUM / MANUFACTURING_MODULE_KEYS — kept as a parallel frontend source of
// truth, matching this codebase's existing registry.ts-mirrors-mfg-schema.js convention.
export const MFG_ROLES = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "DIRECTOR", label: "Director" },
  { value: "SALES_HEAD", label: "Sales Head" },
  { value: "SALES_MANAGER", label: "Sales Manager" },
  { value: "SALES_EXECUTIVE", label: "Sales Executive" },
  { value: "APPLICATION_ENGINEER", label: "Application Engineer" },
  { value: "COMMERCIAL_ESTIMATION", label: "Commercial / Estimation" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "ACCOUNTS", label: "Accounts" },
  { value: "SERVICE_MANAGER", label: "Service Manager" },
  { value: "SERVICE_ENGINEER", label: "Service Engineer" },
] as const;

export const ADMIN_MODULE_KEYS = [
  "leads", "accounts", "contacts", "activities", "opps", "rfqs", "visits", "demos", "products",
  "costing", "quotes", "approvals", "pos", "sorders", "dispatch", "payments", "assets", "amc",
  "service", "reports", "nurturing", "templates", "dealers", "tenders",
] as const;

export const FIELD_SECURITY_LABELS = [
  "Standard cost",
  "Minimum selling price",
  "Costing & margin",
  "Approval thresholds",
  "Competitor pricing",
  "Payment receipts",
] as const;

export interface RolePermissionRow extends ModuleRecord {
  role: string;
  moduleKey: string;
  recordAccess: string;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
}

export interface FieldPermissionRow extends ModuleRecord {
  fieldLabel: string;
  restrictedToRoles: string[];
}

// Both lists are small (≤242 RolePermission rows, 6 FieldPermission rows) — one page
// covers the whole org, filtered client-side by the selected role.
export function useRolesPermissions() {
  const [rolePermissions, setRolePermissions] = useState<RolePermissionRow[]>([]);
  const [fieldPermissions, setFieldPermissions] = useState<FieldPermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [rp, fp] = await Promise.all([
          getModuleList("rolePermissions", { page: 1, limit: 300 }),
          getModuleList("fieldPermissions", { page: 1, limit: 20 }),
        ]);
        if (cancelled) return;
        setRolePermissions(rp.data as RolePermissionRow[]);
        setFieldPermissions(fp.data as FieldPermissionRow[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load roles & permissions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const saveRolePermission = useCallback(
    async (id: string, patch: Partial<RolePermissionRow>) => {
      await updateModuleRecord("rolePermissions", id, patch);
      refresh();
    },
    [refresh],
  );

  const saveFieldPermission = useCallback(
    async (id: string, restrictedToRoles: string[]) => {
      await updateModuleRecord("fieldPermissions", id, { restrictedToRoles });
      refresh();
    },
    [refresh],
  );

  return { rolePermissions, fieldPermissions, loading, error, saveRolePermission, saveFieldPermission };
}
