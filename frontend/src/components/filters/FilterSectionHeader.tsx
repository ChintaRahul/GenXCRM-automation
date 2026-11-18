import { cn } from "../../lib/utils";

interface FilterSectionHeaderProps {
  title: string;
  onReset?: () => void;
  // 11px uppercase label (Manufacturing drawer) instead of the Leads drawer's sentence-case title.
  uppercase?: boolean;
}

// Section label + "Reset" link, matching the hifi design's per-section header
// row (Date range / Stage / Source / Owner / Course / City).
export function FilterSectionHeader({ title, onReset, uppercase = false }: FilterSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p
        className={cn(
          "font-semibold text-foreground",
          uppercase ? "text-[11px] uppercase tracking-[0.06em] text-muted-foreground" : "text-xs",
        )}
      >
        {title}
      </p>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] font-semibold text-primary hover:underline max-[767px]:min-h-11 max-[767px]:px-2"
        >
          Reset
        </button>
      )}
    </div>
  );
}
