import { useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

function storageKey(userId: string): string {
  return `genxcrm.savedLeadViews.${userId}`;
}

function readViews(userId: string): SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

// Local-first (per browser/device). A future PR can persist these server-side
// via a SavedLeadView model if the team wants cross-device sync.
export function useSavedViews() {
  const { user } = useAuth();
  const userId = user?.id ?? "anon";
  const [views, setViews] = useState<SavedView[]>(() => readViews(userId));

  const saveView = useCallback(
    (name: string, filters: Record<string, unknown>) => {
      const next = [
        ...readViews(userId).filter((v) => v.name !== name),
        { id: `${Date.now()}`, name, filters },
      ];
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
      setViews(next);
    },
    [userId],
  );

  const deleteView = useCallback(
    (id: string) => {
      const next = readViews(userId).filter((v) => v.id !== id);
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
      setViews(next);
    },
    [userId],
  );

  return { views, saveView, deleteView };
}
