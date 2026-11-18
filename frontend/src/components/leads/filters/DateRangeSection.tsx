import { FilterSectionHeader } from "../../filters/FilterSectionHeader";
import { startOfMonthISO } from "../../../lib/utils";

export type DatePreset = "today" | "7d" | "30d" | "mtd" | "quarter" | "all";

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  mtd: "MTD",
  quarter: "This quarter",
  all: "All time",
};

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: DATE_PRESET_LABELS.today },
  { key: "7d", label: DATE_PRESET_LABELS["7d"] },
  { key: "30d", label: DATE_PRESET_LABELS["30d"] },
  { key: "mtd", label: DATE_PRESET_LABELS.mtd },
  { key: "quarter", label: DATE_PRESET_LABELS.quarter },
  { key: "all", label: DATE_PRESET_LABELS.all },
];

// The date shown in a date input. `from` values are ISO instants (local midnight), so reading
// their first 10 characters gives the UTC date — the previous day for anyone ahead of UTC.
export const toDateInputValue = (value: string): string => {
  if (!value) return "";
  if (!value.includes("T")) return value.slice(0, 10);
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Start of the local day `daysBack` days ago ("last 7 days" = today plus the 6 days before it).
const startOfDayDaysAgo = (daysBack: number): string => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysBack);
  return start.toISOString();
};

function presetToRange(preset: DatePreset): { from?: string; to?: string } {
  const now = new Date();
  if (preset === "all") return {};
  if (preset === "today") return { from: startOfDayDaysAgo(0) };
  if (preset === "7d") return { from: startOfDayDaysAgo(6) };
  if (preset === "30d") return { from: startOfDayDaysAgo(29) };
  if (preset === "mtd") {
    return { from: startOfMonthISO() };
  }
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const start = new Date(now.getFullYear(), quarterStartMonth, 1);
  return { from: start.toISOString() };
}

interface DateRangeSectionProps {
  preset: DatePreset | null;
  createdAfter: string;
  createdBefore: string;
  onChange: (next: {
    preset: DatePreset | null;
    createdAfter: string;
    createdBefore: string;
  }) => void;
}

export function DateRangeSection({
  preset,
  createdAfter,
  createdBefore,
  onChange,
}: DateRangeSectionProps) {
  return (
    <div>
      <FilterSectionHeader
        title="Date range"
        onReset={() => onChange({ preset: null, createdAfter: "", createdBefore: "" })}
      />
      <select
        value={preset ?? (createdAfter || createdBefore ? "custom" : "all")}
        onChange={(e) => {
          if (e.target.value === "custom") return;
          const next = e.target.value as DatePreset;
          const range = next === "all" ? {} : presetToRange(next);
          onChange({
            preset: next,
            createdAfter: range.from ?? "",
            createdBefore: range.to ?? "",
          });
        }}
        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mb-2.5"
      >
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        {!preset && (createdAfter || createdBefore) && <option value="custom">Custom</option>}
      </select>
      <p className="text-[11px] text-muted-foreground font-medium mb-1.5">Custom range</p>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={toDateInputValue(createdAfter)}
          onChange={(e) =>
            // Sent as a bare "YYYY-MM-DD" string, not a full ISO instant — leads.service.ts's
            // exclusiveEndOfDay() (createdBefore's inclusive-end-of-day +1-day adjustment)
            // only date-only strings (it deliberately skips any string containing "T"), so a
            // full ISO string here used to make the "to" date's own leads vanish from the
            // Leads page while still counted by Reports (see SCRUM-21).
            onChange({
              preset: null,
              createdAfter: e.target.value,
              createdBefore,
            })
          }
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={toDateInputValue(createdBefore)}
          onChange={(e) =>
            onChange({
              preset: null,
              createdAfter,
              createdBefore: e.target.value,
            })
          }
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}
