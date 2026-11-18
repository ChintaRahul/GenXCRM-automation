// e2e/specs/mfg/_coverage.spec.ts — every case in cases.json must be registered exactly once in specs/mfg.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import cases from "../../mfg/cases.json";

test("every manual case is accounted for exactly once", async () => {
  const dir = __dirname;
  const seen = new Map<string, string[]>();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".spec.ts") && !n.startsWith("_"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/\btc\(\s*["'`](TC-[A-Z0-9]+-\d{3})["'`]/g)) {
      seen.set(m[1], [...(seen.get(m[1]) ?? []), f]);
    }
  }
  const ids = (cases as { id: string }[]).map((c) => c.id);
  const missing = ids.filter((id) => !seen.has(id));
  const duplicated = [...seen].filter(([, files]) => files.length > 1).map(([id]) => id);
  const unknown = [...seen.keys()].filter((id) => !ids.includes(id));
  expect({ missing, duplicated, unknown }).toEqual({ missing: [], duplicated: [], unknown: [] });
});
