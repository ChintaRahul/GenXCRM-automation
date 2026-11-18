import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "../ui/input";

export interface FilterListItem {
  id: string;
  label: string;
  meta?: string;
  dotClassName?: string;
  // Replaces the dot (e.g. an owner avatar).
  leading?: ReactNode;
}

interface SearchableFilterListProps {
  title?: string;
  items: FilterListItem[];
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyMessage?: (query: string) => string;
  // Source/Course are short, stable lists scanned often — no search box per
  // the hifi design. Owner/City keep the search box (searchable stays true).
  searchable?: boolean;
}

export function SearchableFilterList({
  title,
  items,
  value,
  onChange,
  searchPlaceholder = "Search…",
  emptyMessage = (query) => `No match for "${query}"`,
  searchable = true,
}: SearchableFilterListProps) {
  const [query, setQuery] = useState("");

  if (items.length === 0) return null;

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const filtered = searchable
    ? items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  return (
    <div>
      {title && <p className="text-xs font-semibold text-foreground mb-2">{title}</p>}
      {searchable && (
        <div className="flex items-center gap-2 bg-muted rounded-md px-2.5 py-1.5 mb-1.5">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="border-0 bg-transparent p-0 h-auto text-xs focus-visible:ring-0 shadow-none"
          />
        </div>
      )}
      <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
        {filtered.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2 min-h-9 max-[767px]:min-h-11 cursor-pointer text-xs text-foreground"
          >
            <input
              type="checkbox"
              checked={value.includes(item.id)}
              onChange={() => toggle(item.id)}
              className="accent-primary w-3.5 h-3.5"
            />
            {item.leading}
            {!item.leading && item.dotClassName && (
              <span className={`w-2 h-2 rounded-full shrink-0 ${item.dotClassName}`} />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.meta && (
              <span className="text-muted-foreground/70">{item.meta}</span>
            )}
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            {emptyMessage(query)}
          </p>
        )}
      </div>
    </div>
  );
}
