import { Clock, Eye } from "lucide-react";
import { cn } from "../../lib/utils";

// Consistent, clearly-visible markers for Administration surfaces that are
// either not built yet ("Coming soon") or intentionally non-editable
// ("Read only") — used in both the tab bar and inline next to specific
// disabled controls, so the same feature never has to explain itself twice.

export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        className,
      )}
    >
      <Clock className="w-3 h-3" />
      Coming soon
    </span>
  );
}

export function ReadOnlyBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Eye className="w-3 h-3" />
      Read only
    </span>
  );
}
