import { describe, it, expect } from "vitest";
import {
  builtInViews,
  describeFilters,
  emptyModuleFilters,
  facetFieldsOf,
  normalizeStoredFilters,
  sameFilters,
  toFilterParams,
} from "../lib/moduleFilters";
import { REGISTRY } from "../modules/registry";

const caps = { owner: true, date: true, value: true, sla: true };

describe("toFilterParams", () => {
  it("omits everything when no filter is set", () => {
    expect(toFilterParams(emptyModuleFilters())).toEqual({
      status: undefined,
      ownerId: undefined,
      facets: undefined,
      datePreset: undefined,
      from: undefined,
      to: undefined,
      valueMin: undefined,
      valueMax: undefined,
      slaRisk: undefined,
    });
  });

  it("sends arrays, drops empty facet groups, and converts ₹ lakh to rupees", () => {
    const params = toFilterParams({
      ...emptyModuleFilters(),
      status: ["Won", "Lost"],
      ownerId: ["u1"],
      facets: { product: ["Conveyor"], source: [] },
      valueMin: "50",
      valueMax: "120.5",
      slaRisk: true,
    });
    expect(params.status).toEqual(["Won", "Lost"]);
    expect(params.ownerId).toEqual(["u1"]);
    expect(params.facets).toBe(JSON.stringify({ product: ["Conveyor"] }));
    expect(params.valueMin).toBe(5_000_000);
    expect(params.valueMax).toBe(12_050_000);
    expect(params.slaRisk).toBe(true);
  });

  it("sends from/to only for a custom range, and just the preset otherwise", () => {
    const custom = toFilterParams({ ...emptyModuleFilters(), date: { preset: "custom", from: "2026-09-01", to: "2026-09-30" } });
    expect(custom).toMatchObject({ datePreset: "custom", from: "2026-09-01", to: "2026-09-30" });
    const preset = toFilterParams({ ...emptyModuleFilters(), date: { preset: "30d", from: "", to: "" } });
    expect(preset).toMatchObject({ datePreset: "30d", from: undefined, to: undefined });
  });

  it("ignores a non-numeric value bound", () => {
    expect(toFilterParams({ ...emptyModuleFilters(), valueMin: "abc" }).valueMin).toBeUndefined();
  });
});

describe("describeFilters", () => {
  it("makes one chip per value (so the badge counts values, not groups) and each removes only itself", () => {
    const filters = { ...emptyModuleFilters(), status: ["Won", "Lost"], facets: { source: ["Meta"] }, slaRisk: true };
    const entries = describeFilters(filters, (id) => id);
    expect(entries.map((e) => e.label)).toEqual(["Won", "Lost", "Meta", "SLA at risk"]);
    expect(entries[0].remove(filters).status).toEqual(["Lost"]);
    expect(entries[2].remove(filters).facets.source).toEqual([]);
    expect(entries[3].remove(filters).slaRisk).toBe(false);
  });

  it("labels owners by name and a date/value range as one chip each", () => {
    const filters = { ...emptyModuleFilters(), ownerId: ["u1"], date: { preset: "7d" as const, from: "", to: "" }, valueMin: "50" };
    const labels = describeFilters(filters, () => "Asha D").map((e) => e.label);
    expect(labels).toEqual(["Asha D", "Last 7 days", "≥ ₹50 L"]);
  });
});

describe("facetFieldsOf", () => {
  it("keeps only select fields the backend supports, never the status field, capped at 4", () => {
    const fields = facetFieldsOf(REGISTRY.leads, ["industry", "product", "source", "timeline", "qBudget", "status"]).map((f) => f.key);
    expect(fields).toEqual(["industry", "product", "source", "timeline"]);
  });

  it("drops fields the backend does not list (e.g. not whitelisted)", () => {
    expect(facetFieldsOf(REGISTRY.accounts, ["industry"]).map((f) => f.key)).toEqual(["industry"]);
  });
});

describe("builtInViews", () => {
  it("derives SLA / High value / Last 7 days from what the module has", () => {
    const keys = builtInViews(REGISTRY.opps, caps).map((v) => v.key);
    expect(keys).toEqual(["sla-risk", "high-value", "last-7"]);
  });

  it("omits SLA for a module without an SLA column", () => {
    expect(builtInViews(REGISTRY.accounts, { ...caps, sla: false }).map((v) => v.key)).not.toContain("sla-risk");
  });

  it("toggles on and off", () => {
    const [sla] = builtInViews(REGISTRY.opps, caps);
    const on = sla.apply(emptyModuleFilters());
    expect(sla.isActive(on)).toBe(true);
    expect(sla.isActive(sla.clear(on))).toBe(false);
  });
});

describe("stored views", () => {
  it("fills missing keys so an older stored view still applies", () => {
    expect(normalizeStoredFilters({ status: ["Won"] })).toEqual({ ...emptyModuleFilters(), status: ["Won"] });
    expect(normalizeStoredFilters(null)).toEqual(emptyModuleFilters());
  });

  it("compares filters by what they send to the API", () => {
    expect(sameFilters({ ...emptyModuleFilters(), facets: { a: [] } }, emptyModuleFilters())).toBe(true);
    expect(sameFilters({ ...emptyModuleFilters(), slaRisk: true }, emptyModuleFilters())).toBe(false);
  });
});
