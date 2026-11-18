import { Filter } from "lucide-react";
import { cn } from "../../lib/utils";

interface FiltersTriggerProps {
  // Number of active filter values (not groups).
  count: number;
  onClick: () => void;
}

// The toolbar "Filters" button: outline by default, primary-tinted with a count badge once any
// filter is active. Shared by every list that opens a filters drawer.
export function FiltersTrigger({ count, onClick }: FiltersTriggerProps) {
  const active = count > 0;

  return (
    <button
      type="button"
      data-tour="filters"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-9 max-[767px]:h-11 px-3 rounded-md border text-sm font-medium transition-colors shrink-0",
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "bg-background border-input text-foreground hover:bg-muted",
      )}
    >
      <Filter className="w-4 h-4" />
      Filters
      {active && (
        <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
          {count}
        </span>
      )}
    </button>
  );
}
