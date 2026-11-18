import { describe, it, expect } from "vitest";
import { selectedToCsv } from "../lib/moduleCsv";
import type { ModuleColumn } from "../modules/registry";

describe("selectedToCsv", () => {
  it("writes a header row plus one quoted row per record, escaping quotes", () => {
    const cols = [{ key: "name", label: "Name" }, { key: "note", label: "Note" }] as unknown as ModuleColumn[];
    const csv = selectedToCsv([{ id: "1", name: 'Acme "A"', note: null }], cols);
    expect(csv).toBe('"Name","Note"\n"Acme ""A""",""');
  });
});
