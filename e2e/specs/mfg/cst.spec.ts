// e2e/specs/mfg/cst.spec.ts - Costing & margin (TC-CST-001..013): create, totals, margin routing, status guards, revisions, restricted access.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { readApprovalRule, restoreMarginRulesIfNeeded, withMarginRulesDisabled } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { pdfText } from "../../mfg/pdf";

type Rec = Record<string, unknown>;
type Sla = { l: string; t: string } | null;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
const sheetOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/costing/${id}`), "read costing sheet");
const DETAIL_RE = /\/costing\/[0-9a-f-]{36}$/;
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";

/** The case's cost lines: 400000 + 100000 + 150000 + 50000 = 700000. */
const COSTS = { material: 400_000, boughtOut: 100_000, fabrication: 150_000, labor: 50_000 };
/** Cost lines that give exactly `pct` % margin on a 1,000,000 selling price. */
const costsForMargin = (pct: number): Rec => ({ material: 1_000_000 - pct * 10_000, boughtOut: 0, fabrication: 0, labor: 0 });

/** Opportunity (owned by salesExec1) + a Draft costing sheet created by Commercial. */
const newSheet = async (over: Rec = {}) => {
  const sales = await apiAs("salesExec1");
  const commercial = await apiAs("commercial");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const sheet = rec(await build.costing(commercial, { ...COSTS, sellingPrice: 1_000_000, ...over, opportunityId: opp.id, accountId: account.id }), "create costing sheet");
  return { sales, commercial, account, opp, id: sheet.id as string };
};
const submitted = async (over: Rec = {}) => {
  const ctx = await newSheet(over);
  const result = rec(await ctx.commercial.action("costing", ctx.id, "Submit"), "submit costing sheet");
  return { ...ctx, result };
};
/** Margin approvals of a sheet (the list ignores ?entityId, so it is filtered client-side). */
const approvalsOf = async (api: ApiClient, sheetId: string): Promise<Rec[]> => {
  const list = ok(await api.get("/modules/approvals?limit=100"), "list approvals").body.data ?? [];
  return list.filter((a) => a.entityId === sheetId);
};
const BREAKDOWN_LABELS = ["Material", "Bought-out items", "Fabrication", "Electrical", "Software", "Labour", "Installation", "Freight", "Packing", "Travel", "Overhead", "Contingency", "Other"];
const expectBreakdown = async (page: Page, shown: Record<string, string>): Promise<void> => {
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("row")).toHaveCount(BREAKDOWN_LABELS.length + 1); // header + one row per component
  for (const label of BREAKDOWN_LABELS) {
    await expect(panel.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) }).getByRole("cell").nth(1)).toHaveText(shown[label] ?? "₹0");
  }
};

// A previous run that died while the Margin rules were switched off (TC-CST-007) is healed before anything depends on routing.
test.beforeAll(async () => {
  await restoreMarginRulesIfNeeded();
});

test.describe("Costing - Commercial", () => {
  test.use({ storageState: authFile("commercial") });

  tc("TC-CST-001", async ({ page }) => {
    test.slow(); // cold stack
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id);
    await build.approvedRfq({ opportunityId: opp.id, accountId: account.id }); // costing is gated on an approved RFQ
    const fields = {
      opportunityId: opp.id, accountId: account.id, ownerId: await userIdOf("commercial"), material: 400_000, boughtOut: 100_000, fabrication: 150_000,
      electrical: 10_000, software: 5_000, labor: 50_000, installation: 20_000, freight: 15_000, packing: 5_000, travel: 8_000, overhead: 30_000,
      contingency: 12_000, other: 1_000, sellingPrice: 1_000_000,
    };
    const list = new ModuleList(page, "costing");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // A sales-role user has no owner picker on this form (the sheet is owned by whoever saves it): everything else is filled in.
    const { ownerId: _owner, ...formFields } = fields;
    await drawer.fill(formFields);
    await drawer.save();
    await expect(drawer.error.or(page.getByRole("button", { name: "More actions", exact: true }))).toBeVisible({ timeout: 15_000 });
    // Spec: all cost lines and the selling price are saved from the form. Money fields are posted as strings and the API rejects them (D-6).
    await expect(page).toHaveURL(DETAIL_RE, { timeout: 1_000 });
    let id: string;
    if (DETAIL_RE.test(page.url())) {
      id = idFromUrl(page);
    } else {
      await expect(drawer.error).toHaveText("Couldn't save — please try again.");
      id = rec(await commercial.post("/modules/costing", fields), "create the same sheet through the API").id as string;
    }
    const sheet = await sheetOf(commercial, id);
    expect(sheet).toMatchObject({ status: "Draft", ...fields });
    expect([0, 1], "revision of a new sheet (spec: 0/1)").toContain(sheet.revision);
    // SLA-10 'Costing preparation' is running (not yet Met)
    expect(sheet.sla, "SLA-10 timer exists").not.toBeNull();
    expect((sheet.sla as Sla)?.l).not.toBe("Met");
    // listed (search is by opportunity id) and the detail shows it in Draft
    await list.goto();
    await list.search(opp.id);
    await expect(list.row("Draft")).toBeVisible();
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Draft");
    await detail.expectAction("Submit");
  });

  tc("TC-CST-002", async ({ page }) => {
    const { commercial, id, result } = await submitted();
    // Submit reports the computed figures
    expect(result).toMatchObject({ total: 700_000, gm: 300_000, gmPct: 30, status: "Approval pending" });
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    await detail.tab("Cost breakdown");
    await expectBreakdown(page, { Material: "₹4.0 L", "Bought-out items": "₹1.0 L", Fabrication: "₹1.5 L", Labour: "₹50,000" });
    // Spec: Total cost 700000, Gross margin 300000, Margin % 30.00 are visible on the sheet. Submit only returns them in its response: they are not
    // stored, so the record read back (and the Sheet tab / list columns that render it) has no total, gm or gmPct.
    const sheet = await sheetOf(commercial, id);
    await detail.tab("Sheet");
    await expect(page.getByRole("tabpanel").getByText("Proposed selling price")).toBeVisible(); // Sheet tab loaded
    await knownDefect(test.info(), "D-51", async () => {
      expect([sheet.total, sheet.gm, sheet.gmPct], "total / gm / gmPct on the stored sheet").toEqual([700_000, 300_000, 30]);
    });
    await knownDefect(test.info(), "D-51", async () => {
      await expect(page.getByRole("tabpanel").getByText("₹7.0 L"), "Total cost on the Sheet tab").toBeVisible({ timeout: 1_000 });
    });
  });

  tc("TC-CST-003", async () => {
    const { result, id, commercial } = await submitted({ sellingPrice: 0 });
    // no crash: 0 / 0 is reported as 0 % margin, the loss shows as negative gross margin
    expect(result).toMatchObject({ total: 700_000, gm: -700_000, gmPct: 0, status: "Approval pending" });
    expect((await sheetOf(commercial, id)).status).toBe("Approval pending");
    // gmPct 0 sits in the lowest band (0-15) -> Director
    expect((await approvalsOf(commercial, id)).map((a) => a.currentApprover)).toEqual(["Director"]);
  });

  tc("TC-CST-004", async ({ page }) => {
    // Spec asks to document the outcome: 30% is above the highest band (15-20) and falls into that top band -> Sales Head, 'Approval pending'
    // (verificationNote: confirmed live; whether this is the intended business rule is open).
    const { commercial, id, result } = await submitted();
    expect(result).toMatchObject({ gmPct: 30, status: "Approval pending" });
    const approvals = await approvalsOf(commercial, id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ type: "Margin", status: "Requested", currentApprover: "Sales Head" });
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Approval pending");
  });

  tc("TC-CST-005", async ({ page }) => {
    const { commercial, id } = await newSheet(costsForMargin(12));
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Draft");
    await detail.action("Submit");
    await expect.poll(() => detail.statusText()).toBe("Approval pending");
    const sheet = await sheetOf(commercial, id);
    expect(sheet.status).toBe("Approval pending");
    expect((sheet.sla as Sla)?.l, "SLA-10 stops on submit").toBe("Met");
    const approvals = await approvalsOf(commercial, id);
    expect(approvals).toHaveLength(1);
    const [approval] = approvals;
    expect(approval).toMatchObject({ type: "Margin", status: "Requested", currentApprover: "Director", entityType: "Costing" });
    // SLA-14 'Approval turnaround' runs on the approval
    expect(approval?.sla, "SLA-14 timer exists").not.toBeNull();
    expect((approval?.sla as Sla)?.l).not.toBe("Met");
    await detail.expectAction("Approve");
    await detail.expectNoAction("Submit");
  });

  tc("TC-CST-006", async () => {
    const { commercial, id, result } = await submitted(costsForMargin(17));
    expect(result).toMatchObject({ gmPct: 17, status: "Approval pending" });
    const approvals = await approvalsOf(commercial, id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ type: "Margin", status: "Requested", currentApprover: "Sales Head" });
    const matchedRule = approvals[0]?.matchedRule as string;
    expect(matchedRule).toMatch(/^[0-9a-f-]{36}$/);
    expect(approvals[0]?.reason).toBe(`GM% 17.00 matched rule ${matchedRule}`);
    // the matched rule is the seeded 15-20 band (read from the database: the rules module is 403, D-50)
    expect(await readApprovalRule(matchedRule)).toMatchObject({ type: "Margin", min: 15, max: 20, approverRole: "Sales Head" });
  });

  tc("TC-CST-008", async ({ page }) => {
    const { commercial, id } = await submitted();
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Approval pending");
    await detail.expectNoAction("Submit"); // the UI offers Submit for Draft / Rejected only
    await expectActionRejected(commercial, "costing", id, "Submit", {}, "Cannot submit a costing sheet in status 'Approval pending'.");
    expect((await sheetOf(commercial, id)).status).toBe("Approval pending");
    expect(await approvalsOf(commercial, id), "no second approval").toHaveLength(1);
    await page.reload();
    await detail.expectAction("New revision");
    expect(await detail.statusText()).toBe("Approval pending");
  });

  tc("TC-CST-010", async ({ page }) => {
    const { commercial, id } = await submitted(costsForMargin(25));
    ok(await (await apiAs("salesHead")).action("costing", id, "Approve"), "approve");
    expect((await sheetOf(commercial, id)).status).toBe("Approved");
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Approved");
    await detail.action("New revision");
    await expect.poll(() => detail.statusText()).toBe("Draft");
    const revised = await sheetOf(commercial, id);
    expect(revised).toMatchObject({ status: "Draft", revision: 1 });
    expect((revised.sla as Sla)?.l, "SLA-10 restarted").not.toBe("Met");
    // editing is enabled again: the cost can be changed and the sheet resubmitted
    await detail.expectAction("Submit");
    ok(await commercial.patch(`/modules/costing/${id}`, { material: 500_000 }), "edit the draft");
    expect((await sheetOf(commercial, id)).material).toBe(500_000);
    // on a sheet that is already Draft
    await expectActionRejected(commercial, "costing", id, "New revision", {}, `Costing sheet '${id}' is already in Draft.`);
    expect(await sheetOf(commercial, id)).toMatchObject({ status: "Draft", revision: 1 });
    // from Rejected the revision counts again
    ok(await commercial.action("costing", id, "Submit"), "resubmit");
    ok(await (await apiAs("salesHead")).action("costing", id, "Reject", { rej: "Revisit freight" }), "reject");
    ok(await commercial.action("costing", id, "New revision"), "revise a rejected sheet");
    expect(await sheetOf(commercial, id)).toMatchObject({ status: "Draft", revision: 2 });
  });

  tc("TC-CST-012", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id);
    const product = await build.product(commercial, { cost: 654_321, minPrice: 910_000 });
    // costing with distinctive figures for the same opportunity: total 1,234,567 (material 1,234,567), selling price 1,500,000 -> gross margin 265,433
    const sheet = rec(await build.costing(commercial, { opportunityId: opp.id, accountId: account.id, material: 1_234_567, sellingPrice: 1_500_000 }), "create costing sheet");
    ok(await commercial.action("costing", sheet.id as string, "Submit"), "submit costing");
    const quote = rec(await commercial.post("/modules/quotes", { opportunityId: opp.id, accountId: account.id, quotationDate: isoDate(0), validUntil: isoDate(30), paymentTerms: "100% advance" }), "create quotation");
    const quoteId = quote.id as string;
    ok(await commercial.patch(`/modules/quotes/${quoteId}`, { lines: [{ productId: product.id, qty: 1, unitPrice: 1_500_000, discountPct: 0 }] }), "add quotation line");
    // Download through the UI button as Commercial, and through the API: same document
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", quoteId);
    const [download] = await Promise.all([page.waitForEvent("download"), detail.action("Download PDF")]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const path = await download.path();
    const uiPdf = readFileSync(path);
    expect(uiPdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const res = await fetch(`http://localhost:3001/api/v1/modules/quotes/${quoteId}/pdf`, { headers: { authorization: `Bearer ${commercial.token}` } });
    expect(res.status).toBe(200);
    const apiPdf = Buffer.from(await res.arrayBuffer());
    for (const pdf of [uiPdf, apiPdf]) {
      const text = pdfText(pdf);
      // positive controls: the extractor really read the customer pricing
      expect(text).toContain(account.name);
      expect(text).toContain("Grand total");
      expect(text).toContain("15,00,000");
      // no cost, margin or costing reference: neither the numbers (total cost, margin, the product standard cost) nor the words
      for (const secret of ["12,34,567", "1234567", "2,65,433", "265433", "6,54,321", "654321", "9,10,000", "910000"]) expect(text, `PDF text contains ${secret}`).not.toContain(secret);
      expect(text).not.toMatch(/cost|margin|gross|costing/i);
    }
  });

  tc("TC-CST-013", async () => {
    const commercial = await apiAs("commercial");
    const sales = await apiAs("salesExec1");
    const orgB = await apiAs("orgBAdmin");
    // an opportunity (and account) that exists, but in Org B
    const foreignAccount = await build.account(orgB);
    const foreignOpp = await build.opportunity(orgB, foreignAccount.id);
    const own = await build.account(sales);
    const ownOpp = await build.opportunity(sales, own.id);
    const rejected = await commercial.post("/modules/costing", { opportunityId: foreignOpp.id, ...COSTS, sellingPrice: 1_000_000 });
    expect(rejected.status).toBe(400);
    expect(ApiClient.message(rejected)).toBe(`Opportunity '${foreignOpp.id}' not found in your organization.`);
    // a foreign account id on an own opportunity is refused too
    const foreignAccountRejected = await commercial.post("/modules/costing", { opportunityId: ownOpp.id, accountId: foreignAccount.id, sellingPrice: 1_000_000 });
    expect(foreignAccountRejected.status).toBe(400);
    expect(ApiClient.message(foreignAccountRejected)).toBe(`Account '${foreignAccount.id}' not found in your organization.`);
    // nothing was created for the foreign opportunity (director sees the whole org); control: the own opportunity links fine
    const director = await apiAs("director");
    expect(ok(await director.get(`/modules/costing?limit=100&search=${foreignOpp.id}`), "list by foreign opportunity").body.total).toBe(0);
    const control = await build.costing(commercial, { opportunityId: ownOpp.id, accountId: own.id, sellingPrice: 1_000_000 });
    expect(control.status).toBe(201);
    expect(ok(await director.get(`/modules/costing?limit=100&search=${ownOpp.id}`), "list by own opportunity").body.total).toBe(1);
  });
});

test.describe("Costing - Sales Head", () => {
  test.use({ storageState: authFile("salesHead") });

  tc("TC-CST-009", async ({ page }) => {
    const salesHead = await apiAs("salesHead");
    const { id } = await submitted(costsForMargin(25));
    const detail = new ModuleDetail(page);
    // Approve
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Approval pending");
    await detail.action("Approve");
    await expect.poll(() => detail.statusText()).toBe("Approved");
    const approved = await sheetOf(salesHead, id);
    expect(approved.status).toBe("Approved");
    expect(approved.approvedById).toBe(await userIdOf("salesHead"));
    // Spec-adjacent (D-57): the sheet's Margin approval should be closed together with the sheet; it stays 'Requested'.
    await knownDefect(test.info(), "D-57", async () => {
      expect((await approvalsOf(salesHead, id)).map((a) => a.status), "approval status after the sheet was approved").toEqual(["Approved"]);
    });
    // Reject needs a reason: the dialog blocks a blank one, the server rejects a missing one
    const second = await submitted(costsForMargin(25));
    await detail.goto("costing", second.id);
    await detail.action("Reject");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expectActionRejected(salesHead, "costing", second.id, "Reject", {}, "'rej' is required to Reject.");
    expect((await sheetOf(salesHead, second.id)).status).toBe("Approval pending");
    await detail.action("Reject");
    await detail.answerPrompt("Freight looks too low");
    await expect.poll(() => detail.statusText()).toBe("Rejected");
    const rejected = await sheetOf(salesHead, second.id);
    expect(rejected.status).toBe("Rejected");
    // D-58: the reason is required but never stored; D-57 again for the approval record
    await knownDefect(test.info(), "D-58", async () => {
      expect(JSON.stringify(rejected), "the reject reason is stored on the sheet").toContain("Freight looks too low");
    });
    await knownDefect(test.info(), "D-57", async () => {
      expect((await approvalsOf(salesHead, second.id)).map((a) => a.status), "approval status after the sheet was rejected").toEqual(["Rejected"]);
    });
    // a Rejected sheet offers Submit again, and it works
    await detail.expectAction("Submit");
    await detail.expectNoAction("Approve");
    // Spec: the Rejected sheet can be submitted again. The UI offers Submit, but the service only accepts Draft sheets (D-52).
    const again = await second.commercial.action("costing", second.id, "Submit");
    if (again.status !== 201) {
      expect([again.status, ApiClient.message(again)]).toEqual([400, "Cannot submit a costing sheet in status 'Rejected'."]);
    }
    await knownDefect(test.info(), "D-52", async () => {
      expect(again.status, "resubmitting a Rejected sheet").toBe(201);
    });
    // what works: New revision returns the sheet to Draft, then Submit
    ok(await second.commercial.action("costing", second.id, "New revision"), "revise the rejected sheet");
    expect(rec(await second.commercial.action("costing", second.id, "Submit"), "submit the revision").status).toBe("Approval pending");
    // an Approved sheet cannot be approved or rejected again
    await expectActionRejected(salesHead, "costing", id, "Approve", {}, "Cannot Approve a costing sheet in status 'Approved'.");
    await expectActionRejected(salesHead, "costing", id, "Reject", { rej: "late" }, "Cannot Reject a costing sheet in status 'Approved'.");
  });
});

test.describe("Costing - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-CST-007", async ({ page }) => {
    const superAdmin = await apiAs("superAdmin");
    const { commercial, id } = await newSheet();
    const orgId = (await sheetOf(commercial, id)).orgId as string;
    // The approvalRules module is 403 for every role of the E2E org (D-50), so the rules cannot be deactivated through the API: they are switched
    // off directly in the isolated E2E database for the single Submit (a backup file makes the restore crash-safe, see db.ts).
    // The Submit is sent as Commercial, the role that prepares and submits sheets in every other case; Super Admin only proves the 403 and views the result.
    expect((await superAdmin.get("/modules/approvalRules")).status, "rules are not reachable through the API").toBe(403);
    const result = await withMarginRulesDisabled(orgId, async () => rec(await commercial.action("costing", id, "Submit"), "submit without rules"));
    expect(result).toMatchObject({ status: "Approved", gmPct: 30 });
    expect(await approvalsOf(commercial, id), "no approval record").toHaveLength(0);
    // rules are back: the next sheet is routed again
    const control = await submitted();
    expect(control.result.status).toBe("Approval pending");
    const detail = new ModuleDetail(page);
    await detail.goto("costing", id);
    expect(await detail.statusText()).toBe("Approved");
    await detail.expectNoAction("Submit");
    await detail.expectNoAction("Approve");
  });
});

test.describe("Costing - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-CST-011", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const { account, opp, id } = await submitted(); // costing: total 700000, gross margin 300000
    const product = await build.product(commercial, { cost: 654_321, minPrice: 910_011 });
    // the quotation is the sales executive's own (quotations are own-record scoped), on the costed opportunity, with one line
    const quote = rec(await sales.post("/modules/quotes", { opportunityId: opp.id, accountId: account.id, quotationDate: isoDate(0), validUntil: isoDate(30), paymentTerms: "100% advance" }), "create quotation");
    const quoteId = quote.id as string;
    ok(await sales.patch(`/modules/quotes/${quoteId}`, { lines: [{ productId: product.id, qty: 1, unitPrice: 1_500_000, discountPct: 0 }] }), "add quotation line");
    // the sales executive owns the opportunity but has no costing access: API 403 (list, by id, breakdown, export)
    for (const path of ["/modules/costing", `/modules/costing/${id}`, `/modules/costing/${id}/table/breakdown`, "/modules/costing/export"]) {
      const r = await sales.get(path);
      expect(r.status, path).toBe(403);
      expect(ApiClient.message(r), path).toBe("Your role does not have 'read' access to 'costing'.");
    }
    // Spec text is 'Costing is restricted.'; a role without read access is refused earlier by the permission guard with this message (D-62).
    test.info().annotations.push({ type: "known-defect", description: "D-62: 403 message is \"Your role does not have 'read' access to 'costing'.\", the case expects \"Costing is restricted.\"" });
    // UI: wait for the SETTLED state of the page (the 'restricted' banner is transient, D-5), then check no cost data is shown
    await page.goto("/costing");
    await expect(page.getByText(/don't have access to this page/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row")).toHaveCount(0);
    await expect(page.getByText("₹7.0 L")).toHaveCount(0);
    // Spec: the page says 'Costing is restricted.'; the settled page shows the failed-load text instead (D-5)
    await knownDefect(test.info(), "D-5", async () => {
      await expect(page.getByText("Costing is restricted.")).toBeVisible({ timeout: 1_000 });
    });
    // the restricted detail URL shows no cost either
    await page.goto(`/costing/${id}`);
    await expect(page.getByText(/don't have access/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Total cost|Gross margin|Cost breakdown|₹7.0 L/)).toHaveCount(0);
    // the quotation and opportunity the sales executive does see expose no cost / margin keys
    const quoteRead = rec(await sales.get(`/modules/quotes/${quoteId}`), "read quotation as sales executive");
    expect(quoteRead.id).toBe(quoteId);
    expect(Object.keys(quoteRead).filter((k) => /cost|margin|^gm|total/i.test(k)), "cost/margin keys on the quotation").toEqual([]);
    const oppRead = rec(await sales.get(`/modules/opps/${opp.id}`), "read opportunity as sales executive");
    expect(oppRead.id).toBe(opp.id);
    expect(Object.keys(oppRead).filter((k) => /cost|margin|^gm/i.test(k)), "cost/margin keys on the opportunity").toEqual([]);
    // exports: quotations (no cost/margin column) and products (cost / minimum price cells empty)
    const quotesCsv = await fetch("http://localhost:3001/api/v1/modules/quotes/export", { headers: { authorization: `Bearer ${sales.token}` } });
    expect(quotesCsv.status).toBe(200);
    const quotesText = await quotesCsv.text();
    expect(quotesText, "quotation export loaded with the quotation").toContain(quoteId);
    expect(quotesText.split("\n")[0] ?? "").not.toMatch(/cost|margin|gm/i);
    const productsCsv = await fetch("http://localhost:3001/api/v1/modules/products/export", { headers: { authorization: `Bearer ${sales.token}` } });
    expect(productsCsv.status).toBe(200);
    const productsText = await productsCsv.text();
    expect(productsText, "product export loaded with the product").toContain(product.sku);
    expect(productsText).not.toContain("654321");
    expect(productsText).not.toContain("910011");
    // the quotation PDF as the sales executive: customer pricing only (same checks as TC-CST-012)
    const res = await fetch(`http://localhost:3001/api/v1/modules/quotes/${quoteId}/pdf`, { headers: { authorization: `Bearer ${sales.token}` } });
    expect(res.status).toBe(200);
    const text = pdfText(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain(account.name);
    expect(text).toContain("Grand total");
    expect(text).toContain("15,00,000");
    for (const secret of ["7,00,000", "700000", "3,00,000", "300000", "6,54,321", "654321", "9,10,011", "910011"]) expect(text, `PDF text contains ${secret}`).not.toContain(secret);
    expect(text).not.toMatch(/cost|margin|gross|costing/i);
    // UI: the quotation page shows no cost either
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", quoteId);
    await detail.expectAction("Download PDF");
    await expect(page.getByText(/Total cost|Gross margin|Margin %|Cost breakdown/)).toHaveCount(0);
  });
});
