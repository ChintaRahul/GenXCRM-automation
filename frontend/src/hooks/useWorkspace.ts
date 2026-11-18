import { useAuth } from "../context/AuthContext";
import type { WorkspaceType } from "../types";

// Read-only: workspaceType is set once at signup and never changed via the API
// (see CLAUDE.md Phase 0 / docs/superpowers/specs/2026-09-28-manufacturing-workspace-phase0-design.md).
export function useWorkspace(): WorkspaceType | undefined {
  const { user } = useAuth();
  return user?.org?.workspaceType;
}
