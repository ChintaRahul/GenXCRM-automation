import { useEffect, useState } from "react";
import { getModuleList } from "../api/modules";
import { useAuth } from "../context/AuthContext";
import { REGISTRY } from "../modules/registry";

// registry.ts moduleKey -> the FieldPermission.fieldLabel that fully restricts it (README §27's
// "Costing & margin" whole-record toggle — see backend's isModuleFullyRestricted). Extend this
// map if a future module gets a `restricted: true` flag with a different backing field label.
const RESTRICTED_MODULE_FIELD_LABELS: Record<string, string> = {
  costing: "Costing & margin",
};

// Whether the current caller has access to a `restricted: true` module (only `costing` today).
// The backend already enforces this for real (CostingSheetsService 403s a restricted caller) —
// this hook only decides whether ModuleListPage/ModuleDetailPage show the friendly "{title} is
// restricted." banner instead of letting the fetch fail with a raw error.
export function useModuleAccess(moduleKey: string): { hasAccess: boolean; loading: boolean } {
  const { user } = useAuth();
  const fieldLabel = RESTRICTED_MODULE_FIELD_LABELS[moduleKey];
  const [hasAccess, setHasAccess] = useState(!fieldLabel);
  const [loading, setLoading] = useState(Boolean(fieldLabel));

  useEffect(() => {
    if (!fieldLabel) {
      setHasAccess(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function check() {
      setLoading(true);
      try {
        const result = await getModuleList("fieldPermissions", { page: 1, limit: 20 });
        if (cancelled) return;
        const restriction = result.data.find((r) => r.fieldLabel === fieldLabel);
        const restrictedToRoles = (restriction?.restrictedToRoles as string[] | undefined) ?? [];
        const role = user?.mfgRole ?? user?.role;
        setHasAccess(!role || !restrictedToRoles.includes(role));
      } catch {
        // Fail open on the client — the backend still enforces the real restriction, so a
        // failed check here just means the friendly banner doesn't show, not a data leak.
        if (!cancelled) setHasAccess(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [fieldLabel, user?.mfgRole, user?.role]);

  return { hasAccess, loading };
}

// True only for modules whose registry entry actually sets `restricted: true` — lets callers
// skip the access check entirely for the other ~29 modules.
export function isRestrictedModule(moduleKey: string): boolean {
  return Boolean(REGISTRY[moduleKey]?.restricted);
}
