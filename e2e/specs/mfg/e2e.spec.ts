// e2e/specs/mfg/e2e.spec.ts - end-to-end lifecycle journeys (TC-E2E-001..016). 001 is the long multi-role happy path (lead -> cash -> warranty -> renewal);
// 002..012, 015, 016 are short independent journeys that compose module behaviours into the cross-module OUTCOME the case names (module assertions live in
// the module specs); 013 / 014 are known gaps (spec-correct bodies, wrapped by tc()).
// Where the UI is known broken the step runs through the API and says why: money / number drawer fields posted as strings (D-6), opportunity create drawer (D-33),
// serial prompt never opens (D-90), Operations cannot create a dispatch (D-87), own-record scoping of orders / payments / tickets (D-32, D-101, D-102).
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { authFile, MFG_USERS, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ConvertLeadDialog } from "../../pages/mfg/ConvertLeadDialog";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, TERMS, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { automationRunCount, restoreSlaThrowawayIfNeeded, slaTimerDetail, THROWAWAY_SLA_PREFIX, withThrowawaySlaPolicy } from "../../mfg/db";
import { assertNoProviderCredentials, readE2eEnv } from "../../mfg/envGuard";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { pdfText } from "../../mfg/pdf";
import { uniqueEmail, uniqueGstin, uniquePhone, uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const DAY_MS = 86_400_000;
const FLOW = ["Order accepted", "Design", "Procurement", "Production", "Quality check", "Ready for dispatch", "Dispatched", "Delivered", "Installation", "Commissioned", "Closed"];
const STAGES = [
  "Qualified", "Requirement collected", "Technical discussion", "Site visit", "Demo / trial", "Solution proposed", "Costing",
  "Quotation sent", "Negotiation", "Approval pending", "PO expected", "PO received",
] as const;
const COSTS = { material: 400_000, boughtOut: 100_000, fabrication: 150_000, labor: 50_000 }; // total 700000 -> 30 % margin on 1,000,000
const DIRECTOR_EMAIL = MFG_USERS.director.email;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const rows = (r: ApiResult, what: string): Rec[] => ok(r, what).body.data ?? [];
const idsOf = (r: ApiResult): string[] => (r.body.data ?? []).map((x) => x.id as string);
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
const TODAY = (): string => dateInput(0);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
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
const archiveQuietly = async (key: string, ids: string[]): Promise<void> => {
  const director = await apiAs("director");
  for (const id of ids) {
    try {
      await director.post(`/modules/${key}/${id}/archive`);
    } catch {
      // cleanup only
    }
  }
};
/** Runs `fn` with a page logged in as `role` in its own context (storage states are opened when needed; API clients of apiAs re-login once on a 401, see api.ts). */
const asRole = async <T>(browser: Browser, role: MfgRoleKey, fn: (page: Page) => Promise<T>): Promise<T> => {
  const ctx = await browser.newContext({ storageState: authFile(role), baseURL: test.info().project.use.baseURL });
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
};
const note = (description: string): void => { test.info().annotations.push({ type: "note", description }); };
const read = (key: string) => async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/${key}/${id}`), `read ${key}`);
const oppOf = read("opps");
const quoteOf = read("quotes");
const poOf = read("pos");
const orderOf = read("sorders");
const leadOf = read("leads");
const approvalsOf = async (api: ApiClient, entityId: string): Promise<Rec[]> => rows(await api.get("/modules/approvals?limit=100"), "list approvals").filter((a) => a.entityId === entityId);
const poCompare = async (id: string): Promise<Record<string, Rec>> => {
  const t = rec(await (await apiAs("commercial")).get(`/modules/pos/${id}/table/compare`), "compare table") as { rows?: Rec[] };
  return Object.fromEntries((t.rows ?? []).map((r) => [r.check as string, r]));
};
const milestonesOf = async (api: ApiClient, orderId: string): Promise<Rec[]> =>
  rows(await api.get(`/modules/payments?salesOrderId=${orderId}&limit=100`), "list milestones").filter((m) => m.salesOrderId === orderId).sort((a, b) => (a.amount as number) - (b.amount as number));
const historyOf = async (api: ApiClient, oppId: string): Promise<{ label: string; actor: string; at: string }[]> =>
  (await api.get(`/modules/opps/${oppId}/events/history`)).body as unknown as { label: string; actor: string; at: string }[];
const assetsBySerial = async (serial: string): Promise<Rec[]> => rows(await (await apiAs("director")).get(`/modules/assets?search=${encodeURIComponent(serial)}`), "find asset");
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);

/** Throwaway records of a journey: archived after the test, pass or fail (newest first, so children go before their account). */
const cleanup: { key: string; id: string }[] = [];
const track = (key: string, id: string): string => { cleanup.push({ key, id }); return id; };
test.afterEach(async () => {
  for (const { key, id } of cleanup.splice(0).reverse()) await archiveQuietly(key, [id]);
});

/** Account + opportunity owned by salesExec1 + a product made by Commercial. */
const base = async (productOver: Rec = {}) => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  track("accounts", account.id);
  const opp = await build.opportunity(sales, account.id);
  track("opps", opp.id);
  const product = await build.product(await apiAs("commercial"), productOver);
  track("products", product.id);
  return { sales, account, opp, product };
};
/** Sent quotation (one 10,00,000 line, no discount) + its PO accepted by Commercial; `ownerId` makes someone else the owner of PO / order / milestones. */
const newOrder = async (o: { ownerId?: string; value?: number } = {}) => {
  const c = await base();
  const quote = await build.sentQuotation(c.sales, { opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id });
  const commercial = await apiAs("commercial");
  const poId = rec(await commercial.post("/modules/pos", {
    poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: c.opp.id, quotationId: quote.id, accountId: c.account.id,
    value: o.value ?? 1_000_000, paymentTerms: TERMS, ...(o.ownerId ? { ownerId: o.ownerId } : {}),
  }), "create PO").id as string;
  ok(await commercial.action("pos", poId, "Accept PO"), "accept PO");
  const { id } = await build.salesOrderFor(await apiAs("operations"), poId);
  return { ...c, quote, poId, id };
};
const advanceTo = async (api: ApiClient, id: string, target: string, serial?: string): Promise<void> => {
  const steps = FLOW.indexOf(target) - FLOW.indexOf(String((await orderOf(api, id)).status));
  for (let i = 0; i < steps; i += 1) ok(await api.action("sorders", id, "Advance status", serial ? { serial } : {}), "advance order");
};
/**
 * Advance status at Installation in the UI. Spec: a 'Serial number required' dialog opens. The UI only sees axios's generic 400 text so it never does (D-90);
 * the step is then finished through the API.
 */
const commissionInUi = async (page: Page, api: ApiClient, id: string, serial: string): Promise<void> => {
  const detail = new ModuleDetail(page);
  await detail.goto("sorders", id);
  expect(await detail.statusText()).toBe("Installation");
  await detail.action("Advance status");
  const dialog = page.getByRole("dialog", { name: "Serial number required" });
  await knownDefect(test.info(), "D-90", async () => {
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await dialog.locator("#commission-serial").fill(serial);
    await dialog.getByRole("button", { name: "Advance", exact: true }).click();
  });
  expect((await orderOf(api, id)).status, "the click without a serial changed nothing").toBe("Installation");
  ok(await api.action("sorders", id, "Advance status", { serial }), "commission through the API (D-90)");
};
/** Counts the action POSTs (`.../actions`) a page sends while a logical UI action runs. */
const watchActions = (p: Page): { count: () => number; stop: () => void } => {
  let n = 0;
  const onRequest = (r: Request): void => { if (r.method() === "POST" && /\/actions$/.test(r.url())) n += 1; };
  p.on("request", onRequest);
  return { count: () => n, stop: () => p.off("request", onRequest) };
};
/** One logical action must reach the server exactly once: a second POST is a double submit (a product bug), not noise. */
const expectSingleSubmit = (label: string, sent: number): void => {
  if (sent > 1) test.info().annotations.push({ type: "double submit", description: `${label}: ${sent} action POSTs for one click` });
  if (sent !== 1) throw new Error(`${label}: expected exactly 1 action POST, saw ${sent}${sent > 1 ? " (double submit)" : ""}`);
};
/**
 * Clicks an action (opening the ActionDialog and answering it with `value` when given) until `done()` holds. A click that is lost right after a cold page load
 * is repeated once, ONLY when no request was sent for it (no dialog opened / no action POST); afterwards exactly one action POST must have been sent.
 */
const actUntil = async (d: ModuleDetail, p: Page, label: string, done: () => Promise<boolean>, value?: string, timeout = 20_000): Promise<void> => {
  const watch = watchActions(p);
  try {
    await d.action(label);
    if (value !== undefined) {
      let opened = true;
      try {
        await p.locator("#action-ask-field").waitFor({ timeout: 6_000 });
      } catch {
        opened = false;
      }
      if (!opened && watch.count() === 0) await d.action(label);
      await d.answerPrompt(value);
    } else {
      const settled = await eventually(done, (v) => v, 8_000);
      if (!settled && watch.count() === 0 && (await d.hasAction(label))) await d.action(label);
    }
    await expect.poll(done, { timeout, message: `${label} took effect` }).toBe(true);
    expectSingleSubmit(label, watch.count());
  } finally {
    watch.stop();
  }
};
const statusIs = (d: ModuleDetail, status: string) => async (): Promise<boolean> => (await d.statusText().catch(() => "")) === status;
const act = (d: ModuleDetail, p: Page, label: string, status: string): Promise<void> => actUntil(d, p, label, statusIs(d, status));
const actPrompt = (d: ModuleDetail, p: Page, label: string, value: string, status: string): Promise<void> => actUntil(d, p, label, statusIs(d, status), value);
/** Overdue-open leftovers of earlier runs would crowd salesExec1's dashboard queue: cancel them before creating a probe activity. */
const cancelStaleProbes = async (api: ApiClient, prefix: string): Promise<void> => {
  for (const stale of rows(await api.get(`/modules/activities?search=${prefix}&limit=100&status=Open`), "list stale probes")) {
    await api.action("activities", stale.id as string, "Cancel");
  }
};

// A previous run that died inside the throwaway SLA policy (TC-E2E-009) is healed before anything depends on it.
test.beforeAll(async () => {
  await restoreSlaThrowawayIfNeeded();
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
test.describe("E2E - Sales Executive (journeys)", () => {
  test.use({ storageState: authFile("salesExec1"), actionTimeout: 30_000 });

  tc("TC-E2E-001", async ({ page, browser }) => {
    test.setTimeout(420_000);
    const sales = await apiAs("salesExec1");
    const [engineer, commercial, salesManager, salesHead, operations, accounts, serviceManager, serviceEngineer, director] = await Promise.all(
      (["appEngineer", "commercial", "salesManager", "salesHead", "operations", "accounts", "serviceManager", "serviceEngineer", "director"] as const).map((r) => apiAs(r)),
    ) as [ApiClient, ApiClient, ApiClient, ApiClient, ApiClient, ApiClient, ApiClient, ApiClient, ApiClient];

    // ---- 1. Sales Executive (UI): lead New -> Contacted -> Qualified ----
    const tag = uniqueTag("E2E1");
    const company = `${tag} Steel Pvt Ltd`;
    const phone = uniquePhone();
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // the Estimated value is left out: money fields are posted as strings and the API rejects them (D-6)
    note("lead created without Estimated value in the drawer (D-6: money / number fields are posted as strings)");
    await drawer.fill({
      company, contactName: "Buyer One", phone, email: uniqueEmail(tag), product: "Weighbridge", source: "IndiaMART", city: "Pune", state: "Maharashtra",
      next: "Call the buyer", nextDate: dateInput(2),
    });
    await drawer.save();
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    const leadId = idFromUrl(page);
    const leadDetail = new ModuleDetail(page);
    await leadDetail.expectAction("Mark contacted"); // record loaded (the status bar renders after it)
    expect(await leadDetail.statusText()).toBe("New");
    expect(await leadOf(sales, leadId)).toMatchObject({ status: "New", company, source: "IndiaMART" });
    await act(leadDetail, page, "Mark contacted", "Contacted");
    await act(leadDetail, page, "Qualify", "Qualified");
    expect((await leadOf(sales, leadId)).status).toBe("Qualified");

    // ---- 2. Convert (UI): new account with GSTIN, Decision Maker -> opportunity ----
    const gstin = uniqueGstin();
    await leadDetail.action("Convert to opportunity");
    const dialog = new ConvertLeadDialog(page);
    await dialog.expectOpen();
    await dialog.setContactRole("Decision Maker");
    await dialog.chooseNewAccount({ type: "Customer", industry: "Steel & metals", territory: "West", gstin });
    await dialog.confirm();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const oppId = idFromUrl(page);
    const opp = await oppOf(director, oppId);
    const accountId = opp.accountId as string;
    const contactId = opp.contactId as string;
    expect(opp).toMatchObject({ stage: "Qualified", title: `${company} — Weighbridge` });
    expect(await leadOf(sales, leadId)).toMatchObject({ status: "Converted" });
    const account = await read("accounts")(director, accountId);
    expect(account).toMatchObject({ name: company, gstin });
    expect(await read("contacts")(director, contactId)).toMatchObject({ accountId, role: "Decision Maker", phone });
    note("account / contact of the conversion are read as Director: they get no owner, so the converting rep gets 404 (D-15)");

    // ---- 3. Application Engineer: RFQ feasible -> approved for costing; site visit completed; demo -> customer approved ----
    const rfq = await build.rfq(engineer, { opportunityId: oppId, accountId });
    const visit = await build.visit(engineer, { accountId, opportunityId: oppId });
    const demo = await build.evaluation(engineer, { opportunityId: oppId, accountId });
    await asRole(browser, "appEngineer", async (p) => {
      const d = new ModuleDetail(p);
      await d.goto("rfqs", rfq.id);
      expect(await d.statusText()).toBe("Received");
      await act(d, p, "Mark feasible", "Technically feasible");
      await act(d, p, "Approve for costing", "Approved for costing");

      await d.goto("visits", visit.id);
      expect(await d.statusText()).toBe("Planned");
      await act(d, p, "Confirm", "Confirmed");
      await actPrompt(d, p, "Complete visit", "Send the quotation", "Completed");

      for (const action of ["Schedule", "Start", "Mark successful"]) ok(await engineer.action("demos", demo.id, action), `demo ${action}`);
      await d.goto("demos", demo.id);
      expect(await d.statusText()).toBe("Successful");
      await act(d, p, "Customer approved", "Customer approved");
    });
    expect(await read("rfqs")(director, rfq.id)).toMatchObject({ status: "Approved for costing", opportunityId: oppId, accountId });
    expect(await read("visits")(director, visit.id)).toMatchObject({ status: "Completed", opportunityId: oppId });
    expect(await read("demos")(director, demo.id)).toMatchObject({ status: "Customer approved", opportunityId: oppId });

    // ---- 4. Commercial: costing at 30 % margin -> submit -> approval -> Approved ----
    const product = await build.product(commercial);
    const sheet = rec(await build.costing(commercial, { ...COSTS, sellingPrice: 1_000_000, opportunityId: oppId, accountId }), "create costing sheet");
    const sheetId = sheet.id as string;
    expect(sheet.status).toBe("Draft");
    expect(rec(await commercial.action("costing", sheetId, "Submit"), "submit costing")).toMatchObject({ status: "Approval pending", total: 700_000, gmPct: 30 });
    const marginApprovals = await approvalsOf(director, sheetId);
    expect(marginApprovals, "one Margin approval for the sheet").toHaveLength(1);
    expect(marginApprovals[0]).toMatchObject({ type: "Margin", status: "Requested", currentApprover: "Sales Head" });
    ok(await salesHead.action("costing", sheetId, "Approve"), "approve costing");
    expect((await read("costing")(commercial, sheetId)).status).toBe("Approved");

    // ---- 5. Sales Executive: quotation with 8 % discount -> submit (UI) -> manager approves (UI) -> Mark sent -> Mark accepted ----
    const quote = await build.quotation(sales, { opportunityId: oppId, accountId, productId: product.id, discountPct: 8 }); // lines are API-only (D-53 / D-6)
    const quoteDetail = new ModuleDetail(page);
    await quoteDetail.goto("quotes", quote.id);
    await quoteDetail.expectAction("Submit for approval");
    expect(await quoteDetail.statusText()).toBe("Draft");
    await act(quoteDetail, page, "Submit for approval", "Approval pending");
    const discountApprovals = await approvalsOf(director, quote.id);
    expect(discountApprovals, "one Discount approval for the quotation").toHaveLength(1);
    expect(discountApprovals[0]).toMatchObject({ type: "Discount", status: "Requested", currentApprover: "Sales Manager", entityType: "Quotation" });
    const approvalId = discountApprovals[0]?.id as string;
    await asRole(browser, "salesManager", async (p) => {
      const d = new ModuleDetail(p);
      await d.goto("approvals", approvalId);
      expect(await d.statusText()).toBe("Requested");
      await actPrompt(d, p, "Approve", "Within the manager discount authority", "Approved");
    });
    expect((await read("approvals")(salesManager, approvalId)).status).toBe("Approved");
    // D-76 / D-69: approving the Approval record does not move the quotation and the quotation page has no Approve button, so the quotation's own Approve goes through the API
    await knownDefect(test.info(), "D-76", async () => {
      expect((await quoteOf(sales, quote.id)).status, "quotation after its approval was approved").toBe("Approved");
    });
    ok(await salesManager.action("quotes", quote.id, "Approve"), "approve the quotation itself (D-69)");
    expect((await quoteOf(sales, quote.id)).status).toBe("Approved");
    await page.reload();
    await quoteDetail.expectAction("Mark sent");
    await act(quoteDetail, page, "Mark sent", "Sent");
    await act(quoteDetail, page, "Mark accepted", "Accepted");
    expect(await quoteOf(sales, quote.id)).toMatchObject({ status: "Accepted", opportunityId: oppId, accountId, version: 1 });
    const quoteValue = 920_000; // 1 x 10,00,000 less 8 %

    // ---- 6. Commercial: PO with the 30/60/10 terms -> verify (UI) -> Accept PO (UI) ----
    const accountsId = await userIdOf("accounts"); // payment milestones are own-record scoped (D-101): the Accounts user owns this PO so it can work its milestones
    const po = { id: rec(await commercial.post("/modules/pos", {
      poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: oppId, quotationId: quote.id, accountId, value: quoteValue, paymentTerms: TERMS, ownerId: accountsId,
    }), "create PO").id as string };
    await asRole(browser, "commercial", async (p) => {
      const d = new ModuleDetail(p);
      await d.goto("pos", po.id);
      expect(await d.statusText()).toBe("Received");
      await act(d, p, "Start verification", "Under verification");
      await d.tab("PO vs Quotation");
      await expect(p.getByRole("tabpanel").getByRole("row").filter({ hasText: "Payment terms" })).toBeVisible();
      const valueRow = p.getByRole("tabpanel").getByRole("row").filter({ has: p.getByRole("cell", { name: "Value", exact: true }) });
      await expect(valueRow).toContainText("Mismatch"); // loaded; the compare sums qty x unit price and ignores the 8 % line discount, so the discounted PO value differs (D-137)
      expect(await poCompare(po.id)).toMatchObject({ Value: { quotation: 1_000_000, po: quoteValue, result: "Mismatch" } });
      await knownDefect(test.info(), "D-137", async () => {
        await expect(valueRow, "a PO at the discounted quotation total matches").toContainText("Match", { timeout: 1_000 });
        await expect(valueRow).not.toContainText("Mismatch", { timeout: 1_000 });
      });
      await act(d, p, "Accept PO", "Accepted");
    });
    expect(await poOf(director, po.id)).toMatchObject({ status: "Accepted", quotationId: quote.id, opportunityId: oppId, accountId });
    expect((await oppOf(director, oppId)).stage, "Accept PO wins the opportunity").toBe("Won");
    const { id: orderId } = await build.salesOrderFor(operations, po.id);
    expect(await orderOf(operations, orderId)).toMatchObject({ status: "Order accepted", ackStatus: "Pending", purchaseOrderId: po.id, accountId, value: quoteValue });
    const milestones = await milestonesOf(director, orderId);
    expect(milestones.map((m) => [m.milestone, m.pct, m.status])).toEqual([["After installation", 10, "Not due"], ["Advance", 30, "Not due"], ["Before dispatch", 60, "Not due"]]);
    expect(milestones.reduce((s, m) => s + (m.amount as number), 0)).toBe(quoteValue);

    // ---- 7. Operations: acknowledge (UI), advance to Ready for dispatch, dispatch -> delivered, then Installation -> Commissioned with serial ----
    const serial = uniqueTag("SN");
    let dispatchId = "";
    await asRole(browser, "operations", async (p) => {
      const d = new ModuleDetail(p);
      await d.goto("sorders", orderId);
      expect(await d.statusText()).toBe("Order accepted");
      await actUntil(d, p, "Acknowledge handover", async () => (await orderOf(operations, orderId)).ackStatus === "Acknowledged");
      expect((await orderOf(operations, orderId)).status, "acknowledging does not move the order").toBe("Order accepted");
      for (const next of FLOW.slice(1, FLOW.indexOf("Ready for dispatch") + 1)) {
        ok(await operations.action("sorders", orderId, "Advance status"), `advance to ${next}`);
        expect((await orderOf(operations, orderId)).status).toBe(next);
      }
      // D-87: Operations only holds read/update on dispatch, so the dispatch is created by the Sales Head
      note("dispatch created by the Sales Head through the API (D-87: Operations cannot create dispatches)");
      dispatchId = rec(await salesHead.post("/modules/dispatch", {
        salesOrderId: orderId, accountId, dispatchDate: isoDate(1), invoiceNo: `INV-${tag}`, transporter: `${tag} Roadways`, vehicleNo: "MH12AB1234", expectedDelivery: isoDate(4),
      }), "create dispatch").id as string;
      await d.goto("dispatch", dispatchId);
      expect(await d.statusText()).toBe("Planned");
      await act(d, p, "Mark dispatched", "Dispatched");
      await act(d, p, "In transit", "In transit");
      await actPrompt(d, p, "Mark delivered", TODAY(), "Delivered");
      expect(await read("dispatch")(operations, dispatchId)).toMatchObject({ status: "Delivered", salesOrderId: orderId, accountId });
      // continue the order to Installation, commission with the serial
      for (const next of FLOW.slice(FLOW.indexOf("Ready for dispatch") + 1, FLOW.indexOf("Installation") + 1)) {
        ok(await operations.action("sorders", orderId, "Advance status"), `advance to ${next}`);
        expect((await orderOf(operations, orderId)).status).toBe(next);
      }
      await commissionInUi(p, operations, orderId, serial);
      expect((await orderOf(operations, orderId)).status).toBe("Commissioned");
    });
    const [asset] = await assetsBySerial(serial);
    if (!asset) throw new Error(`no installed asset for serial ${serial}`);
    const assetId = asset.id as string;
    expect(asset).toMatchObject({ serial, status: "Under warranty", accountId, salesOrderId: orderId });
    expect(Date.parse(asset.warrantyEnd as string)).toBeGreaterThan(Date.parse(asset.warrantyStart as string));

    // ---- 8. Accounts (UI): receipts for all three milestones ----
    const mine = await milestonesOf(accounts, orderId);
    if (mine.length !== 3) {
      // D-101: the milestones belong to whoever accepted the PO (Commercial); Accounts only sees milestones it owns
      expect(mine, "Accounts sees the milestones of the order").toHaveLength(3);
    }
    const receiptTarget: ApiClient = mine.length === 3 ? accounts : director;
    const receiptRole: MfgRoleKey = mine.length === 3 ? "accounts" : "director";
    await asRole(browser, receiptRole, async (p) => {
      const d = new ModuleDetail(p);
      for (const m of await milestonesOf(receiptTarget, orderId)) {
        await d.goto("payments", m.id as string);
        expect(await d.statusText()).toBe("Not due");
        await actPrompt(d, p, "Record receipt", String(m.amount), "Received");
        expect((await read("payments")(receiptTarget, m.id as string)).status, `milestone ${String(m.milestone)} received`).toBe("Received");
        const receipts = rows(await receiptTarget.get(`/modules/payments/${m.id as string}/related/receipts`), "receipts");
        expect(receipts.map((r) => r.amount)).toEqual([m.amount]);
      }
    });
    expect((await milestonesOf(director, orderId)).map((m) => m.status)).toEqual(["Received", "Received", "Received"]);

    // ---- 9. Service Manager: AMC -> reminders -> renewal opportunity (UI); ticket raised, worked and closed ----
    note("AMC / ticket created through the API (D-6 number fields; D-102 the Service Manager cannot open unassigned tickets, so tickets are driven as Director / Service Engineer)");
    const coverage = await build.coverage(serviceManager, { assetId, accountId, endInDays: 60 });
    const reminders = (ok(await serviceManager.get(`/modules/amc/${coverage.id}/events/reminders`), "reminder events").body as unknown as { label: string }[]).map((e) => e.label);
    expect(reminders).toEqual(["90 days before expiry", "60 days before expiry", "30 days before expiry"]);
    ok(await serviceManager.action("amc", coverage.id, "Mark contacted"), "mark contacted");
    let renewalId = "";
    await asRole(browser, "serviceManager", async (p) => {
      const d = new ModuleDetail(p);
      await d.goto("amc", coverage.id);
      expect(await d.statusText()).toBe("Contacted");
      await d.action("Create renewal opportunity");
      await expect(p).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/, { timeout: 15_000 });
      renewalId = idFromUrl(p);
    });
    expect(await read("amc")(serviceManager, coverage.id)).toMatchObject({ renewalOpportunityId: renewalId, assetId, accountId });
    expect(await oppOf(director, renewalId)).toMatchObject({ title: "AMC Renewal — Weighbridge", accountId, stage: "Qualified" });
    const ticket = await build.ticket(serviceManager, { accountId, assetId, priority: "High" });
    const ticketStatus = async (): Promise<string> => (await read("service")(director, ticket.id)).status as string;
    expect(await ticketStatus()).toBe("Open");
    ok(await director.action("service", ticket.id, "Assign engineer", { engineer: await userIdOf("serviceEngineer") }), "assign engineer");
    expect(await ticketStatus()).toBe("Assigned");
    ok(await director.action("service", ticket.id, "Schedule visit", { visitDate: dateInput(1) }), "schedule visit");
    expect(await ticketStatus()).toBe("Visit scheduled");
    ok(await serviceEngineer.action("service", ticket.id, "Start work"), "start work");
    expect(await ticketStatus()).toBe("In progress");
    ok(await serviceEngineer.action("service", ticket.id, "Resolve", { resolution: "Recalibrated the load cells" }), "resolve");
    expect(await ticketStatus()).toBe("Resolved");
    ok(await director.action("service", ticket.id, "Close"), "close");
    expect(await ticketStatus()).toBe("Closed");

    // ---- 10. Linkage: every record points at its predecessor (read as Director) ----
    expect(await read("costing")(director, sheetId)).toMatchObject({ opportunityId: oppId, accountId, status: "Approved" });
    expect(await poOf(director, po.id)).toMatchObject({ quotationId: quote.id });
    expect(await orderOf(director, orderId)).toMatchObject({ purchaseOrderId: po.id, accountId, status: "Commissioned" });
    expect(await read("dispatch")(director, dispatchId)).toMatchObject({ salesOrderId: orderId });
    expect(await read("assets")(director, assetId)).toMatchObject({ salesOrderId: orderId, accountId, serial });
    expect(await read("service")(director, ticket.id)).toMatchObject({ assetId, accountId, status: "Closed" });
    const milestoneIds = (await milestonesOf(director, orderId)).map((m) => m.id as string).sort();
    expect(milestoneIds).toHaveLength(3);
    // Account 360 (Director sees everything): each tab lists exactly this chain, via the API and on screen
    const related = async (tab: string): Promise<string[]> => idsOf(await director.get(`/modules/accounts/${accountId}/related/${tab}?limit=100`)).sort();
    const expectedTabs: [string, string, string[]][] = [
      ["Opportunities", "opps", [oppId, renewalId].sort()], ["Quotations", "quotes", [quote.id]], ["Orders", "orders", [orderId]],
      ["Installed assets", "assets", [assetId]], ["Service", "service", [ticket.id]], ["Payments", "payments", milestoneIds],
    ];
    expect(await related("contacts")).toEqual([contactId]);
    for (const [, key, ids] of expectedTabs) expect(await related(key), `account related/${key}`).toEqual(ids);
    await asRole(browser, "director", async (p) => {
      const d = new ModuleDetail(p);
      await d.goto("accounts", accountId);
      const panel = p.getByRole("tabpanel");
      for (const [tab, , ids] of expectedTabs) {
        await d.tab(tab);
        await expect(panel.getByRole("row")).toHaveCount(ids.length + 1); // header + the chain's rows
      }
    });
    note("dashboards / reports reconciliation for the same data is TC-E2E-012; Sales Executive Account 360 order / payment rows are hidden by own-record scoping (D-32)");
  });

  tc("TC-E2E-002", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const existing = await build.lead(sales);
    track("leads", existing.id);
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);
    // UI: typing the phone of an existing lead warns and offers "Open existing", which goes to that lead
    await list.goto();
    await list.clickNew();
    await drawer.fill({ phone: existing.phone });
    await expect(drawer.duplicateBanner).toBeVisible();
    await drawer.openExisting();
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    expect(idFromUrl(page)).toBe(existing.id);
    // The warning does not block: the same phone saves a second lead (verified: server creates it, 201)
    const duplicate = await sales.post("/modules/leads", { company: `${uniqueTag("E2E2")} Again Co`, contactName: "Again", phone: existing.phone, product: "Weighbridge", source: "Website" });
    expect(duplicate.status).toBe(201);
    track("leads", duplicate.body.id as string);
    const withPhone = idsOf(await sales.get(`/modules/leads?search=${existing.phone}`)).sort();
    expect(withPhone, "both leads share the phone").toEqual([existing.id, duplicate.body.id as string].sort());
    // Spec: server-side duplicate flag and a link / merge option (D-9: neither exists)
    expect(duplicate.body.duplicate, "server flags the duplicate").toBe(true);
    const detail = new ModuleDetail(page);
    await detail.goto("leads", duplicate.body.id as string);
    await expect(page.getByRole("button", { name: /merge|link/i }), "merge / link option on the duplicate lead").toBeVisible({ timeout: 1_500 });
  });

  tc("TC-E2E-003", async ({ page, browser }) => {
    const sales = await apiAs("salesExec1");
    const lead = await build.qualifiedLead(sales);
    track("leads", lead.id);
    const tag = uniqueTag("E2E3");
    const subjects = [`${tag} intro call`, `${tag} send brochure`];
    const activityIds: string[] = [];
    for (const subject of subjects) {
      activityIds.push(rec(await sales.post("/modules/activities", { type: "Call", subject, priority: "Medium", dueDate: isoDate(3), mfgLeadId: lead.id }), "create lead activity").id as string);
    }
    try {
      expect(idsOf(await sales.get(`/modules/leads/${lead.id}/related/acts`)).sort(), "activities on the lead before converting").toEqual([...activityIds].sort());
      const detail = new ModuleDetail(page);
      const dialog = new ConvertLeadDialog(page);
      await detail.goto("leads", lead.id);
      await detail.action("Convert to opportunity");
      await dialog.setContactRole("Decision Maker");
      await dialog.chooseNewAccount({ type: "Customer", industry: "Cement", territory: "West", gstin: uniqueGstin() });
      await dialog.confirm();
      await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
      const opp = await oppOf(await apiAs("director"), idFromUrl(page));
      const director = await apiAs("director");
      track("accounts", opp.accountId as string);
      track("contacts", opp.contactId as string);
      track("opps", opp.id as string);
      // links: opportunity -> account + contact, contact -> account, lead Converted
      expect(await read("accounts")(director, opp.accountId as string)).toMatchObject({ name: lead.company });
      expect(await read("contacts")(director, opp.contactId as string)).toMatchObject({ accountId: opp.accountId, phone: lead.phone, role: "Decision Maker" });
      expect(opp.title).toBe(`${lead.company} — Weighbridge`);
      expect(await leadOf(sales, lead.id)).toMatchObject({ status: "Converted", company: lead.company });
      // the same links on screen (the Director sees records without an owner): account page + its tabs, contact page
      await asRole(browser, "director", async (p) => {
        const d = new ModuleDetail(p);
        await d.goto("accounts", opp.accountId as string);
        await expect(p.getByText(lead.company).first()).toBeVisible();
        await d.tab("Opportunities");
        await expect(p.getByRole("tabpanel").getByText(opp.title as string)).toBeVisible();
        await d.tab("Contacts");
        await expect(p.getByRole("tabpanel").getByRole("row")).toHaveCount(2); // header + the converted contact
        await d.goto("contacts", opp.contactId as string);
        await expect(p.getByText(lead.phone).first()).toBeVisible();
        await expect(p.getByText("Decision Maker").first()).toBeVisible();
      });
      // history retained: the converted lead and its activities are still reachable, in the API and in the lead's Activities tab
      expect(idsOf(await sales.get(`/modules/leads/${lead.id}/related/acts`)).sort(), "activities on the lead after converting").toEqual([...activityIds].sort());
      await detail.goto("leads", lead.id);
      await detail.tab("Activities");
      const panel = page.getByRole("tabpanel");
      for (const subject of subjects) await expect(panel.getByText(subject)).toBeVisible();
      await expect(panel.getByRole("row")).toHaveCount(subjects.length + 1);
      // Spec: the history is carried over to the new opportunity / account as well (Partial: only the lead keeps it)
      const carried = idsOf(await director.get(`/modules/opps/${String(opp.id)}/related/acts`));
      if (carried.length === 0) note("current: the lead's activities stay on the lead; the opportunity starts with an empty Activities tab");
    } finally {
      for (const id of activityIds) {
        try { await sales.action("activities", id, "Cancel"); } catch { /* cleanup only */ }
      }
    }
  });

  tc("TC-E2E-004", async ({ page }) => {
    test.slow();
    const sales = await apiAs("salesExec1");
    const director = await apiAs("director");
    const account = await build.account(sales);
    track("accounts", account.id);
    const opp = await build.opportunity(sales, account.id);
    track("opps", opp.id);
    const detail = new ModuleDetail(page);
    await detail.goto("opps", opp.id);
    expect(await detail.statusText()).toBe("Qualified");
    // first move through the Advance stage dialog (next action + date are mandatory), the rest through the API with the same mandatory fields
    await detail.action("Advance stage");
    await page.locator("#advance-next-action").fill(`Action for ${STAGES[1]}`);
    await page.locator("#advance-next-action-date").fill(dateInput(2));
    await page.getByRole("dialog").getByRole("button", { name: "Advance", exact: true }).click();
    await expect.poll(() => detail.statusText()).toBe(STAGES[1]);
    for (const [i, stage] of STAGES.slice(2).entries()) {
      ok(await sales.patch(`/modules/opps/${opp.id}`, { stage, nextAction: `Action for ${stage}`, nextActionDate: isoDate(i + 3) }), `advance to ${stage}`);
      expect(await oppOf(sales, opp.id), stage).toMatchObject({ stage, nextAction: `Action for ${stage}`, daysInStage: 0 });
    }
    ok(await sales.action("opps", opp.id, "Mark won"), "mark won");
    expect((await oppOf(sales, opp.id)).stage).toBe("Won");
    // stage history: one row per change, in order, with actor and a non-decreasing timestamp
    const expected = [...STAGES.slice(1).map((s, i) => `${STAGES[i]} → ${s}`), `${STAGES.at(-1)} → Won`];
    const events = await historyOf(director, opp.id);
    expect(events.map((e) => e.label)).toEqual(expected);
    expect(new Set(events.map((e) => e.actor))).toEqual(new Set(["Mfg Sales Exec 1"]));
    const times = events.map((e) => Date.parse(e.at));
    expect(times.every((t) => !Number.isNaN(t))).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    await detail.goto("opps", opp.id);
    await detail.tab("Stage history");
    const items = page.getByRole("tabpanel").getByRole("listitem");
    await expect(items).toHaveCount(expected.length);
    await expect(items.first()).toContainText(expected[0] as string);
    await expect(items.last()).toContainText(expected.at(-1) as string);
    // Days in stage: 0 right after the move (the record carries it); the detail field is blank (D-34)
    await detail.tab("Overview");
    await expect(page.locator("p:text-is('Opportunity age (days)') + p")).toBeVisible(); // overview loaded
    await knownDefect(test.info(), "D-34", async () => {
      await expect(page.locator("p:text-is('Days in stage') + p")).toHaveText("0", { timeout: 1_000 });
    });
  });

  tc("TC-E2E-005", async ({ page }) => {
    const c = await base();
    const opts = { opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id };
    const v1 = await build.sentQuotation(c.sales, opts);
    expect(await quoteOf(c.sales, v1.id)).toMatchObject({ status: "Sent", version: 1 });
    // revise (UI) -> V2 draft linked to V1
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", v1.id);
    await detail.action("Revise → new version");
    await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]{36}$/);
    await expect.poll(() => idFromUrl(page)).not.toBe(v1.id);
    const v2Id = idFromUrl(page);
    await detail.expectAction("Submit for approval");
    expect(await detail.statusText()).toBe("Draft");
    expect(await quoteOf(c.sales, v2Id)).toMatchObject({ version: 2, parentId: v1.id, status: "Draft", opportunityId: c.opp.id, accountId: c.account.id });
    expect(await quoteOf(c.sales, v1.id)).toMatchObject({ version: 1, status: "Revised" });
    // V1 is read-only: lines refused, no workflow actions on its page
    const refused = await c.sales.patch(`/modules/quotes/${v1.id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1, discountPct: 0 }] });
    expect(refused.status).toBe(400);
    expect(ApiClient.message(refused)).toBe("Quotation lines can only be edited while the quotation is in Draft (current status: 'Revised').");
    // V2: lines, submit, approve, send
    ok(await c.sales.patch(`/modules/quotes/${v2Id}`, { lines: [{ productId: c.product.id, qty: 1, unitPrice: 1_000_000, discountPct: 3 }] }), "edit V2 lines");
    const submitted = rec(await c.sales.action("quotes", v2Id, "Submit for approval"), "submit V2");
    if (submitted.status !== "Approved") ok(await c.sales.action("quotes", v2Id, "Approve"), "approve V2");
    ok(await c.sales.action("quotes", v2Id, "Mark sent"), "send V2");
    expect(await quoteOf(c.sales, v2Id)).toMatchObject({ status: "Sent", version: 2, parentId: v1.id });
    await detail.goto("quotes", v1.id);
    await expect.poll(() => detail.isOutOfFlow(), { timeout: 15_000 }).toBe(true); // Revised is outside the quotation flow
    for (const label of ["Submit for approval", "Mark sent", "Mark accepted", "Revise → new version"]) await detail.expectNoAction(label);
    // chain visible on V2's Versions tab (spec: V1 and V2; D-65: only the opened version's own entry)
    await detail.goto("quotes", v2Id);
    await detail.tab("Versions");
    await expect(page.getByRole("tabpanel").getByText("V2 created")).toBeVisible();
    await knownDefect(test.info(), "D-65", async () => {
      await expect(page.getByRole("tabpanel").getByText("V1 created")).toBeVisible({ timeout: 1_000 });
    });
  });

  tc("TC-E2E-006", async ({ page }) => {
    const c = await base();
    const director = await apiAs("director");
    const q = await build.quotation(c.sales, { opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id, discountPct: 18 });
    ok(await c.sales.action("quotes", q.id, "Submit for approval"), "submit");
    expect((await quoteOf(c.sales, q.id)).status).toBe("Approval pending");
    // routed to the Director (15-100 % band)
    const approvals = await approvalsOf(director, q.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ type: "Discount", status: "Requested", currentApprover: "Director", entityType: "Quotation" });
    expect(String(approvals[0]?.reason)).toMatch(/^Discount 18% matched rule /);
    // send is blocked, in the API (exact message) and on screen (no Mark sent button)
    await expectActionRejected(c.sales, "quotes", q.id, "Mark sent", {}, "Cannot Mark sent a quotation in status 'Approval pending'");
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", q.id);
    expect(await detail.statusText()).toBe("Approval pending");
    await detail.expectNoAction("Mark sent");
    // the Director decides (the approval record), then the quotation
    const approvalId = approvals[0]?.id as string;
    ok(await director.action("approvals", approvalId, "Approve", { comments: "Strategic account" }), "director approves");
    expect(await read("approvals")(director, approvalId)).toMatchObject({ status: "Approved", approverComments: "Strategic account" });
    // Spec: the quotation unblocks once its approval is approved. Current: only the quotation's own Approve moves it (D-76)
    const status = (await quoteOf(c.sales, q.id)).status;
    if (status !== "Approved") {
      expect(status, "current: still waiting (remove with D-76)").toBe("Approval pending");
      await expectActionRejected(c.sales, "quotes", q.id, "Mark sent", {}, "Cannot Mark sent a quotation in status 'Approval pending'");
    }
    await knownDefect(test.info(), "D-76", async () => {
      expect(status, "quotation after the Director approved its approval").toBe("Approved");
    });
    ok(await director.action("quotes", q.id, "Approve"), "approve the quotation itself");
    ok(await c.sales.action("quotes", q.id, "Mark sent"), "send");
    expect((await quoteOf(c.sales, q.id)).status).toBe("Sent");
  });

  tc("TC-E2E-008", async ({ page }) => {
    // One assertion set for the three channels: screen, export, API. (Costing / PDF details are covered by TC-CST-011 / TC-CST-012; PRD-004 for field masking.)
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const c = await base({ cost: 654_321, minPrice: 910_011 });
    const sheet = rec(await build.costing(commercial, { ...COSTS, sellingPrice: 1_000_000, opportunityId: c.opp.id, accountId: c.account.id }), "create costing sheet");
    ok(await commercial.action("costing", sheet.id as string, "Submit"), "submit costing");
    const quote = await build.quotation(sales, { opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id });
    // API: every costing route is 403 for the rep who owns the opportunity
    for (const path of ["/modules/costing", `/modules/costing/${sheet.id as string}`, `/modules/costing/${sheet.id as string}/table/breakdown`, "/modules/costing/export"]) {
      const r = await sales.get(path);
      expect(r.status, path).toBe(403);
      expect(ApiClient.message(r), path).toBe("Your role does not have 'read' access to 'costing'.");
    }
    // API: quotation / opportunity / product reads carry no cost data
    expect(Object.keys(await quoteOf(sales, quote.id)).filter((k) => /cost|margin|^gm/i.test(k)), "cost keys on the quotation").toEqual([]);
    expect(Object.keys(await oppOf(sales, c.opp.id)).filter((k) => /cost|margin|^gm/i.test(k)), "cost keys on the opportunity").toEqual([]);
    const productRead = rec(await sales.get(`/modules/products/${c.product.id}`), "read product as rep");
    expect([productRead.cost ?? null, productRead.minPrice ?? null], "restricted product fields are masked").toEqual([null, null]);
    // Export: the products CSV has no cost / minimum price values, the quotations CSV has no cost / margin column
    const csv = async (path: string): Promise<string> => {
      const res = await fetch(`http://localhost:3001/api/v1${path}`, { headers: { authorization: `Bearer ${sales.token}` } });
      expect(res.status, path).toBe(200);
      return res.text();
    };
    const productsCsv = await csv("/modules/products/export");
    expect(productsCsv, "products export loaded with the product").toContain(c.product.sku);
    expect(productsCsv).not.toContain("654321");
    expect(productsCsv).not.toContain("910011");
    const quotesCsv = await csv("/modules/quotes/export");
    expect(quotesCsv, "quotations export loaded with the quotation").toContain(quote.id);
    expect((quotesCsv.split("\n")[0] ?? "")).not.toMatch(/cost|margin|gm/i);
    // PDF of the quotation: customer pricing only
    const res = await fetch(`http://localhost:3001/api/v1/modules/quotes/${quote.id}/pdf`, { headers: { authorization: `Bearer ${sales.token}` } });
    expect(res.status).toBe(200);
    const text = pdfText(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain("Grand total");
    for (const secret of ["7,00,000", "700000", "6,54,321", "654321", "9,10,011", "910011"]) expect(text, `PDF contains ${secret}`).not.toContain(secret);
    // Screen: the costing page settles on the failed-load state (no cost shown), the quotation page shows no cost either
    await page.goto("/costing");
    await expect(page.getByText(/don't have access to this page/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Total cost|Gross margin|₹7\.0 L/)).toHaveCount(0);
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", quote.id);
    await detail.expectAction("Download PDF");
    await expect(page.getByText(/Total cost|Gross margin|Margin %|Cost breakdown/)).toHaveCount(0);
  });

  tc("TC-E2E-009", async () => {
    test.setTimeout(300_000);
    assertNoProviderCredentials(); // escalation e-mails are the reachable SES path
    const env = readE2eEnv();
    for (const key of ["SLA_DATE_SWEEP_MS", "SLA_TICK_MS"]) {
      if (!(Number(env[key]) <= 10_000)) throw new Error(`${key} must be set to <= 10000 in backend/.env.e2e.local (found ${env[key]})`);
    }
    const sales = await apiAs("salesExec1");
    await cancelStaleProbes(sales, "E2E9PROBE");
    const policy = `${THROWAWAY_SLA_PREFIX}${uniqueTag("E9")}`;
    const runsBefore = await automationRunCount(DIRECTOR_EMAIL);
    let activityId = "";
    try {
      // A throwaway policy that mirrors SLA-06 (start event 'Scheduled time', Owner at 100 %, Sales Manager at 200 %) with a 12 s target, so both escalation
      // levels are observable inside the test; the seeded SLA-06 (High = 4 business hours) is never shortened.
      await withThrowawaySlaPolicy(DIRECTOR_EMAIL, policy, {
        moduleKey: "activities", startEvent: "Scheduled time", stopEvent: "Activity completed", calendarType: "24 x 7",
        targets: [{ cond: "All", val: 0.2, unit: "minutes" }],
        escalationLevels: [{ at: 100, who: "Owner", channels: ["In-app"] }, { at: 200, who: "Sales Manager", channels: ["In-app"] }],
      }, async () => {
        const subject = `E2E9PROBE ${uniqueTag("E9")} overdue chase`;
        activityId = rec(await build.activity(sales, { subject, type: "Call", priority: "High", dueDate: isoDate(-1) }), "create overdue high-priority activity").id as string;
        // the date sweep starts both SLA-06 (seeded) and the throwaway timer for the overdue activity
        const timers = await eventually(() => slaTimerDetail(activityId), (t) => t.some((x) => x.name === "Follow-up completion") && t.some((x) => x.name === policy), 120_000);
        expect(timers.find((t) => t.name === "Follow-up completion"), "seeded SLA-06 timer started by the sweep").toMatchObject({ open: true });
        expect(timers.find((t) => t.name === policy), "throwaway timer started by the sweep").toMatchObject({ open: true });
        // level 2 (Sales Manager, resolved by role) is delivered to the manager's inbox with a link that opens the activity
        const inboxOf = (api: ApiClient) => async (): Promise<Rec[]> =>
          ((await api.get("/notifications?limit=50")).body.data ?? []).filter((n) => String(n.title).includes(policy) && n.link === `/activities/${activityId}`);
        const managerNotes = await eventually(inboxOf(await apiAs("salesManager")), (n) => n.length > 0, 120_000);
        expect(managerNotes, "Sales Manager notified of the overdue follow-up").toHaveLength(1);
        expect(managerNotes[0]).toMatchObject({ isRead: false });
        expect(String(managerNotes[0]?.title)).toMatch(new RegExp(`^SLA alert: ${policy} at \\d+% of target$`));
        expect((await slaTimerDetail(activityId)).find((t) => t.name === policy)?.lastEscalationLevel, "highest level reached is stored on the timer").toBe(200);
        // level 1 (Owner at 100 %) fired before level 2: the activity's owner should be notified. The Owner lookup has no entry for activities, so nobody is (D-138).
        const ownerNotes = await inboxOf(sales)();
        if (ownerNotes.length === 0) note("current: the owner of an overdue activity gets no SLA alert (D-138)");
        await knownDefect(test.info(), "D-138", async () => {
          expect(ownerNotes, "owner notified at 100 % of the SLA-06 target").toHaveLength(1);
        });
        // Spec: the escalation is also written to the automation / SLA run log. Nothing writes AutomationRun rows (D-115).
        await knownDefect(test.info(), "D-115", async () => {
          expect(await automationRunCount(DIRECTOR_EMAIL), "run-log rows after the escalation").toBeGreaterThan(runsBefore);
        });
      });
    } finally {
      if (activityId) {
        try { await sales.action("activities", activityId, "Cancel"); } catch { /* cleanup only */ }
      }
    }
  });

  tc("TC-E2E-013", async ({ page }) => {
    // GAP: a lost opportunity with a postponed reason (Budget) should schedule a reactivation task or enrol a nurture sequence.
    const sales = await apiAs("salesExec1");
    const director = await apiAs("director");
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id, { stage: "Negotiation" });
    track("accounts", account.id);
    track("opps", opp.id);
    const detail = new ModuleDetail(page);
    await detail.goto("opps", opp.id);
    await detail.action("Mark lost");
    await detail.answerPrompt("Budget");
    const lost = await eventually(() => oppOf(director, opp.id), (o) => o.stage === "Lost", 15_000);
    if (lost.stage !== "Lost" || lost.lostReason !== "Budget") throw new Error(`precondition: the opportunity is Lost with reason Budget (stage ${String(lost.stage)}, reason ${String(lost.lostReason)})`);
    const tasks = rows(await director.get(`/modules/opps/${opp.id}/related/acts`), "activities of the lost opportunity");
    const sequencesRes = ok(await director.get("/nurturing/sequences"), "nurturing sequences").body as unknown;
    const sequences = (Array.isArray(sequencesRes) ? sequencesRes : []) as Rec[]; // the list endpoint returns a plain array
    let enrolled = false;
    for (const seq of sequences) {
      const enrollments = JSON.stringify((await director.get(`/nurturing/sequences/${seq.id as string}/enrollments`)).body);
      if (enrollments.includes(opp.id)) enrolled = true;
    }
    // the spec-correct outcome (the only expect that may fail): a reactivation / nurture follow-up task OR a nurture enrolment exists for the lost deal
    const reactivation = tasks.some((t) => /reactivat|nurtur|re-engage|revisit/i.test(`${String(t.subject)} ${String(t.type)}`));
    expect(reactivation || enrolled, "reactivation task (activity on the opportunity) or nurture-sequence enrolment after Lost / Budget").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
test.describe("E2E - Commercial (journeys)", () => {
  test.use({ storageState: authFile("commercial"), actionTimeout: 30_000 });

  tc("TC-E2E-007", async ({ page }) => {
    const c = await base();
    const commercial = await apiAs("commercial");
    const quote = await build.sentQuotation(c.sales, { opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id }); // Rs 10 L
    const mismatch = await build.po(commercial, { opportunityId: c.opp.id, accountId: c.account.id, quotationId: quote.id, value: 950_000 });
    const control = await build.po(commercial, { opportunityId: c.opp.id, accountId: c.account.id, quotationId: quote.id, value: 1_000_000 });
    expect((await poCompare(mismatch.id)).Value).toMatchObject({ quotation: 1_000_000, po: 950_000, result: "Mismatch" });
    expect((await poCompare(control.id)).Value, "a PO at the quoted value matches").toMatchObject({ po: 1_000_000, result: "Match" });
    const detail = new ModuleDetail(page);
    await detail.goto("pos", mismatch.id);
    await detail.tab("PO vs Quotation");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("row").filter({ hasText: "Payment terms" })).toBeVisible(); // loaded
    await expect(panel.getByRole("row").filter({ has: page.getByRole("cell", { name: "Value", exact: true }) })).toContainText("Mismatch");
    await expect(panel.getByRole("row").filter({ has: page.getByRole("cell", { name: "Payment terms", exact: true }) })).toContainText("Match");
    await expect(panel.getByRole("row").filter({ has: page.getByRole("cell", { name: "Payment terms", exact: true }) })).not.toContainText("Mismatch");
    // Spec §15/§37: a flagged PO is reviewed before acceptance (D-79: it is accepted without a block or warning)
    const accepted = await commercial.action("pos", mismatch.id, "Accept PO");
    if (accepted.status === 201) expect((await poOf(commercial, mismatch.id)).status, "current: accepted despite the mismatch (remove with D-79)").toBe("Accepted");
    await knownDefect(test.info(), "D-79", async () => {
      expect(accepted.status, "accepting a PO flagged Mismatch").toBe(400);
    });
  });

  tc("TC-E2E-015", async ({ page }) => {
    const c = await base();
    const commercial = await apiAs("commercial");
    const quote = await build.sentQuotation(c.sales, { opportunityId: c.opp.id, accountId: c.account.id, productId: c.product.id });
    const po = await build.po(commercial, { opportunityId: c.opp.id, accountId: c.account.id, quotationId: quote.id });
    ok(await commercial.action("pos", po.id, "Start verification"), "start verification");
    ok(await commercial.action("pos", po.id, "Request clarification", { clar: "Please confirm the pit dimensions" }), "request clarification");
    expect(await poOf(commercial, po.id)).toMatchObject({ status: "Clarification required", clarification: "Please confirm the pit dimensions" });
    const detail = new ModuleDetail(page);
    await detail.goto("pos", po.id);
    expect(await detail.statusText()).toBe("Clarification required");
    // Spec (flow chart): Clarification required loops back to verification / accept once the customer has answered
    const restart = await commercial.action("pos", po.id, "Start verification");
    const accept = restart.status === 201 ? restart : await commercial.action("pos", po.id, "Accept PO");
    if (restart.status !== 201) {
      expect([restart.status, ApiClient.message(restart)], "current: Start verification is only allowed from Received (remove with D-136)").toEqual([400, "Cannot Start verification a purchase order in status 'Clarification required'."]);
      expect([accept.status, ApiClient.message(accept)], "current: Accept PO is refused (remove with D-136)").toEqual([400, "Cannot accept a purchase order in status 'Clarification required'."]);
      // and the page offers neither; only Reject leaves the state
      await detail.expectNoAction("Start verification");
      await detail.expectNoAction("Accept PO");
      await detail.expectAction("Reject");
      expect((await poOf(commercial, po.id)).status).toBe("Clarification required");
    }
    await knownDefect(test.info(), "D-136", async () => {
      expect([restart.status, accept.status], "a PO in Clarification required can go back to verification or be accepted").toEqual([201, 201]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
test.describe("E2E - Operations (journeys)", () => {
  test.use({ storageState: authFile("operations"), actionTimeout: 30_000 });

  tc("TC-E2E-010", async ({ page }) => {
    test.slow();
    const o = await newOrder();
    const operations = await apiAs("operations");
    await advanceTo(operations, o.id, "Installation");
    const serial = uniqueTag("E2E10SN");
    // no serial, no commissioning (server guard); nothing changes
    await expectActionRejected(operations, "sorders", o.id, "Advance status", {}, "'serial' is required to advance a sales order to Commissioned.");
    expect((await orderOf(operations, o.id)).status).toBe("Installation");
    expect(await assetsBySerial(serial)).toHaveLength(0);
    const before = Date.now();
    await commissionInUi(page, operations, o.id, serial);
    const assets = await assetsBySerial(serial);
    for (const a of assets) track("assets", a.id as string);
    expect(assets, "exactly one asset for the serial").toHaveLength(1);
    const asset = assets[0] as Rec;
    expect(asset).toMatchObject({ serial, status: "Under warranty", accountId: o.account.id, salesOrderId: o.id });
    for (const key of ["installedOn", "commissionedOn", "warrantyStart"]) expect(Math.abs(Date.parse(asset[key] as string) - before), key).toBeLessThan(10 * 60_000);
    expect(Math.abs(Date.parse(asset.warrantyEnd as string) - Date.parse(asset.warrantyStart as string) - 365 * DAY_MS), "warranty end = start + 1 year").toBeLessThanOrEqual(2 * DAY_MS);
    expect((await orderOf(operations, o.id)).status).toBe("Commissioned");
    // visible on the order's Installed assets tab
    const detail = new ModuleDetail(page);
    await detail.goto("sorders", o.id);
    await detail.tab("Installed assets");
    await expect(page.getByRole("tabpanel").getByText(serial)).toBeVisible();
  });

  tc("TC-E2E-014", async ({ page }) => {
    // GAP: Quality check -> Rework -> Production (flow chart). ORDER_FLOW is strictly linear.
    const o = await newOrder();
    const operations = await apiAs("operations");
    await advanceTo(operations, o.id, "Quality check");
    const detail = new ModuleDetail(page);
    await detail.goto("sorders", o.id);
    if ((await detail.statusText()) !== "Quality check") throw new Error("precondition: the order is at Quality check");
    // the spec-correct outcome (the only expect that may fail): a Rework action returns the order to Production
    await detail.expectAction("Rework");
    await detail.action("Rework");
    await expect.poll(() => detail.statusText()).toBe("Production");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
test.describe("E2E - Service Manager (journeys)", () => {
  test.use({ storageState: authFile("serviceManager"), actionTimeout: 30_000 });

  tc("TC-E2E-011", async () => {
    test.setTimeout(240_000);
    assertNoProviderCredentials(); // escalation e-mails are the reachable SES path
    const sweepMs = Number(readE2eEnv().SLA_DATE_SWEEP_MS);
    if (!(sweepMs <= 10_000)) throw new Error(`SLA_DATE_SWEEP_MS must be set to <= 10000 in backend/.env.e2e.local (found ${sweepMs})`);
    const a = await build.asset();
    const director = await apiAs("director");
    const sm = await apiAs("serviceManager");
    const countOf = async (tab: "opps" | "acts"): Promise<number> => ok(await director.get(`/modules/accounts/${a.account.id}/related/${tab}?limit=100`), `account ${tab}`).body.data?.length ?? 0;
    const [oppsBefore, actsBefore] = [await countOf("opps"), await countOf("acts")];
    const coverage = await build.coverage(sm, { assetId: a.assetId, accountId: a.account.id, endInDays: 60 }); // inside the 90-day window
    try {
      // positive signal that the sweep ran: SLA-21 'Renewal reminders' starts for the coverage
      const swept = await eventually(async () => (await slaTimerDetail(coverage.id)).find((t) => t.name === "Renewal reminders")?.open, (v) => v === true, 90_000);
      if (swept !== true) throw new Error("precondition: the date sweep did not start SLA-21 for a coverage ending in 60 days within 90 s");
      await sleep(sweepMs + 1_000);
      const cov = rec(await sm.get(`/modules/amc/${coverage.id}`), "read coverage");
      const [oppsAfter, actsAfter] = [await countOf("opps"), await countOf("acts")];
      // Spec: status Due soon plus a renewal task / opportunity created per rule (D-105: only the reminder timer starts)
      if (cov.status !== "Due soon") expect([cov.status, cov.renewalOpportunityId, oppsAfter - oppsBefore, actsAfter - actsBefore], "current: stays 'Not due', nothing created (remove with D-105)").toEqual(["Not due", null, 0, 0]);
      await knownDefect(test.info(), "D-105", async () => {
        expect(cov.status, "status inside the reminder window").toBe("Due soon");
        expect(cov.renewalOpportunityId !== null || oppsAfter > oppsBefore || actsAfter > actsBefore, "renewal task / opportunity created").toBe(true);
      });
    } finally {
      await archiveQuietly("amc", [coverage.id]);
      await archiveQuietly("assets", [a.assetId]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
test.describe("E2E - Director (journeys)", () => {
  test.use({ storageState: authFile("director"), actionTimeout: 30_000 });

  tc("TC-E2E-012", async ({ page }) => {
    const director = await apiAs("director");
    const sales = await apiAs("salesExec1");
    interface Team { kpis: { activePipeline: number; weightedPipeline: number } }
    interface Report { rows: { stage: string; count: number }[]; totals: { value: number; weighted: number } }
    const team = async (): Promise<Team> => ok(await director.get("/mfg-dashboard/team"), "team dashboard").body as unknown as Team;
    const report = async (): Promise<Report> => {
      const found = rows(await director.get("/modules/reports?search=Pipeline&limit=10"), "find report").find((r) => r.name === "Pipeline & weighted pipeline");
      if (!found) throw new Error("precondition: the 'Pipeline & weighted pipeline' report is seeded");
      return ok(await director.get(`/modules/reports/${found.id as string}/table/data`), "run report").body as unknown as Report;
    };
    const rupeeShort = (n: number): string => (n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : n >= 1_000 ? `₹${(n / 1_000).toFixed(1)}k` : `₹${n.toLocaleString("en-IN")}`);
    const [dashBefore, reportBefore] = [await team(), await report()];
    const opps: string[] = [];
    try {
      const account = await build.account(sales);
      opps.push((await build.opportunity(sales, account.id, { value: 1_234_000, stage: "Negotiation" })).id); // Negotiation = 60 %
      const [dash, rep] = [await team(), await report()];
      // same (default, org-wide, open-stage) filters: the dashboard and the report move by the same amounts and agree in absolute terms
      expect(dash.kpis.activePipeline - dashBefore.kpis.activePipeline, "dashboard active pipeline delta").toBe(1_234_000);
      expect(rep.totals.value - reportBefore.totals.value, "report total delta").toBe(1_234_000);
      expect(rep.totals.value, "Pipeline report total = Active pipeline KPI").toBe(dash.kpis.activePipeline);
      expect(Math.abs(rep.totals.weighted - dash.kpis.weightedPipeline), "report weighted total (rounded per stage) = Weighted pipeline KPI").toBeLessThanOrEqual(rep.rows.length);
      expect(dash.kpis.weightedPipeline - dashBefore.kpis.weightedPipeline, "weighted delta = 12,34,000 x 60 %").toBeCloseTo(740_400, 2);
      // on screen: the Team tile prints the same number
      await page.goto("/");
      await page.getByRole("button", { name: "Team", exact: true }).click();
      await expect(page.getByText("Conversion funnel", { exact: true })).toBeVisible();
      const tile = page.locator(".rounded-xl").filter({ has: page.getByText("Active pipeline", { exact: true }) }).first();
      await expect(tile).toContainText(rupeeShort(dash.kpis.activePipeline));
    } finally {
      await archiveQuietly("opps", opps);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
test.describe("E2E - Accounts (journeys)", () => {
  test.use({ storageState: authFile("accounts"), actionTimeout: 30_000 });

  tc("TC-E2E-016", async ({ page }) => {
    const accountsId = await userIdOf("accounts"); // payment milestones are own-record scoped (D-101): Accounts owns the PO so it can work them
    const o = await newOrder({ ownerId: accountsId });
    const accounts = await apiAs("accounts");
    const advance = (await milestonesOf(accounts, o.id)).find((m) => m.milestone === "Advance");
    if (!advance) throw new Error(`precondition: Advance milestone of order ${o.id}`);
    const id = advance.id as string;
    expect(advance).toMatchObject({ amount: 300_000, status: "Not due" });
    const statusOf = async (): Promise<string> => (await read("payments")(accounts, id)).status as string;
    const receiptAmounts = async (): Promise<number[]> => rows(await accounts.get(`/modules/payments/${id}/related/receipts`), "receipts").map((r) => r.amount as number).sort((x, y) => x - y);
    const detail = new ModuleDetail(page);
    // partial -> partial (the loop) -> remainder, the last one in the UI
    ok(await accounts.action("payments", id, "Record receipt", { amt: 100_000 }), "first part");
    expect(await statusOf()).toBe("Partially received");
    ok(await accounts.action("payments", id, "Record receipt", { amt: 100_000 }), "second part");
    expect(await statusOf(), "still open after a second part").toBe("Partially received");
    expect(await receiptAmounts()).toEqual([100_000, 100_000]);
    await detail.goto("payments", id);
    // intermediate state: still collectable, Rs 1,00,000 of the Rs 3,00,000 milestone is still due (the Balance field itself is blank: D-93)
    expect(await detail.statusText()).toBe("Partially received");
    await detail.expectAction("Record receipt");
    expect(300_000 - (await receiptAmounts()).reduce((x, y) => x + y, 0), "balance still due before the remainder").toBe(100_000);
    await detail.action("Record receipt");
    await detail.answerPrompt("100000");
    await expect.poll(statusOf, { message: "status after the remainder" }).toBe("Received");
    expect(await receiptAmounts()).toEqual([100_000, 100_000, 100_000]);
    expect(await detail.statusText()).toBe("Received");
    await detail.expectNoAction("Record receipt");
    // the other milestones of the order are untouched
    const others = (await milestonesOf(accounts, o.id)).filter((m) => m.id !== id);
    expect(others.map((m) => m.status)).toEqual(["Not due", "Not due"]);
  });
});
