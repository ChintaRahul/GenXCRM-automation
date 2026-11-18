import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { FilterSectionHeader } from "./FilterSectionHeader";

export interface ViewChip {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly onToggle: () => void;
  // Present for the user's own views only.
  readonly onDelete?: () => void;
}

interface SavedViewsPickerProps {
  views: readonly ViewChip[];
  onSave: (name: string) => void;
}

const chipClass = (active: boolean) =>
  cn(
    "min-h-9 max-[767px]:min-h-11 px-2.5 rounded-md text-xs font-medium border transition-colors",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "border-card-border bg-card text-foreground hover:bg-muted",
  );

// Toggle chips for built-in + user views, and a dashed "+ Save current" that reveals a name input.
export function SavedViewsPicker({ views, onSave }: SavedViewsPickerProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
    setNaming(false);
  };

  return (
    <div>
      <FilterSectionHeader title="Saved views" uppercase />
      <div className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-stretch max-w-full">
            <button
              type="button"
              onClick={v.onToggle}
              aria-pressed={v.active}
              title={v.label}
              className={cn(chipClass(v.active), "truncate max-w-[200px]", v.onDelete && "rounded-r-none")}
            >
              {v.label}
            </button>
            {v.onDelete && (
              <button
                type="button"
                onClick={v.onDelete}
                aria-label={`Delete saved view ${v.label}`}
                className="min-h-9 px-2 rounded-r-md border border-l-0 border-card-border bg-card text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {!naming && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="inline-flex items-center gap-1 min-h-9 max-[767px]:min-h-11 px-2.5 rounded-md text-xs font-medium border border-dashed border-card-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Plus className="w-3 h-3" />
            Save current
          </button>
        )}
      </div>
      {naming && (
        <div className="flex items-center gap-2 mt-2">
          <input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Name this view"
            aria-label="View name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setNaming(false);
            }}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
