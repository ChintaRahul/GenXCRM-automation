import type { ReactNode } from "react";
import { NoAccessPage } from "../shared/NoAccessPage";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useReadableModules } from "../../hooks/useReadableModules";

interface ModuleAccessGateProps {
  readonly moduleKey: string;
  readonly children: ReactNode;
}

// Direct-URL guard for a manufacturing module route: roles that can't read the module get a
// 403 page instead of a page full of "couldn't load" errors. Fails open while loading or on
// failure (useReadableModules returns null) — the backend still enforces access.
export function ModuleAccessGate({ moduleKey, children }: ModuleAccessGateProps) {
  const isManufacturing = useWorkspace() === "MANUFACTURING";
  const readable = useReadableModules();

  if (isManufacturing && readable && !readable.includes(moduleKey)) {
    return <NoAccessPage />;
  }
  return <>{children}</>;
}
