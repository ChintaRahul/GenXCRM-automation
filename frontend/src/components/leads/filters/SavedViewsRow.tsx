import { Plus, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { SavedView } from "../../../hooks/useSavedViews";

// No "My leads" view here — reps already only ever see their own leads via
// server-side scoping, so a client-side "my leads" shortcut would be a no-op.
const BUILT_IN_VIEWS: { key: string; label: string; filters: Record<string, unknown> }[] = [
  { key: "unassigned", label: "Unassigned", filters: { unassigned: true } },
  { key: "hot-leads", label: "Hot leads", filters: { hotOnly: true } },
  { key: "idle", label: "Idle 24h+", filters: { idle: true } },
];

interface SavedViewsRowProps {
  views: SavedView[];
  activeFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
  onSaveCurrent: () => void;
  onDelete: (id: string) => void;
}

function isActive(filters: Record<string, unknown>, activeFilters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => {
    const current = activeFilters[key];
    return Array.isArray(value) && Array.isArray(current)
      ? value.length === current.length && value.every((v) => current.includes(v))
      : current === value;
  });
}

// Clicking the view that is already applied switches it off (applies no filters).
export function SavedViewsRow({
  views,
  activeFilters,
  onApply,
  onSaveCurrent,
  onDelete,
}: SavedViewsRowProps) {
  const chipClass = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "border-card-border bg-card text-foreground hover:bg-muted",
    );

  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-2">Saved views</p>
      <div className="flex flex-wrap gap-1.5">
        {BUILT_IN_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onApply(isActive(v.filters, activeFilters) ? {} : v.filters)}
            className={chipClass(isActive(v.filters, activeFilters))}
          >
            {v.label}
          </button>
        ))}
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-stretch">
            <button
              type="button"
              onClick={() => onApply(isActive(v.filters, activeFilters) ? {} : v.filters)}
              title={v.name}
              className={cn(
                chipClass(isActive(v.filters, activeFilters)),
                "rounded-r-none max-w-[160px] truncate",
              )}
            >
              {v.name}
            </button>
            <button
              type="button"
              onClick={() => onDelete(v.id)}
              aria-label={`Delete saved view ${v.name}`}
              title="Delete saved view"
              className="px-1.5 rounded-r-md border border-l-0 border-card-border bg-card text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={onSaveCurrent}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-dashed border-card-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
          )}
        >
          <Plus className="w-3 h-3" />
          Save current
        </button>
      </div>
    </div>
  );
}
