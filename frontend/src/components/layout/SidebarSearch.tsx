import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "../ui/input";
import type { NavItem, NavGroup } from "../../config/nav";
import { isNative } from "../../lib/platform";
import { useGlobalSearch } from "../../hooks/useGlobalSearch";
import { pathForModuleKey } from "../../modules/modulePaths";

interface FilterResult {
  filteredPinned: NavItem[];
  filteredGroups: NavGroup[];
  matchedGroupKeys: string[];
  active: boolean;
}

interface SidebarSearchProps {
  pinned: NavItem[];
  groups: NavGroup[];
  onFilterChange: (result: FilterResult) => void;
  // Also look up records (company, phone, GSTIN, serial…) across modules; Manufacturing workspaces only.
  searchRecords?: boolean;
}

export function SidebarSearch({ pinned, groups, onFilterChange, searchRecords = false }: SidebarSearchProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { hits } = useGlobalSearch(searchRecords ? query : "");

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const result = useMemo<FilterResult>(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return { filteredPinned: pinned, filteredGroups: groups, matchedGroupKeys: [], active: false };
    }
    const matches = (item: NavItem) => item.label.toLowerCase().includes(trimmed);
    const filteredPinned = pinned.filter(matches);
    const filteredGroups = groups
      .map((g) => ({ ...g, items: g.items.filter(matches) }))
      .filter((g) => g.items.length > 0);
    return {
      filteredPinned,
      filteredGroups,
      matchedGroupKeys: filteredGroups.map((g) => g.key),
      active: true,
    };
  }, [query, pinned, groups]);

  useEffect(() => {
    onFilterChange(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <div className="relative px-2 pb-2">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchRecords ? "Search records or pages…" : isNative() ? "Find a page…" : "Find a page… ⌘K"}
        className="pl-8 h-9 max-[767px]:h-11 text-xs"
      />
      {hits.length > 0 && (
        <ul className="mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover text-xs" aria-label="Matching records">
          {hits.map((hit) => (
            <li key={`${hit.moduleKey}-${hit.id}`}>
              <Link
                to={`/${pathForModuleKey(hit.moduleKey)}/${hit.id}`}
                className="flex items-center justify-between gap-2 px-2 py-2 hover:bg-accent"
                onClick={() => setQuery("")}
              >
                <span className="truncate" title={hit.label}>{hit.label}</span>
                <span className="shrink-0 text-muted-foreground">{hit.moduleKey}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
