// frontend/src/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { REGISTRY } from "../modules/registry";

describe("registry (Batch A)", () => {
  it("leads has the fields, statuses, actions and tabs from mfg-schema.js", () => {
    const leads = REGISTRY.leads;
    expect(leads.title).toBe("Leads");
    expect(leads.idPrefix).toBe("LD-");
    expect(leads.statuses.map((s) => s.value)).toEqual([
      "New", "Assigned", "Contacted", "Follow-up", "Qualified", "Nurture", "Disqualified", "Converted",
    ]);
    expect(leads.flow).toEqual(["New", "Assigned", "Contacted", "Follow-up", "Qualified"]);
    expect(leads.dupKeys).toEqual(["phone", "email", "company"]);
    expect(leads.fields.find((f) => f.key === "company")).toMatchObject({ required: true, section: "Prospect" });
    expect(leads.actions?.find((a) => a.label === "Convert to opportunity")).toMatchObject({
      special: "convert",
      when: ["Qualified"],
      primary: true,
    });
    expect(leads.actions?.find((a) => a.label === "Disqualify")?.ask).toMatchObject({ key: "disq", required: true });
    expect(leads.tabs.map((t) => t.key)).toEqual(["overview", "qual", "acts"]);
  });

  it("accounts, contacts, activities, opps are present with their idPrefix and dupKeys/kanban flags", () => {
    expect(REGISTRY.accounts).toMatchObject({ idPrefix: "A-", dupKeys: ["name", "gstin"], hasDocs: true });
    expect(REGISTRY.contacts).toMatchObject({ idPrefix: "C-", dupKeys: ["phone", "email"] });
    expect(REGISTRY.activities).toMatchObject({ idPrefix: "T-" });
    expect(REGISTRY.opps).toMatchObject({ idPrefix: "OP-", kanban: true, hasDocs: true, statusKey: "stage" });
    expect(REGISTRY.opps.statuses.length).toBe(REGISTRY.opps.flow!.length + 2); // + Won + Lost
  });

  it("opps' Mark lost action carries the LOST reasons as its ask field's options", () => {
    const lostAction = REGISTRY.opps.actions?.find((a) => a.label === "Mark lost");
    expect(lostAction?.ask?.options).toContain("Price");
    expect(lostAction?.ask?.options).toContain("Competitor");
  });
});

describe("registry (Batch B)", () => {
  it("costing has 13 cost-component money fields plus the margin fields, and is restricted", () => {
    const costing = REGISTRY.costing;
    expect(costing.restricted).toBe(true);
    const costFields = costing.fields.filter((f) => f.section === "Cost components");
    expect(costFields).toHaveLength(13);
    expect(costFields.every((f) => f.type === "money")).toBe(true);
    expect(costing.fields.find((f) => f.key === "gmPct")).toMatchObject({ type: "pct", readOnly: true });
  });

  it("quotes has a flow, a dup-free config, and a Revise action with no `when` restriction issue (uses `when`, not `notWhen`)", () => {
    const quotes = REGISTRY.quotes;
    expect(quotes.flow).toEqual(["Draft", "Approval pending", "Approved", "Sent", "Accepted"]);
    const revise = quotes.actions?.find((a) => a.label === "Revise → new version");
    expect(revise?.when).toEqual(["Sent", "Approved", "Rejected", "Approval pending"]);
  });

  it("quotes' Line items tab has lineColumns configured (so it doesn't fall back to the unconfigured placeholder)", () => {
    const linesTab = REGISTRY.quotes.tabs.find((t) => t.key === "lines");
    expect(linesTab?.kind).toBe("lines");
    expect(linesTab?.lineColumns?.map((c) => c.key)).toEqual([
      "productId", "description", "qty", "unitPrice", "discountPct", "amount",
    ]);
  });

  it("products' Specification attributes tab has lineColumns configured", () => {
    const attrsTab = REGISTRY.products.tabs.find((t) => t.key === "attrs");
    expect(attrsTab?.kind).toBe("lines");
    expect(attrsTab?.lineColumns?.map((c) => c.key)).toEqual(["name", "value"]);
  });

  it("rfqs, visits, demos, products, approvals are present with their idPrefix", () => {
    expect(REGISTRY.rfqs).toMatchObject({ idPrefix: "RFQ-" });
    expect(REGISTRY.visits).toMatchObject({ idPrefix: "SV-" });
    expect(REGISTRY.demos).toMatchObject({ idPrefix: "EV-" });
    expect(REGISTRY.products).toMatchObject({ idPrefix: "P-" });
    expect(REGISTRY.approvals).toMatchObject({ idPrefix: "AP-" });
  });

  it("products' minPrice and cost fields are restricted", () => {
    const products = REGISTRY.products;
    expect(products.fields.find((f) => f.key === "minPrice")?.restricted).toBe(true);
    expect(products.fields.find((f) => f.key === "cost")?.restricted).toBe(true);
  });
});

describe("registry (Batch C)", () => {
  it("sorders' statuses/flow come from the 11-step ORDER_FLOW with the right tone bands", () => {
    const sorders = REGISTRY.sorders;
    expect(sorders.flow).toHaveLength(11);
    expect(sorders.statuses[0]).toMatchObject({ value: "Order accepted", tone: "blue" });
    expect(sorders.statuses[6]).toMatchObject({ value: "Dispatched", tone: "teal" });
    expect(sorders.statuses[10]).toMatchObject({ value: "Closed", tone: "green" });
  });

  it("reports uses `scheduleFrequency` as its statusKey and noCreate", () => {
    expect(REGISTRY.reports).toMatchObject({ statusKey: "scheduleFrequency", noCreate: true });
  });

  it("all Batch C modules are present with their idPrefix", () => {
    const expectedPrefixes: Record<string, string> = {
      pos: "PO-", sorders: "SO-", dispatch: "DS-", payments: "PM-", assets: "AS-",
      amc: "CV-", service: "ST-", reports: "R-", nurturing: "NS-", templates: "TP-",
      team: "U-", integrations: "IN-", billing: "INV-",
    };
    for (const [key, prefix] of Object.entries(expectedPrefixes)) {
      expect(REGISTRY[key], `REGISTRY.${key} should exist`).toBeDefined();
      expect(REGISTRY[key].idPrefix).toBe(prefix);
    }
  });

  it("REGISTRY has exactly 25 mfg-schema.js modules plus the 5 Phase 5 Administration config modules", () => {
    // NOTE: the task brief's checklist says "24 modules total", but
    // mfg-schema.js actually defines 25 `M.xxx = {...}` entries end to end
    // (verified directly: 5 in Batch A + 7 in Batch B + 13 in Batch C = 25,
    // confirmed via `grep -n "^M\.\w* = "` against the full source file).
    // Transcription accuracy against the real source takes precedence over
    // the brief's arithmetic, per this task's own instructions — flagged in
    // the Task 3 report for the plan author to reconcile.
    //
    // Phase 5 (Manufacturing SLA engine + Administration) added 5 more registry
    // entries with no mfg-schema.js equivalent — approvalRules, automationRules,
    // masters, holidays, docTemplates — for the Administration > Manufacturing
    // config pages, bringing the total to 30.
    // Dealers, tenders and the ERP connection (Phase 2/3) bring it to 33.
    expect(Object.keys(REGISTRY)).toHaveLength(33);
  });
});

describe("registry structural invariants", () => {
  const modules = Object.entries(REGISTRY);

  it("every module has at least one status, one field, and one column", () => {
    for (const [key, mod] of modules) {
      expect(mod.statuses.length, `${key}.statuses`).toBeGreaterThan(0);
      expect(mod.fields.length, `${key}.fields`).toBeGreaterThan(0);
      expect(mod.cols.length, `${key}.cols`).toBeGreaterThan(0);
    }
  });

  it("every action's `to` (if present) is one of that module's own status values", () => {
    for (const [key, mod] of modules) {
      const validStatuses = new Set(mod.statuses.map((s) => s.value));
      for (const action of mod.actions ?? []) {
        if (action.to) {
          expect(validStatuses.has(action.to), `${key} action "${action.label}" targets unknown status "${action.to}"`).toBe(true);
        }
      }
    }
  });

  it("every action's `when`/`notWhen` entries (if present) are valid status values for that module", () => {
    for (const [key, mod] of modules) {
      const validStatuses = new Set(mod.statuses.map((s) => s.value));
      for (const action of mod.actions ?? []) {
        for (const s of [...(action.when ?? []), ...(action.notWhen ?? [])]) {
          expect(validStatuses.has(s), `${key} action "${action.label}" references unknown status "${s}"`).toBe(true);
        }
      }
    }
  });

  it("every `related` tab's relatedModule exists in REGISTRY", () => {
    for (const [key, mod] of modules) {
      for (const tab of mod.tabs) {
        if (tab.kind === "related") {
          expect(tab.relatedModule, `${key} tab "${tab.key}" has no relatedModule`).toBeDefined();
          expect(REGISTRY[tab.relatedModule!], `${key} tab "${tab.key}" references unknown module "${tab.relatedModule}"`).toBeDefined();
        }
      }
    }
  });

  it("every `ref`-type field's `ref` module exists in REGISTRY", () => {
    for (const [key, mod] of modules) {
      for (const field of mod.fields) {
        if (field.type === "ref") {
          expect(field.ref, `${key} field "${field.key}" is type ref but has no ref module`).toBeDefined();
          expect(REGISTRY[field.ref!], `${key} field "${field.key}" references unknown module "${field.ref}"`).toBeDefined();
        }
      }
    }
  });

  it("every `flow` value (if present) is one of that module's own status values", () => {
    for (const [key, mod] of modules) {
      if (!mod.flow) continue;
      const validStatuses = new Set(mod.statuses.map((s) => s.value));
      for (const s of mod.flow) {
        expect(validStatuses.has(s), `${key} flow references unknown status "${s}"`).toBe(true);
      }
    }
  });

  it("every module with a dupKeys entry has fields for every one of those keys", () => {
    for (const [key, mod] of modules) {
      if (!mod.dupKeys) continue;
      const fieldKeys = new Set(mod.fields.map((f) => f.key));
      for (const dupKey of mod.dupKeys) {
        expect(fieldKeys.has(dupKey), `${key} dupKeys references field "${dupKey}" not in its own fields`).toBe(true);
      }
    }
  });
});
