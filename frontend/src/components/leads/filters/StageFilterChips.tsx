import { FilterDropdown } from "../../filters/FilterDropdown";
import { FilterSectionHeader } from "../../filters/FilterSectionHeader";
import { statusDotClassName } from "../../shared/StatusBadge";
import type { LeadFacets } from "../../../types";

interface StageFilterChipsProps {
  facets: LeadFacets["stages"];
  value: string[];
  onChange: (next: string[]) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function triggerLabel(facets: LeadFacets["stages"], value: string[]): string {
  if (value.length === 0) return "Any stage";
  if (value.length === 1) {
    return facets.find((f) => f.value === value[0])?.value.replace(/_/g, " ") ?? value[0];
  }
  return `${value.length} stages selected`;
}

export function StageFilterChips({
  facets,
  value,
  onChange,
  open,
  onToggle,
  onClose,
}: StageFilterChipsProps) {
  const toggle = (stage: string) => {
    onChange(
      value.includes(stage)
        ? value.filter((s) => s !== stage)
        : [...value, stage],
    );
  };

  return (
    <div>
      <FilterSectionHeader title="Stage" onReset={() => onChange([])} />
      <FilterDropdown
        triggerLabel={triggerLabel(facets, value)}
        open={open}
        onToggle={onToggle}
        onClose={onClose}
      >
        <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto">
          {facets.map((f) => (
            <label
              key={f.value}
              className="flex items-center gap-2.5 py-1.5 px-1 rounded-md cursor-pointer text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={value.includes(f.value)}
                onChange={() => toggle(f.value)}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClassName(f.value)}`} />
              <span className="flex-1 text-foreground">{f.value.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">{f.count}</span>
            </label>
          ))}
        </div>
      </FilterDropdown>
    </div>
  );
}
