import { describe, it, expect } from "vitest";
import { suggestionsFor } from "../modules/fieldPresets";

describe("suggestionsFor", () => {
  it("returns the curated preset for known keys, in its own order", () => {
    const states = suggestionsFor("state", []);
    expect(states?.[0]).toBe("Andhra Pradesh");
    expect(states).toContain("Maharashtra");
  });

  it("offers 08:00–19:30 in 30-minute steps for time", () => {
    const slots = suggestionsFor("time", []);
    expect(slots?.[0]).toBe("08:00");
    expect(slots?.at(-1)).toBe("19:30");
    expect(slots).toHaveLength(24);
  });

  it("builds a sorted, de-duplicated list from stored values once there are two or more", () => {
    expect(suggestionsFor("city", ["Pune", "Chennai", "Pune"])).toEqual(["Chennai", "Pune"]);
  });

  it("stays a plain text box with fewer than two known values", () => {
    expect(suggestionsFor("category", ["Spares"])).toBeNull();
  });

  it("never suggests for unique / free-text fields", () => {
    expect(suggestionsFor("name", ["A", "B", "C"])).toBeNull();
    expect(suggestionsFor("phone", ["9000000001", "9000000002"])).toBeNull();
    expect(suggestionsFor("email", ["a@x.com", "b@x.com"])).toBeNull();
  });
});
