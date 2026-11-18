// e2e/specs/mfg/quo.spec.ts - Quotations & versioning (TC-QUO-001..020): lines, approval routing, min-price warning, status guards, revisions, PDF, SLA.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, TERMS, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { slaTimersOf } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { pdfText } from "../../mfg/pdf";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
type Sla = { l: string; t: string } | null;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const quoteOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/quotes/${id}`), "read quotation");
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DETAIL_RE = /\/quotations\/[0-9a-f-]{36}$/;
const inr = (n: number): string => n.toLocaleString("en-IN");
/** qty x unit price x (1 - discount%), the amount rule of spec section 13. */
const lineAmount = (l: { qty: number; unitPrice: number; discountPct: number }): number => l.qty * l.unitPrice * (1 - l.discountPct / 100);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Polls `read` until `done` accepts the value or the time is up; returns the last value (no assertion). */
const eventually = async <T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs: number): Promise<T> => {
  const end = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await sleep(1_000);
    value = await read();
  }
  return value;
};

/** Account + opportunity (owned by salesExec1) + a product created by Commercial. */
const base = async (productOver: Rec = {}) => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const product = await build.product(await apiAs("commercial"), productOver);
  return { sales, account, opp, product };
};
type Ctx = Awaited<ReturnType<typeof base>>;
const qOpts = (c: Ctx, over: { discountPct?: number; validDays?: number; paymentTerms?: string } = {}) => ({
  opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id, ...over,
});
/** Discount approvals of a quotation (the list ignores ?entityId, so it is filtered client-side; director sees the whole org). */
const approvalsOf = async (quoteId: string): Promise<Rec[]> => {
  const list = ok(await (await apiAs("director")).get("/modules/approvals?limit=100"), "list approvals").body.data ?? [];
  return list.filter((a) => a.entityId === quoteId);
};
/** Fresh quotation with one line at `discountPct`, submitted by Sales Executive; returns the single created approval. */
const submitAt = async (discountPct: number) => {
  const c = await base();
  const q = await build.submittedQuotation(c.sales, qOpts(c, { discountPct }));
  const approvals = await approvalsOf(q.id);
  return { c, q, approvals };
};
const expectDiscountApproval = (approvals: Rec[], approver: string, pct: number): void => {
  expect(approvals, "exactly one approval is created per submit").toHaveLength(1);
  expect(approvals[0]).toMatchObject({ type: "Discount", status: "Requested", currentApprover: approver, entityType: "Quotation" });
  expect(String(approvals[0]?.reason)).toMatch(new RegExp(`^Discount ${pct}% matched rule `));
};
const pdfOf = async (api: ApiClient, id: string): Promise<{ status: number; buffer: Buffer; disposition: string }> => {
  const res = await fetch(`http://localhost:3001/api/v1/modules/quotes/${id}/pdf`, { headers: { authorization: `Bearer ${api.token}` } });
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), disposition: res.headers.get("content-disposition") ?? "" };
};
/** Amount after "Grand total:" in the PDF text. The rupee sign is not rendered by the PDF font (it comes out as a stray glyph), so only the digits are read. */
const grandTotalOf = (text: string): string | undefined => /Grand total:[^\d]*([\d,]+)/.exec(text)?.[1];
/** PDF text with the word-wrap line breaks and pdfkit's space glyphs collapsed to single spaces. */
const flat = (text: string): string => text.replace(/[\s ·]+/g, " ");
/** Clicks "Submit for approval"; a click that is lost right after a cold page load (no request reached the server) is repeated once. */
const submitInUi = async (detail: ModuleDetail, api: ApiClient, id: string): Promise<void> => {
  await detail.action("Submit for approval");
  const status = await eventually(async () => (await quoteOf(api, id)).status, (st) => st !== "Draft", 8_000);
  if (status === "Draft") await detail.action("Submit for approval");
};
const LINES_EDIT_MSG = (status: string): string => `Quotation lines can only be edited while the quotation is in Draft (current status: '${status}').`;
test.describe("QUO - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-QUO-001", async ({ page }) => {
    test.slow(); // cold stack
    const c = await base({ leadTime: "6 weeks", warrantyMonths: 12 });
    const list = new ModuleList(page, "quotes");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // Opportunity / Account are raw-UUID text boxes (D-31 pattern)
    await drawer.fill({
      opportunityId: c.opp.id, accountId: c.account.id, quotationDate: dateInput(0), validUntil: dateInput(30), paymentTerms: TERMS, deliveryTerms: "Ex-works",
    });
    await drawer.save();
    await expect(drawer.error.or(page.getByRole("button", { name: "More actions", exact: true }))).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(DETAIL_RE);
    const id = idFromUrl(page);
    const draft = await quoteOf(c.sales, id);
    expect(draft).toMatchObject({ status: "Draft", version: 1, opportunityId: c.opp.id, accountId: c.account.id, paymentTerms: TERMS, deliveryTerms: "Ex-works" });
    const detail = new ModuleDetail(page);
    expect(await detail.statusText()).toBe("Draft");

    // Line items tab: a row is typed in by hand (Product ID is a raw text box: D-53)
    await detail.tab("Line items");
    const panel = page.getByRole("tabpanel");
    await panel.getByRole("button", { name: "+ Add row" }).click();
    const row = panel.getByRole("row").nth(1);
    await row.getByRole("textbox").first().fill(c.product.id);
    await row.getByRole("spinbutton").nth(0).fill("2");
    await row.getByRole("spinbutton").nth(1).fill("1000000");
    await row.getByRole("spinbutton").nth(2).fill("10");
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/modules/quotes/${id}`)),
      panel.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    // Spec: lines can be added in the UI. The tab posts every cell as a string (numbers typed in <input> are strings), so the API
    // answers 400 "Validation failed." (D-6 pattern) and the tab shows an error.
    const savedBody = (await saved.json()) as { message?: string | { message?: string } };
    const savedMessage = typeof savedBody.message === "string" ? savedBody.message : savedBody.message?.message;
    test.info().annotations.push({ type: "observed", description: `Line items Save: HTTP ${saved.status()} ${String(savedMessage)}` });
    if (saved.status() !== 200) {
      // D-6 present: remove these pins when the knownDefect below throws "appears fixed"
      expect(saved.status()).toBe(400);
      expect(savedMessage).toBe("Validation failed.");
      await expect(panel.locator("p.text-destructive")).toBeVisible();
    }
    expect(saved.status(), "Line items Save response").toBe(200);
    // lines are created through the API instead
    const lines = [
      { productId: c.product.id, qty: 2, unitPrice: 1_000_000, discountPct: 10 },
      { productId: c.product.id, qty: 1, unitPrice: 500_000, discountPct: 0 },
    ];
    ok(await c.sales.patch(`/modules/quotes/${id}`, { lines }), "add lines");
    // Line amounts = qty x price x (1 - disc%): the API never stores or returns them, the PDF line table is the only place they are shown
    const total = lines.reduce((s, l) => s + lineAmount(l), 0);
    expect(total).toBe(2_300_000);
    const { status, buffer } = await pdfOf(c.sales, id);
    expect(status).toBe(200);
    const text = pdfText(buffer);
    expect(text).toContain(inr(1_800_000)); // 2 x 10,00,000 less 10%
    expect(text).toContain(inr(500_000));
    expect(grandTotalOf(text)).toBe(inr(total));
    expect(await quoteOf(c.sales, id)).toMatchObject({ status: "Draft", version: 1 });
    // Spec: tax / warranty / lead time defaults are pre-filled from the product master. Nothing is copied: the quotation has no
    // warranty or delivery time until typed in.
    const q = await quoteOf(c.sales, id);
    await knownDefect(test.info(), "GAP-QUO-001", async () => {
      expect([q.warranty, q.deliveryTime], "warranty and delivery time defaulted from the product (12 months / 6 weeks)").not.toEqual([null, null]);
    });
  });

  tc("TC-QUO-002", async ({ page }) => {
    const c = await base();
    const q = await build.sentQuotation(c.sales, qOpts(c));
    const approved = await build.approvedQuotation(c.sales, qOpts(c));
    const line = { lines: [{ productId: c.product.id, qty: 3, unitPrice: 900_000, discountPct: 5 }] };
    for (const [id, status] of [[q.id, "Sent"], [approved.id, "Approved"]] as const) {
      const r = await c.sales.patch(`/modules/quotes/${id}`, line);
      expect(r.status, `lines on a ${status} quotation`).toBe(400);
      expect(ApiClient.message(r)).toBe(LINES_EDIT_MSG(status));
      expect(await quoteOf(c.sales, id)).toMatchObject({ status });
    }
    // removing every line is a lines edit too
    const removed = await c.sales.patch(`/modules/quotes/${q.id}`, { lines: [] });
    expect(removed.status).toBe(400);
    expect(ApiClient.message(removed)).toBe(LINES_EDIT_MSG("Sent"));
    // the lines are unchanged: the PDF still shows the original line (qty 1 x 10,00,000)
    expect(grandTotalOf(pdfText((await pdfOf(c.sales, q.id)).buffer))).toBe(inr(1_000_000));
    // the UI Line items tab of the Sent quotation: the Save button is available but saving is refused by the server
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Sent");
    await detail.tab("Line items");
    const panel = page.getByRole("tabpanel");
    await panel.getByRole("button", { name: "+ Add row" }).click();
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.locator("p.text-destructive")).toBeVisible({ timeout: 10_000 });
    expect(await quoteOf(c.sales, q.id)).toMatchObject({ status: "Sent" });
  });

  tc("TC-QUO-003", async ({ page }) => {
    const { c, q, approvals } = await submitAt(3);
    // Spec: 0-5% has approver 'Salesperson'; verified: with the default rules even 0-3% creates a Discount approval, so the
    // quotation goes to 'Approval pending' (it only auto-approves when no rule exists).
    expect(q.status).toBe("Approval pending");
    expectDiscountApproval(approvals, "Salesperson", 3);
    expect(await quoteOf(c.sales, q.id)).toMatchObject({ status: "Approval pending" });
    // SLA-11 'Quotation issue' starts when the quotation is Approved: not yet
    expect((await slaTimersOf(q.id)).map((t) => t.name)).not.toContain("Quotation issue");
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Approval pending");
    // the quotation's own Approve action (API; there is no Approve button in the UI, see TC-QUO-009) starts SLA-11
    ok(await (await apiAs("salesManager")).action("quotes", q.id, "Approve"), "approve");
    expect(await quoteOf(c.sales, q.id)).toMatchObject({ status: "Approved" });
    expect((await slaTimersOf(q.id)).filter((t) => t.name === "Quotation issue")).toEqual([{ name: "Quotation issue", open: true }]);
  });

  tc("TC-QUO-004", async ({ page }) => {
    // UI: the Sales Executive submits an 8% quotation with the button
    const c = await base();
    const q = await build.quotation(c.sales, qOpts(c, { discountPct: 8 }));
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Draft");
    await submitInUi(detail, c.sales, q.id);
    await expect.poll(() => detail.statusText(), { timeout: 15_000 }).toBe("Approval pending");
    expect(await quoteOf(c.sales, q.id)).toMatchObject({ status: "Approval pending" });
    expectDiscountApproval(await approvalsOf(q.id), "Sales Manager", 8);
    // the Approvals tab of the quotation lists it
    await detail.tab("Approvals");
    await expect(page.getByRole("tabpanel").getByRole("row").filter({ hasText: "Sales Manager" }).first()).toBeVisible();
  });

  tc("TC-QUO-005", async () => {
    const twelve = await submitAt(12);
    expect(twelve.q.status).toBe("Approval pending");
    expectDiscountApproval(twelve.approvals, "Sales Head", 12);
    const twenty = await submitAt(20);
    expect(twenty.q.status).toBe("Approval pending");
    expectDiscountApproval(twenty.approvals, "Director", 20);
  });

  tc("TC-QUO-006", async () => {
    const c = await base();
    const q = await build.quotation(c.sales, qOpts(c));
    const lines = [2, 4, 11].map((discountPct) => ({ productId: c.product.id, qty: 1, unitPrice: 1_000_000, discountPct }));
    ok(await c.sales.patch(`/modules/quotes/${q.id}`, { lines }), "add three lines");
    const r = ok(await c.sales.action("quotes", q.id, "Submit for approval"), "submit");
    expect(r.body.status).toBe("Approval pending");
    // the highest line discount (11%) picks the rule: Sales Head, not the 2% / 4% bands
    expectDiscountApproval(await approvalsOf(q.id), "Sales Head", 11);
  });

  tc("TC-QUO-007", async ({ page }) => {
    const c = await base({ price: 1_000_000, minPrice: 900_000 });
    const q = await build.quotation(c.sales, qOpts(c, { discountPct: 12 }));
    // net 1,000,000 x 0.88 = 880,000 < minimum 900,000
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    await submitInUi(detail, c.sales, q.id);
    await expect.poll(() => detail.statusText(), { timeout: 15_000 }).toBe("Approval pending");
    // Spec: the UI shows the warning. The UI toasts only "Submit for approval done." and drops the response's `warnings`.
    await expect(page.getByText("Submit for approval done.")).toBeVisible(); // positive control: the toast rendered, with no warning text
    await knownDefect(test.info(), "D-64", async () => {
      await expect(page.getByText(/priced below minimum/)).toBeVisible({ timeout: 2_000 });
    });
    // the same warning comes back from the API on a second quotation
    const second = await build.quotation(c.sales, qOpts(c, { discountPct: 12 }));
    const r = ok(await c.sales.action("quotes", second.id, "Submit for approval"), "submit");
    expect(r.body.warnings).toEqual([`Line for ${c.product.sku} is priced below minimum (₹880000.00 < ₹900000).`]);
    // a line at or above the minimum carries no warning (control)
    const fine = await build.submittedQuotation(c.sales, qOpts(c, { discountPct: 5 }));
    expect(fine.warnings).toEqual([]);
  });

  tc("TC-QUO-008", async ({ page }) => {
    const c = await base();
    const q = await build.submittedQuotation(c.sales, qOpts(c, { discountPct: 8 }));
    expect(q.status).toBe("Approval pending");
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Approval pending");
    await detail.expectNoAction("Mark sent");
    await expectActionRejected(c.sales, "quotes", q.id, "Mark sent", {}, "Cannot Mark sent a quotation in status 'Approval pending'.");
    expect(await quoteOf(c.sales, q.id)).toMatchObject({ status: "Approval pending" });
    expect(await detail.statusText()).toBe("Approval pending");
  });

  tc("TC-QUO-011", async ({ page }) => {
    const c = await base();
    const terms = { deliveryTerms: "CIF", deliveryTime: "8 weeks", warranty: "18 months", exclusions: "Civil works", termsAndConditions: "E2E terms and conditions" };
    const q = await build.quotation(c.sales, qOpts(c));
    ok(await c.sales.patch(`/modules/quotes/${q.id}`, {
      ...terms, lines: [{ productId: c.product.id, qty: 2, unitPrice: 1_000_000, discountPct: 10 }, { productId: c.product.id, qty: 1, unitPrice: 250_000, discountPct: 0 }],
    }), "set terms and lines");
    ok(await c.sales.action("quotes", q.id, "Submit for approval"), "submit");
    ok(await (await apiAs("salesHead")).action("quotes", q.id, "Approve"), "approve");
    ok(await c.sales.action("quotes", q.id, "Mark sent"), "mark sent");
    const v1Total = lineAmount({ qty: 2, unitPrice: 1_000_000, discountPct: 10 }) + 250_000;

    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Sent");
    await detail.action("Revise → new version");
    await expect(page).toHaveURL(DETAIL_RE);
    await expect.poll(() => idFromUrl(page)).not.toBe(q.id);
    const v2Id = idFromUrl(page);
    await detail.expectAction("Submit for approval"); // V2 loaded in Draft
    expect(await detail.statusText()).toBe("Draft");

    const [v1, v2] = [await quoteOf(c.sales, q.id), await quoteOf(c.sales, v2Id)];
    expect(v2).toMatchObject({ version: 2, parentId: q.id, status: "Draft", opportunityId: c.opp.id, accountId: c.account.id, paymentTerms: TERMS, ...terms });
    expect(v1).toMatchObject({ version: 1, status: "Revised" });
    // lines copied (read from the PDF: the API record has no lines)
    for (const id of [q.id, v2Id]) {
      const text = pdfText((await pdfOf(c.sales, id)).buffer);
      expect(grandTotalOf(text)).toBe(inr(v1Total));
      expect(text).toContain(inr(1_800_000));
    }
    expect(pdfText((await pdfOf(c.sales, v2Id)).buffer)).toContain("v2");
    // V1 is read-only: lines refused, and its action buttons are gone
    const refused = await c.sales.patch(`/modules/quotes/${q.id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1, discountPct: 0 }] });
    expect(refused.status).toBe(400);
    expect(ApiClient.message(refused)).toBe(LINES_EDIT_MSG("Revised"));
    // V2 lines remain editable (Draft)
    ok(await c.sales.patch(`/modules/quotes/${v2Id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1_000_000, discountPct: 0 }] }), "edit V2 lines");
    // Versions tab of V2 loads with its own entry
    await detail.tab("Versions");
    await expect(page.getByRole("tabpanel").getByText("V2 created")).toBeVisible();
    // Spec: the Versions tab shows the chain (V1 and V2). It lists only the opened version's own creation.
    await knownDefect(test.info(), "D-65", async () => {
      await expect(page.getByRole("tabpanel").getByText("V1 created")).toBeVisible({ timeout: 1_000 });
    });
    // V1 detail: Revised, no workflow buttons
    await detail.goto("quotes", q.id);
    await expect.poll(() => detail.isOutOfFlow(), { timeout: 15_000 }).toBe(true); // Revised is outside the quotation flow
    for (const label of ["Submit for approval", "Mark sent", "Mark accepted", "Mark rejected", "Revise → new version"]) await detail.expectNoAction(label);
  });

  tc("TC-QUO-012", async ({ page }) => {
    const c = await base();
    const draft = await build.quotation(c.sales, qOpts(c, { discountPct: 3 }));
    const accepted = await build.sentQuotation(c.sales, qOpts(c));
    ok(await c.sales.action("quotes", accepted.id, "Mark accepted"), "accept");
    const detail = new ModuleDetail(page);
    for (const [id, status] of [[draft.id, "Draft"], [accepted.id, "Accepted"]] as const) {
      await expectActionRejected(c.sales, "quotes", id, "Revise → new version", {}, `Cannot revise a quotation in status '${status}'.`);
      expect(await quoteOf(c.sales, id)).toMatchObject({ status });
      await detail.goto("quotes", id);
      expect(await detail.statusText()).toBe(status);
      await detail.expectNoAction("Revise → new version");
    }
    // allowed statuses: Approval pending / Approved / Sent each revise (control: only the status check differs)
    for (const build_ of [build.approvedQuotation, build.sentQuotation]) {
      const src = await build_(c.sales, qOpts(c));
      const v2 = ok(await c.sales.action("quotes", src.id, "Revise → new version"), "revise");
      expect(v2.body).toMatchObject({ version: 2, parentId: src.id, status: "Draft" });
    }
    const pending = await build.submittedQuotation(c.sales, qOpts(c, { discountPct: 8 }));
    const r = ok(await c.sales.action("quotes", pending.id, "Revise → new version"), "revise Approval pending");
    expect(r.body).toMatchObject({ version: 2, parentId: pending.id, status: "Draft" });
  });

  tc("TC-QUO-013", async ({ page }) => {
    const c = await base();
    const accept = await build.sentQuotation(c.sales, qOpts(c));
    const reject = await build.sentQuotation(c.sales, qOpts(c));
    const draft = await build.quotation(c.sales, qOpts(c));
    const detail = new ModuleDetail(page);
    // Mark accepted in the UI
    await detail.goto("quotes", accept.id);
    expect(await detail.statusText()).toBe("Sent");
    await detail.action("Mark accepted");
    await expect.poll(() => detail.statusText(), { timeout: 15_000 }).toBe("Accepted");
    expect(await quoteOf(c.sales, accept.id)).toMatchObject({ status: "Accepted" });
    await detail.expectNoAction("Mark accepted");
    await detail.expectNoAction("Mark rejected");
    // SLA-12 follow-up stopped
    const timers = await slaTimersOf(accept.id);
    expect(timers.filter((t) => t.name === "Quotation follow-up")).toEqual([{ name: "Quotation follow-up", open: false }]);
    expect(timers.filter((t) => t.name === "Quotation expiry reminder" && t.open), "no open SLA-13 timer remains").toEqual([]);

    // Mark rejected needs a reason
    await expectActionRejected(c.sales, "quotes", reject.id, "Mark rejected", {}, "'rej' is required to Mark rejected.");
    expect(await quoteOf(c.sales, reject.id)).toMatchObject({ status: "Sent" });
    await detail.goto("quotes", reject.id);
    await detail.action("Mark rejected");
    await detail.answerPrompt("Price");
    await expect.poll(() => detail.isOutOfFlow(), { timeout: 15_000 }).toBe(true); // Rejected is outside the quotation flow: no active step
    expect(await quoteOf(c.sales, reject.id)).toMatchObject({ status: "Rejected" });
    expect((await slaTimersOf(reject.id)).filter((t) => t.name === "Quotation follow-up")).toEqual([{ name: "Quotation follow-up", open: false }]);

    // both only from Sent: a Draft quotation refuses both (and the UI offers neither)
    await expectActionRejected(c.sales, "quotes", draft.id, "Mark accepted", {}, "Cannot Mark accepted a quotation in status 'Draft'.");
    await expectActionRejected(c.sales, "quotes", draft.id, "Mark rejected", { rej: "Price" }, "Cannot Mark rejected a quotation in status 'Draft'.");
    await detail.goto("quotes", draft.id);
    expect(await detail.statusText()).toBe("Draft");
    await detail.expectNoAction("Mark accepted");
    await detail.expectNoAction("Mark rejected");
    // an already Accepted quotation cannot be flipped to rejected
    await expectActionRejected(c.sales, "quotes", accept.id, "Mark rejected", { rej: "Price" }, "Cannot Mark rejected a quotation in status 'Accepted'.");
  });

  tc("TC-QUO-014", async ({ page }) => {
    const c = await base();
    const q = await build.quotation(c.sales, qOpts(c));
    ok(await c.sales.patch(`/modules/quotes/${q.id}`, {
      termsAndConditions: "E2E terms: delivery subject to site readiness", paymentTerms: "100% advance",
      lines: [{ productId: c.product.id, qty: 2, unitPrice: 1_000_000, discountPct: 10 }, { productId: c.product.id, qty: 1, unitPrice: 400_000, discountPct: 5 }],
    }), "set terms and lines");
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    const [download] = await Promise.all([page.waitForEvent("download"), detail.action("Download PDF")]);
    const uiPdf = readFileSync(await download.path());
    expect(uiPdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const api = await pdfOf(c.sales, q.id);
    expect(api.status).toBe(200);
    expect(api.disposition).toContain(`Quotation-${q.id}-v1.pdf`);
    expect(api.buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // Spec: filename Quotation-<id>-v<version>.pdf; the UI must save under the server's name
    // The UI saves the download as quotes-<id>.pdf: it ignores the server's Content-Disposition name (D-72).
    expect(download.suggestedFilename(), "UI download name (spec-correct name asserted below: remove this line when D-72 is fixed)").toBe(`quotes-${q.id}.pdf`);
    await knownDefect(test.info(), "D-72", async () => {
      expect(download.suggestedFilename()).toBe(`Quotation-${q.id}-v1.pdf`);
    });
    const total = lineAmount({ qty: 2, unitPrice: 1_000_000, discountPct: 10 }) + lineAmount({ qty: 1, unitPrice: 400_000, discountPct: 5 });
    // dates are written by the service with toLocaleDateString('en-IN') (same machine / timezone as the test run)
    const saved = await quoteOf(c.sales, q.id);
    const enIn = (v: unknown): string => new Date(String(v)).toLocaleDateString("en-IN");
    for (const pdf of [uiPdf, api.buffer]) {
      const text = pdfText(pdf);
      // the E2E account has city Pune / state Maharashtra and no street address: the block prints "<billing>, <city>, <state>" without empties
      expect(flat(text)).toContain("Billing address: Pune, Maharashtra");
      expect(flat(text)).toContain(`Quotation date: ${enIn(saved.quotationDate)}`);
      expect(flat(text)).toContain(`Valid until: ${enIn(saved.validUntil)}`);
      expect(text).toContain(q.id);
      expect(text).toContain("v1");
      expect(text).toContain(c.account.name);
      expect(text).toContain("Payment terms");
      expect(text).toContain("100% advance");
      expect(text).toContain(inr(1_800_000));
      expect(text).toContain(inr(380_000));
      expect(text).toContain("10%");
      expect(grandTotalOf(text)).toBe(inr(total));
      expect(flat(text)).toContain("Terms & conditions");
      // the rupee sign in the grand total line is not rendered by the PDF font (D-73)
      await knownDefect(test.info(), "D-73", async () => {
        expect(flat(text)).toContain("Grand total: ₹");
      });
      expect(flat(text)).toContain("E2E terms: delivery subject to site readiness");
      expect(text).toContain(c.opp.title);
    }
  });

  tc("TC-QUO-015", async ({ page }) => {
    const c = await base();
    const q = await build.quotation(c.sales, qOpts(c));
    const lines = [
      { productId: c.product.id, qty: 3, unitPrice: 1_000_000, discountPct: 10 },
      { productId: c.product.id, qty: 2, unitPrice: 350_000, discountPct: 7.5 },
      { productId: c.product.id, qty: 1, unitPrice: 125_000, discountPct: 0 },
    ];
    ok(await c.sales.patch(`/modules/quotes/${q.id}`, { lines }), "add three lines");
    const total = lines.reduce((s, l) => s + lineAmount(l), 0); // 2,700,000 + 647,500 + 125,000
    expect(total).toBe(3_472_500);
    const text = pdfText((await pdfOf(c.sales, q.id)).buffer);
    expect(grandTotalOf(text)).toBe(inr(total));
    for (const l of lines) expect(text).toContain(inr(lineAmount(l)));
    // Spec: the detail screen shows the same Grand total. The record carries no total (the API never computes it), so the
    // "Grand total" field and the list's Total column stay blank.
    const record = await quoteOf(c.sales, q.id);
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    await detail.tab("Details");
    await expect(page.getByRole("tabpanel").getByText("Grand total")).toBeVisible(); // tab loaded
    await knownDefect(test.info(), "D-66", async () => {
      expect(record.total, "quotation total on the record").toBe(total);
      await expect(page.getByRole("tabpanel").getByText("₹34.7 L"), "Grand total on the Details tab").toBeVisible({ timeout: 1_000 });
    });
  });

  tc("TC-QUO-018", async ({ page }) => {
    const c = await base();
    const opp = await build.opportunity(c.sales, c.account.id, { value: 1_000_000 });
    const q = await build.quotation(c.sales, { opportunityId: opp.id, accountId: c.account.id });
    ok(await c.sales.patch(`/modules/quotes/${q.id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1_150_000, discountPct: 0 }] }), "add line");
    ok(await c.sales.action("quotes", q.id, "Submit for approval"), "submit");
    expect(grandTotalOf(pdfText((await pdfOf(c.sales, q.id)).buffer))).toBe(inr(1_150_000));
    // the opportunity's estimated value is untouched by the quotation total
    const after = rec(await c.sales.get(`/modules/opps/${opp.id}`), "read opportunity");
    expect(after.value).toBe(1_000_000);
    const detail = new ModuleDetail(page);
    await detail.goto("opps", opp.id);
    await expect(page.getByText("₹10.0 L", { exact: true }).first()).toBeVisible(); // Estimated value (detail loaded)
    await expect(page.getByText("₹11.5 L")).toHaveCount(0);
  });

  tc("TC-QUO-019", async () => {
    const c = await base();
    const sent = await build.sentQuotation(c.sales, qOpts(c));
    const before = await quoteOf(c.sales, sent.id);
    // lines are locked once issued
    const lines = await c.sales.patch(`/modules/quotes/${sent.id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1, discountPct: 0 }] });
    expect(lines.status).toBe(400);
    expect(ApiClient.message(lines)).toBe(LINES_EDIT_MSG("Sent"));
    // Spec: the issued version is immutable (changes only via revision). Header fields (payment terms, validity, delivery terms,
    // T&C) are not locked: the PATCH is accepted and the issued version changes in place.
    const header = await c.sales.patch(`/modules/quotes/${sent.id}`, { paymentTerms: "100% advance", validUntil: isoDate(90), termsAndConditions: "Edited after issue" });
    const after = await quoteOf(c.sales, sent.id);
    if (header.status !== 400) {
      // D-67 present: the PATCH is accepted and the issued version changes in place (remove these pins when the knownDefect below throws "appears fixed")
      expect(header.status).toBe(200);
      expect(after.paymentTerms).toBe("100% advance");
      expect(after.termsAndConditions).toBe("Edited after issue");
    }
    await knownDefect(test.info(), "D-67", async () => {
      expect(header.status, "header PATCH on an issued quotation").toBe(400);
      expect(after.paymentTerms).toBe(before.paymentTerms);
      expect(after.validUntil).toBe(before.validUntil);
      expect(after.termsAndConditions).toBe(before.termsAndConditions);
    });
    // the supported path stays open: a revision is a new Draft that can be edited
    const v2 = rec(await c.sales.action("quotes", sent.id, "Revise → new version"), "revise");
    expect((await c.sales.patch(`/modules/quotes/${v2.id as string}`, { paymentTerms: "30 days credit" })).status).toBe(200);
  });

  tc("TC-QUO-020", async () => {
    const five = await submitAt(5);
    const ten = await submitAt(10);
    const fifteen = await submitAt(15);
    const approverOf = (r: { approvals: Rec[] }): unknown => r.approvals[0]?.currentApprover;
    // Rules match min <= value < max, so an upper-bound discount falls into the NEXT band. Verified live (2 Oct): 5% -> Sales Manager.
    // Spec section 14 wording ("up to 5% salesperson ...") would put the boundary values one band lower.
    expect([approverOf(five), approverOf(ten), approverOf(fifteen)], "D-68 present: current boundary routing (5%, 10%, 15%); remove this pin when the boundary is fixed (the knownDefect below then throws 'appears fixed')").toEqual(["Sales Manager", "Sales Head", "Director"]);
    // just below each boundary is in the lower band
    expect(approverOf(await submitAt(4.99))).toBe("Salesperson");
    // Spec-correct boundaries: 5% Salesperson, 10% Sales Manager, 15% Sales Head
    await knownDefect(test.info(), "D-68", async () => {
      expect([approverOf(five), approverOf(ten), approverOf(fifteen)]).toEqual(["Salesperson", "Sales Manager", "Sales Head"]);
    });
  });
});

test.describe("QUO - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-QUO-009", async ({ page }) => {
    const c = await base();
    const q = await build.submittedQuotation(c.sales, qOpts(c, { discountPct: 8 }));
    expect(q.status).toBe("Approval pending");
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Approval pending");
    // Spec: the manager clicks Approve on the quotation. The registry defines no Approve / Reject action for quotations, so the
    // quotation can only be approved through the API (approving the Approval record does not move it).
    await knownDefect(test.info(), "D-69", async () => {
      await detail.expectAction("Approve");
    });
    const manager = await apiAs("salesManager");
    ok(await manager.action("quotes", q.id, "Approve"), "approve");
    // SLA-11 started on approval
    expect((await slaTimersOf(q.id)).filter((t) => t.name === "Quotation issue")).toEqual([{ name: "Quotation issue", open: true }]);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Approved");
    await detail.action("Mark sent");
    await expect.poll(() => detail.statusText(), { timeout: 15_000 }).toBe("Sent");
    expect(await quoteOf(manager, q.id)).toMatchObject({ status: "Sent" });
    // SLA-11 stops and SLA-12 starts (a timer exists on the record)
    const timers = await slaTimersOf(q.id);
    expect(timers.filter((t) => t.name === "Quotation issue")).toEqual([{ name: "Quotation issue", open: false }]);
    expect(timers.filter((t) => t.name === "Quotation follow-up")).toEqual([{ name: "Quotation follow-up", open: true }]);
    expect(((await quoteOf(manager, q.id)).sla as Sla)?.l, "SLA-12 state of the Sent quotation").toMatch(/^Due in /);
    // Spec: a follow-up task is created when the quotation is Sent. No activity is created for the opportunity.
    const director = await apiAs("director");
    const acts = ok(await director.get(`/modules/activities?limit=100&opportunityId=${c.opp.id}`), "list activities").body.data ?? [];
    const followUps = acts.filter((a) => a.opportunityId === c.opp.id);
    test.info().annotations.push({ type: "observed", description: `activities linked to the opportunity after Mark sent: ${followUps.length}` });
    await knownDefect(test.info(), "D-70", async () => {
      expect(followUps.length, "follow-up activity for the sent quotation").toBeGreaterThanOrEqual(1);
    });
  });

  tc("TC-QUO-010", async ({ page }) => {
    const c = await base();
    const q = await build.submittedQuotation(c.sales, qOpts(c, { discountPct: 8 }));
    const manager = await apiAs("salesManager");
    // the reason is required
    await expectActionRejected(manager, "quotes", q.id, "Reject", {}, "'rej' is required to Reject.");
    expect(await quoteOf(manager, q.id)).toMatchObject({ status: "Approval pending" });
    // Spec: the manager rejects in the UI; no Reject button exists on a quotation (D-69)
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Approval pending");
    await knownDefect(test.info(), "D-69", async () => {
      await detail.expectAction("Reject");
    });
    ok(await manager.action("quotes", q.id, "Reject", { rej: "Discount too high" }), "reject");
    expect(await quoteOf(manager, q.id)).toMatchObject({ status: "Draft" });
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Draft");
    // lines are editable again
    const sales = c.sales;
    const edit = await sales.patch(`/modules/quotes/${q.id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1_000_000, discountPct: 2 }] });
    expect(edit.status).toBe(200);
    // and the quotation can be resubmitted
    const again = ok(await sales.action("quotes", q.id, "Submit for approval"), "resubmit");
    expect(again.body.status).toBe("Approval pending");
  });
});

test.describe("QUO - Sales Executive (SLA sweep)", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-QUO-016", async () => {
    test.slow();
    const c = await base();
    const sent = await build.sentQuotation(c.sales, qOpts(c, { validDays: 3 }));
    const expiryTimers = async () => (await slaTimersOf(sent.id)).filter((t) => t.name === "Quotation expiry reminder");
    // positive signal that the date sweep runs: an activity with a past due date gets its SLA-06 timer from the same sweep
    // leftovers of a killed earlier run (open, past due) would crowd salesExec1's dashboard action queue: cancel them first
    for (const stale of (await c.sales.get("/modules/activities?search=Q16PROBE&limit=100&status=Open")).body.data ?? []) {
      await c.sales.action("activities", stale.id as string, "Cancel");
    }
    const sweepProbe = rec(await build.activity(c.sales, { subject: `Q16PROBE ${uniqueTag("Q16")} sweep probe`, type: "Call", priority: "Medium", dueDate: isoDate(-1) }), "create sweep probe activity");
    try {
      const swept = await eventually(async () => (await slaTimersOf(sweepProbe.id as string)).length, (n) => n > 0, 30_000);
      expect(swept, "the date sweep started a timer for the probe activity").toBeGreaterThan(0);
      // validity is 3 days away (< 7): the same sweep must start SLA-13 'Quotation expiry reminder' (given one more sweep interval)
      const started = await eventually(expiryTimers, (t) => t.length > 0, 30_000);
      test.info().annotations.push({ type: "observed", description: `SLA-13 timers after the sweep window: ${started.length}` });
      // The date sweep starts SLA-13 for a quotation valid for < 7 days (D-71 fixed by d1e2f72).
      expect(started, "SLA-13 timer on a Sent quotation valid for 3 days").toEqual([{ name: "Quotation expiry reminder", open: true }]);
      // SLA-12 (follow-up, started by Mark sent) runs regardless
      expect((await slaTimersOf(sent.id)).filter((t) => t.name === "Quotation follow-up")).toEqual([{ name: "Quotation follow-up", open: true }]);
      expect(((await quoteOf(c.sales, sent.id)).sla as Sla)?.l).toMatch(/^Due in /);
      // revising stops the expiry reminder (when one exists)
      ok(await c.sales.action("quotes", sent.id, "Revise → new version"), "revise");
      expect((await expiryTimers()).filter((t) => t.open), "no open SLA-13 timer after revising").toEqual([]);
    } finally {
      // cleanup only: a failed cancel must not mask the test result
      try {
        await c.sales.action("activities", sweepProbe.id as string, "Cancel");
      } catch {
        // ignore
      }
    }
  });

  tc("TC-QUO-017", async () => {
    test.slow();
    const c = await base();
    // validity 3 days in the past (created through the API: the form takes any date)
    const sent = await build.sentQuotation(c.sales, qOpts(c, { validDays: -3 }));
    // Spec: a Sent quotation past its validity date becomes 'Expired' automatically (verified: it stays 'Sent', nothing sets 'Expired')
    const status = await eventually(async () => (await quoteOf(c.sales, sent.id)).status, (s) => s === "Expired", 20_000);
    expect(status).toBe("Expired");
  });
});
