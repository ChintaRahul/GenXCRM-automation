import { useEffect, useState } from "react";
import { getReadableModules } from "../api/modules";
import { useAuth } from "../context/AuthContext";

// Module keys the signed-in Manufacturing user can read, or null while loading / when
// unrestricted / on failure. Fails open on purpose: the backend still enforces access, this
// only decides which nav links to show.
export function useReadableModules(): string[] | null {
  const { user } = useAuth();
  const isManufacturing = user?.org?.workspaceType === "MANUFACTURING";
  const [readable, setReadable] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isManufacturing) {
      setReadable(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const keys = await getReadableModules();
        if (!cancelled) setReadable(keys);
      } catch {
        if (!cancelled) setReadable(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isManufacturing, user?.mfgRole]);

  return readable;
}
