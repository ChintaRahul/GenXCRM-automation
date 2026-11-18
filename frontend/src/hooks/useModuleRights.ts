import { useEffect, useState } from "react";
import { getModuleRights, type ModuleRights } from "../api/modules";
import { useAuth } from "../context/AuthContext";

const ALLOWED: ModuleRights = { create: true, read: true, update: true, delete: true };

// What the signed-in Manufacturing role may do in a module, so the page hides buttons the server would
// refuse (New for a role without Create, Edit without Update, Archive without Delete). Fails open on
// purpose: the backend still enforces every right, this only decides what to show.
export function useModuleRights(moduleKey: string): ModuleRights {
  const { user } = useAuth();
  const isManufacturing = user?.org?.workspaceType === "MANUFACTURING";
  const [rights, setRights] = useState<ModuleRights>(ALLOWED);

  useEffect(() => {
    if (!isManufacturing) {
      setRights(ALLOWED);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const all = await getModuleRights();
        if (!cancelled) setRights(all?.[moduleKey] ?? ALLOWED);
      } catch {
        if (!cancelled) setRights(ALLOWED);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isManufacturing, moduleKey, user?.mfgRole]);

  return rights;
}
