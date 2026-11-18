import { useEffect, useState } from "react";
import api from "../api/client";

export interface GlobalSearchHit {
  readonly moduleKey: string;
  readonly id: string;
  readonly label: string;
}

// Records matching the sidebar box across modules (debounced; empty below 2 characters).
export function useGlobalSearch(query: string) {
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<GlobalSearchHit[]>("/modules/search", { params: { q: term } });
        if (!cancelled) setHits(data);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { hits, loading };
}
