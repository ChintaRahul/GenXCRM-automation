import { useCallback } from "react";
import { getModuleList, getModuleRecord, createModuleRecord, updateModuleRecord, type ModuleRecord } from "../api/modules";
import { REGISTRY } from "../modules/registry";
import { toPayload } from "../lib/moduleFormValidation";
import { invalidateLookup } from "../lib/lookupNames";

/**
 * Owns the data-mutation and duplicate-check calls for ModuleFormDrawer, so the
 * component itself never imports api/modules functions directly — per CLAUDE.md's
 * "hooks own all API calls" rule.
 */
export function useModuleForm(moduleKey: string) {
  const moduleDef = REGISTRY[moduleKey];

  const checkDuplicate = useCallback(
    async (values: Record<string, unknown>, editingId?: string): Promise<ModuleRecord | null> => {
      const dupKeys = moduleDef.dupKeys;
      if (!dupKeys?.length) return null;
      // Every duplicate key is checked, not just the first filled one: a new lead with a fresh
      // phone can still share its email or company with an existing record.
      const keysWithValue = dupKeys.filter((k) => typeof values[k] === "string" && (values[k] as string).trim().length > 0);
      for (const key of keysWithValue) {
        try {
          const result = await getModuleList(moduleKey, { page: 1, limit: 5, search: values[key] as string });
          const match = result.data.find((r) => r.id !== editingId && dupKeys.some((k) => values[k] && r[k] === values[k]));
          if (match) return match;
        } catch {
          // a failed lookup must never block saving
        }
      }
      return null;
    },
    [moduleDef, moduleKey],
  );

  // The account of a picked opportunity / asset / order: roles that cannot list accounts still get it filled in.
  const accountOf = useCallback(async (refModule: string, id: string): Promise<string | null> => {
    try {
      const record = await getModuleRecord(refModule, id);
      return typeof record?.accountId === "string" && record.accountId ? record.accountId : null;
    } catch {
      return null;
    }
  }, []);

  const save = useCallback(
    async (values: Record<string, unknown>, editingId?: string): Promise<ModuleRecord> => {
      const payload = toPayload(moduleDef.fields, values, Boolean(editingId));
      const saved = await (editingId ? updateModuleRecord(moduleKey, editingId, payload) : createModuleRecord(moduleKey, payload));
      // Pickers elsewhere (e.g. the Account list on a new contact) must offer this record straight away.
      invalidateLookup(moduleKey);
      return saved;
    },
    [moduleDef, moduleKey],
  );

  return { checkDuplicate, save, accountOf };
}
