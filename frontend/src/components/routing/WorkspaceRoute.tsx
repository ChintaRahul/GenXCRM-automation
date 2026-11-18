import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import type { WorkspaceType } from "../../types";

interface WorkspaceRouteProps {
  allow: WorkspaceType;
  children: ReactNode;
}

// Mirrors App.tsx's PrivateRoute — used by later phases to keep a Manufacturing
// (or EdTech) route from ever rendering for the other workspace type, per CLAUDE.md
// Phase 0: "Routes for the other vertical must return 404/redirect, not just be hidden."
export function WorkspaceRoute({ allow, children }: WorkspaceRouteProps) {
  const workspaceType = useWorkspace();
  if (workspaceType !== allow) return <Navigate to="/" replace />;
  return <>{children}</>;
}
