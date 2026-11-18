import type { ModuleDef, ModuleField } from "../modules/registry";
import type { ModuleFacets, ModuleListParams } from "../api/modules";
import { EMPTY_DATE_RANGE, RANGE_PRESET_LABELS, type DateRangeValue } from "../components/filters/DateRangeSelect";

// Filter state for a Manufacturing module list. Filters AND across facets and OR within one.
export interface ModuleFilters {
  status: string[];
  ownerId: string[];
  // registry select-field key -> chosen option values
  facets: Record<string, string[]>;
  date: DateRangeValue;
  // Value range is typed in ₹ lakh (what people think in) and sent as rupees.
  valueMin: string;
  valueMax: string;
  slaRisk: boolean;
}

export const emptyModuleFilters = (): ModuleFilters => ({
  status: [],
  ownerId: [],
  facets: {},
  date: EMPTY_DATE_RANGE,
  valueMin: "",
  valueMax: "",
  slaRisk: false,
});

const LAKH = 100_000;
export const HIGH_VALUE_LAKH = 50;
const MAX_FACETS = 4;

// Dot colour per registry status tone (matches StatusBadge's tone palette).
export const TONE_DOT: Record<string, string> = {
  gray: "bg-gray-400",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  red: "bg-red-500",
  violet: "bg-purple-500",
};

// Up to 4 `select` fields to offer as facets: not the status field, not hidden or restricted
// (field security), and only those the backend actually filters on (it returns counts for them).
export function facetFieldsOf(def: ModuleDef, available: readonly string[]): ModuleField[] {
  const statusKey = def.statusKey ?? "status";
  return def.fields
    .filter((f) => f.type === "select" && f.key !== statusKey && !f.hidden && !f.restricted && available.includes(f.key))
    .slice(0, MAX_FACETS);
}

// `created` if the module has it, else its first `date` field.
export function dateFieldOf(def: ModuleDef): ModuleField | undefined {
  return def.fields.find((f) => f.key === "created") ?? def.fields.find((f) => f.type === "date");
}

// First non-restricted money field.
export function valueFieldOf(def: ModuleDef): ModuleField | undefined {
  return def.fields.find((f) => f.type === "money" && !f.restricted);
}

export const hasSla = (def: ModuleDef): boolean => def.cols.some((c) => c.type === "sla");

const toRupees = (lakh: string): number | undefined => {
  if (lakh.trim() === "") return undefined;
  const n = Number(lakh);
  return Number.isFinite(n) ? n * LAKH : undefined;
};

type FilterParams = Pick<
  ModuleListParams,
  "status" | "ownerId" | "facets" | "datePreset" | "from" | "to" | "valueMin" | "valueMax" | "slaRisk"
>;

// Builds the API query for a filter state. Empty filters are omitted entirely.
export function toFilterParams(f: ModuleFilters): FilterParams {
  const facets = Object.fromEntries(Object.entries(f.facets).filter(([, values]) => values.length > 0));
  const { preset, from, to } = f.date;
  return {
    status: f.status.length ? f.status : undefined,
    ownerId: f.ownerId.length ? f.ownerId : undefined,
    facets: Object.keys(facets).length ? JSON.stringify(facets) : undefined,
    datePreset: preset ?? undefined,
    from: preset === "custom" && from ? from : undefined,
    to: preset === "custom" && to ? to : undefined,
    valueMin: toRupees(f.valueMin),
    valueMax: toRupees(f.valueMax),
    slaRisk: f.slaRisk || undefined,
  };
}

export interface FilterEntry {
  readonly key: string;
  readonly label: string;
  readonly remove: (f: ModuleFilters) => ModuleFilters;
}

function dateLabel({ preset, from, to }: DateRangeValue): string {
  if (preset && preset !== "custom") return RANGE_PRESET_LABELS[preset];
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  return `Until ${to}`;
}

function valueLabel(min: string, max: string): string {
  if (min && max) return `₹${min}–${max} L`;
  return min ? `≥ ₹${min} L` : `≤ ₹${max} L`;
}

// One entry per active filter *value* (so the badge counts values, not groups).
export function describeFilters(f: ModuleFilters, ownerName: (id: string) => string): FilterEntry[] {
  const entries: FilterEntry[] = [];

  for (const s of f.status) {
    entries.push({ key: `status:${s}`, label: s, remove: (cur) => ({ ...cur, status: cur.status.filter((v) => v !== s) }) });
  }
  for (const id of f.ownerId) {
    entries.push({ key: `owner:${id}`, label: ownerName(id), remove: (cur) => ({ ...cur, ownerId: cur.ownerId.filter((v) => v !== id) }) });
  }
  for (const [field, values] of Object.entries(f.facets)) {
    for (const value of values) {
      entries.push({
        key: `facet:${field}:${value}`,
        label: value,
        remove: (cur) => ({ ...cur, facets: { ...cur.facets, [field]: (cur.facets[field] ?? []).filter((v) => v !== value) } }),
      });
    }
  }
  if (f.date.preset) {
    entries.push({ key: "date", label: dateLabel(f.date), remove: (cur) => ({ ...cur, date: EMPTY_DATE_RANGE }) });
  }
  if (f.valueMin !== "" || f.valueMax !== "") {
    entries.push({ key: "value", label: valueLabel(f.valueMin, f.valueMax), remove: (cur) => ({ ...cur, valueMin: "", valueMax: "" }) });
  }
  if (f.slaRisk) {
    entries.push({ key: "sla", label: "SLA at risk", remove: (cur) => ({ ...cur, slaRisk: false }) });
  }
  return entries;
}

export interface BuiltInView {
  readonly key: string;
  readonly label: string;
  readonly isActive: (f: ModuleFilters) => boolean;
  readonly apply: (f: ModuleFilters) => ModuleFilters;
  readonly clear: (f: ModuleFilters) => ModuleFilters;
}

// Built-in views are derived from what the module has: SLA, a money field, a date field.
export function builtInViews(def: ModuleDef, caps: ModuleFacets["capabilities"]): BuiltInView[] {
  const views: BuiltInView[] = [];
  if (caps.sla && hasSla(def)) {
    views.push({
      key: "sla-risk",
      label: "SLA at risk",
      isActive: (f) => f.slaRisk,
      apply: (f) => ({ ...f, slaRisk: true }),
      clear: (f) => ({ ...f, slaRisk: false }),
    });
  }
  if (caps.value && valueFieldOf(def)) {
    views.push({
      key: "high-value",
      label: `High value (≥ ₹${HIGH_VALUE_LAKH} L)`,
      isActive: (f) => f.valueMin === String(HIGH_VALUE_LAKH),
      apply: (f) => ({ ...f, valueMin: String(HIGH_VALUE_LAKH) }),
      clear: (f) => ({ ...f, valueMin: "" }),
    });
  }
  if (caps.date && dateFieldOf(def)) {
    views.push({
      key: "last-7",
      label: "Last 7 days",
      isActive: (f) => f.date.preset === "7d",
      apply: (f) => ({ ...f, date: { preset: "7d", from: "", to: "" } }),
      clear: (f) => ({ ...f, date: EMPTY_DATE_RANGE }),
    });
  }
  return views;
}

// Stored views come back from JSON, so tolerate older / partial shapes.
export function normalizeStoredFilters(raw: unknown): ModuleFilters {
  const base = emptyModuleFilters();
  if (typeof raw !== "object" || raw === null) return base;
  return { ...base, ...(raw as Partial<ModuleFilters>) };
}

export const sameFilters = (a: ModuleFilters, b: ModuleFilters): boolean =>
  JSON.stringify(toFilterParams(a)) === JSON.stringify(toFilterParams(b));
