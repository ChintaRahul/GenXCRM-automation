import { useCallback, useState } from "react";

const STORAGE_KEY = "sidebarNavState";

interface PersistedState {
  collapsed: boolean;
  openGroups: string[];
}

function readState(defaultOpenGroups: string[]): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: false, openGroups: defaultOpenGroups };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      collapsed: parsed.collapsed ?? false,
      openGroups: Array.isArray(parsed.openGroups) ? parsed.openGroups : defaultOpenGroups,
    };
  } catch {
    return { collapsed: false, openGroups: defaultOpenGroups };
  }
}

function writeState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort only — a full/blocked localStorage must never break the sidebar.
  }
}

// `defaultOpenGroups` seeds which groups start open when no localStorage value
// exists yet at all (first-ever load). It is ignored once any state has been
// persisted — including an explicit "everything closed" (`openGroups: []`)
// choice, which must be respected rather than overridden back to the defaults.
export function useSidebarState(defaultOpenGroups: string[] = []) {
  const [state, setState] = useState<PersistedState>(() => readState(defaultOpenGroups));

  const toggleCollapsed = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, collapsed: !prev.collapsed };
      writeState(next);
      return next;
    });
  }, []);

  const isGroupOpen = useCallback((key: string) => state.openGroups.includes(key), [state.openGroups]);

  const toggleGroup = useCallback((key: string) => {
    setState((prev) => {
      const isOpen = prev.openGroups.includes(key);
      const openGroups = isOpen ? prev.openGroups.filter((k) => k !== key) : [...prev.openGroups, key];
      const next = { ...prev, openGroups };
      writeState(next);
      return next;
    });
  }, []);

  const ensureGroupOpen = useCallback((key: string) => {
    setState((prev) => {
      if (prev.openGroups.includes(key)) return prev;
      const next = { ...prev, openGroups: [...prev.openGroups, key] };
      writeState(next);
      return next;
    });
  }, []);

  return { collapsed: state.collapsed, toggleCollapsed, isGroupOpen, toggleGroup, ensureGroupOpen };
}
