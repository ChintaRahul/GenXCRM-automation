import { useEffect, useState } from "react";
import { getUserDirectory } from "../api/client";
import { getModuleList, getModuleRecord } from "../api/modules";
import { REGISTRY } from "../modules/registry";

// Owner / reference fields store ids. These caches resolve them to display names, one request per
// owner list or referenced module for the whole session, so lists of cards don't each fetch.
const nameCache = new Map<string, Promise<Map<string, string>>>();
// Ids of inactive records per source: still named in lists, but not offered in pickers.
const inactiveIds = new Map<string, Set<string>>();

// A module labelled by its id (sales orders, dispatches, costing…) is named like the lists name it: SO-A5EF9F.
const recordName = (moduleKey: string, record: Record<string, unknown>): string => {
  const labelKey = REGISTRY[moduleKey]?.label ?? "id";
  const id = String(record.id ?? "");
  if (labelKey === "id") return `${REGISTRY[moduleKey]?.idPrefix ?? ""}${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  return String(record[labelKey] ?? id);
};

const loadOwners = async (): Promise<Map<string, string>> => {
  try {
    return new Map((await getUserDirectory()).map((u) => [u.id, u.name]));
  } catch {
    return new Map();
  }
};

// Picker lists are re-read after this long, so an account created a minute ago is offered
// without a page reload.
const CACHE_TTL_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const loadedAt = new Map<string, number>();

const loadModuleNames = async (moduleKey: string): Promise<Map<string, string>> => {
  const records: Record<string, unknown>[] = [];
  const first = await getModuleList(moduleKey, { page: 1, limit: PAGE_SIZE });
  records.push(...first.data);
  // Every page (up to a cap) so records beyond the first hundred are selectable too.
  for (let page = 2; page <= Math.min(first.pages ?? 1, MAX_PAGES); page += 1) {
    records.push(...(await getModuleList(moduleKey, { page, limit: PAGE_SIZE })).data);
  }
  inactiveIds.set(moduleKey, new Set(records.filter((r) => r.status === "Inactive").map((r) => String(r.id))));
  return new Map(records.map((r) => [String(r.id), recordName(moduleKey, r)]));
};

const namesFor = (source: string): Promise<Map<string, string>> => {
  const cached = nameCache.get(source);
  if (cached && Date.now() - (loadedAt.get(source) ?? 0) < CACHE_TTL_MS) return cached;
  const pending = (source === "owner" ? loadOwners() : loadModuleNames(source)).catch(() => {
    // A failed load must not stick: the next picker open tries again.
    nameCache.delete(source);
    return new Map<string, string>();
  });
  nameCache.set(source, pending);
  loadedAt.set(source, Date.now());
  return pending;
};

// Forget a module's cached names after one of its records changes.
export const invalidateLookup = (source: string) => {
  nameCache.delete(source);
  loadedAt.delete(source);
};

// A record outside the first 100 of its module is not in the list above, so it is fetched on its own
// (once per id) instead of showing a shortened id.
const singleNames = new Map<string, Promise<string | null>>();
const singleName = (source: string, id: string): Promise<string | null> => {
  const cacheKey = `${source}:${id}`;
  const cached = singleNames.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const record = await getModuleRecord(source, id);
      return record ? recordName(source, record) : null;
    } catch {
      return null;
    }
  })();
  singleNames.set(cacheKey, pending);
  return pending;
};

// Clears the cache (used on sign-out and in tests).
export const resetLookupNames = () => {
  singleNames.clear();
  nameCache.clear();
  loadedAt.clear();
  inactiveIds.clear();
};

// `source` is "owner" for user ids, otherwise the referenced module key (e.g. "accounts").
export const useLookupName = (source: string | undefined, id: unknown): string => {
  const key = typeof id === "string" && id ? id : null;
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setName(null);
    if (!source || !key) return;
    void (async () => {
      const found = (await namesFor(source)).get(key) ?? (source === "owner" ? null : await singleName(source, key));
      if (!cancelled) setName(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [source, key]);

  if (!key) return "—";
  if (name) return name;
  // Not readable by this role (or not loaded): show the short id the lists use (ACC-2AD978), not a UUID.
  const prefix = source ? REGISTRY[source]?.idPrefix : undefined;
  return prefix ? `${prefix}${key.replace(/-/g, "").slice(0, 6).toUpperCase()}` : source ? `${key.slice(0, 8)}…` : key;
};

export interface LookupOption {
  readonly id: string;
  readonly label: string;
  readonly inactive?: boolean;
}

// The selectable records behind an owner / reference field, from the same per-session cache as
// the name lookups (the first 100 records of the referenced module, or every user for "owner").
export const useLookupOptions = (source: string | undefined): { options: LookupOption[]; loading: boolean } => {
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(Boolean(source));

  useEffect(() => {
    let cancelled = false;
    if (!source) return;
    setLoading(true);
    void namesFor(source).then((names) => {
      if (cancelled) return;
      setOptions([...names].map(([id, label]) => ({ id, label, inactive: inactiveIds.get(source)?.has(id) })).sort((a, b) => a.label.localeCompare(b.label)));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return { options, loading };
};

interface LookupNameProps {
  readonly source: string | undefined;
  readonly id: unknown;
}

export const LookupName = ({ source, id }: LookupNameProps) => {
  const name = useLookupName(source, id);
  return <span title={typeof id === "string" ? id : undefined}>{name}</span>;
};
