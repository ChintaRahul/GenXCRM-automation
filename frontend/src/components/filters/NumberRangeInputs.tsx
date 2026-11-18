import { FilterSectionHeader } from "./FilterSectionHeader";

interface NumberRangeInputsProps {
  title: string;
  unit: string;
  min: string;
  max: string;
  onChange: (next: { min: string; max: string }) => void;
}

const inputClass =
  "h-9 max-[767px]:h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Min / max numeric inputs (kept as strings so a half-typed value isn't coerced mid-edit).
export function NumberRangeInputs({ title, unit, min, max, onChange }: NumberRangeInputsProps) {
  return (
    <div>
      <FilterSectionHeader title={`${title} (${unit})`} uppercase onReset={() => onChange({ min: "", max: "" })} />
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          aria-label={`${title} minimum`}
          placeholder="Min"
          value={min}
          onChange={(e) => onChange({ min: e.target.value, max })}
          className={inputClass}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="number"
          min={0}
          aria-label={`${title} maximum`}
          placeholder="Max"
          value={max}
          onChange={(e) => onChange({ min, max: e.target.value })}
          className={inputClass}
        />
      </div>
    </div>
  );
}
