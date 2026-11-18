import { FilterSectionHeader } from "./FilterSectionHeader";

export type RangePreset = "today" | "mtd" | "7d" | "30d" | "90d" | "custom";

export interface DateRangeValue {
  readonly preset: RangePreset | null;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_DATE_RANGE: DateRangeValue = { preset: null, from: "", to: "" };

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  mtd: "This month (MTD)",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom",
};

interface DateRangeSelectProps {
  title?: string;
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
}

const inputClass =
  "h-9 max-[767px]:h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Preset select + from/to date inputs. Editing a date switches the preset to Custom. Presets
// are resolved to a concrete range server-side (datePreset), so only Custom carries from/to.
export function DateRangeSelect({ title = "Date range", value, onChange }: DateRangeSelectProps) {
  return (
    <div>
      <FilterSectionHeader title={title} uppercase onReset={() => onChange(EMPTY_DATE_RANGE)} />
      <select
        aria-label="Date range preset"
        value={value.preset ?? "all"}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next === "all" ? EMPTY_DATE_RANGE : { preset: next as RangePreset, from: "", to: "" });
        }}
        className="w-full h-9 max-[767px]:h-11 rounded-md border border-input bg-background px-2 text-xs text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mb-2.5"
      >
        <option value="all">All time</option>
        {(Object.keys(RANGE_PRESET_LABELS) as RangePreset[]).map((key) => (
          <option key={key} value={key}>
            {RANGE_PRESET_LABELS[key]}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label="From date"
          value={value.from}
          onChange={(e) => onChange({ preset: "custom", from: e.target.value, to: value.to })}
          className={inputClass}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          aria-label="To date"
          value={value.to}
          onChange={(e) => onChange({ preset: "custom", from: value.from, to: e.target.value })}
          className={inputClass}
        />
      </div>
    </div>
  );
}
