import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getModuleList, type ModuleRecord } from "../api/modules";
import { emptyModuleFilters, toFilterParams, type ModuleFilters } from "../lib/moduleFilters";

export const DEFAULT_PAGE_SIZE = 25;

// Filter state starts from `initialFilters` (empty by default) and lives with the page instance,
// so switching module (a new ModuleListPage mounts) resets it.
// `pageSize` null means "not known yet" (the list is still measuring its height): nothing loads until it is.
// Module-level so it outlives the page unmounting when a row is opened: Back (`restore`) then
// brings the list up as it was left (filters, search, sort, page) instead of re-applying the
// default period. A fresh visit (sidebar, dashboard link) ignores it.
const listStateCache = new Map<string, { page: number; search: string; filters: ModuleFilters; sort: string }>();

export function useModuleList(moduleKey: string, initialFilters?: ModuleFilters, pageSize: number | null = DEFAULT_PAGE_SIZE, restore = false) {
  const cached = useRef(restore ? listStateCache.get(moduleKey) : undefined).current;
  const [records, setRecords] = useState<ModuleRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(cached?.page ?? 1);
  const [search, setSearchState] = useState(cached?.search ?? "");
  const [filters, setFiltersState] = useState<ModuleFilters>(cached?.filters ?? initialFilters ?? emptyModuleFilters);
  const [sort, setSortState] = useState(cached?.sort ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const filterParams = useMemo(() => toFilterParams(filters), [filters]);

  useEffect(() => {
    if (pageSize === null) return;
    const limit = pageSize;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setForbidden(false);
      try {
        const result = await getModuleList(moduleKey, {
          page,
          limit,
          search: search || undefined,
          sort: sort || undefined,
          ...filterParams,
        });
        if (cancelled) return;
        setRecords(result.data);
        setTotal(result.total);
      } catch (err) {
        if (cancelled) return;
        setForbidden(axios.isAxiosError(err) && err.response?.status === 403);
        setError(err instanceof Error ? err.message : "Failed to load records");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, page, pageSize, search, filterParams, sort, refreshTick]);

  useEffect(() => {
    listStateCache.set(moduleKey, { page, search, filters, sort });
  }, [moduleKey, page, search, filters, sort]);

  const setPage = useCallback((p: number) => setPageState(p), []);
  const setSearch = useCallback((s: string) => {
    setSearchState(s);
    setPageState(1);
  }, []);
  const setFilters = useCallback((next: ModuleFilters) => {
    setFiltersState(next);
    setPageState(1);
  }, []);
  const setSort = useCallback((key: string) => {
    setSortState((prev) => (prev === key ? `-${key}` : prev === `-${key}` ? "" : key));
    setPageState(1);
  }, []);
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { pageSize: pageSize ?? DEFAULT_PAGE_SIZE, records, total, page, setPage, search, setSearch, filters, filterParams, setFilters, sort, setSort, loading, error, forbidden, refresh };
}
