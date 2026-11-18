import { X } from "lucide-react";

export interface FilterChip {
  readonly key: string;
  readonly label: string;
  readonly onRemove: () => void;
}

interface ActiveFilterStripProps {
  chips: readonly FilterChip[];
  onClearAll: () => void;
}

// One removable chip per active filter value + "Clear all". Renders nothing when empty.
export function ActiveFilterStrip({ chips, onClearAll }: ActiveFilterStripProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 max-w-full h-7 pl-2.5 pr-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
        >
          <span className="truncate" title={chip.label}>
            {chip.label}
          </span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter ${chip.label}`}
            className="relative inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-primary/20 before:absolute before:-inset-3 before:content-['']"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="text-xs font-semibold text-primary hover:underline px-1 max-[767px]:min-h-11 max-[767px]:px-3">
        Clear all
      </button>
    </div>
  );
}
