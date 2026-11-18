// e2e/specs/mfg/dsp.spec.ts - Dispatch (TC-DSP-001..007): create with transport details, Planned -> Dispatched -> In transit -> Delivered (SLA-18),
// the 'actual' date rule, invalid transitions, partial dispatches per order, salesperson notification, read-only Sales Executive.
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { apiAs, ApiClient, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { slaTimersOf } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const SLA18 = "Delivery confirmation";
const DETAIL_RE = /\/dispatch\/[0-9a-f-]{36}$/;
const TODAY = (): string => new Date().toISOString().slice(0, 10);
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
const timerOf = async (id: string, name: string): Promise<boolean | undefined> => (await slaTimersOf(id)).find((t) => t.name === name)?.open;

/** Sales order created by Accept PO (Commercial registers + accepts; `ownerId` makes someone else the owner of PO, order and milestones). */
const newOrder = async (ownerId?: string) => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const product = await build.product(await apiAs("commercial"));
  const quote = await build.sentQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id });
  const commercial = await apiAs("commercial");
  const poId = rec(await commercial.post("/modules/pos", {
    poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: opp.id, quotationId: quote.id, accountId: account.id,
    value: 1_000_000, paymentTerms: "100% advance", ...(ownerId ? { ownerId } : {}),
  }), "create PO").id as string;
  ok(await commercial.action("pos", poId, "Accept PO"), "accept PO");
  const { id } = await build.salesOrderFor(await apiAs("operations"), poId);
  return { account, opp, id };
};
type Order = Awaited<ReturnType<typeof newOrder>>;
/** Dispatch created by Sales Head (CRUE on dispatch; Operations holds only read/update, D-87). */
const newDispatch = async (o: Order, over: Rec = {}): Promise<string> =>
  rec(await (await apiAs("salesHead")).post("/modules/dispatch", { salesOrderId: o.id, accountId: o.account.id, dispatchDate: isoDate(1), ...over }), "create dispatch").id as string;
const dispatchOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/dispatch/${id}`), "read dispatch");
const archiveQuietly = async (ids: string[]): Promise<void> => {
  const director = await apiAs("director");
  for (const id of ids) {
    try {
      await director.post(`/modules/dispatch/${id}/archive`);
    } catch {
      // cleanup only
    }
  }
};
const openDispatch = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("dispatch", id);
  return detail;
};
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);

test.describe("Dispatch - Operations", () => {
  test.use({ storageState: authFile("operations") });

  tc("TC-DSP-001", async ({ browser }) => {
    const order = await newOrder();
    const created: string[] = [];
    try {
      // Operations (read/update on dispatch) cannot create one: the drawer opened from the order saves nothing (D-87).
      const operations = await apiAs("operations");
      const body = { salesOrderId: order.id, accountId: order.account.id, dispatchDate: isoDate(1) };
      const refused = await operations.post("/modules/dispatch", body);
      expect(refused.status, "Operations creating a dispatch").toBe(403);
      expect(ApiClient.message(refused)).toBe("Your role does not have 'create' access to 'dispatch'.");
      await knownDefect(test.info(), "D-87", async () => {
        expect(refused.status, "Operations creates a dispatch (spec: Operations role)").toBe(201);
      });
      // The same drawer flow as a role that may create (Sales Head): all transport details are saved on a Planned dispatch.
      const ctx = await browser.newContext({ storageState: authFile("salesHead"), baseURL: test.info().project.use.baseURL });
      try {
        const page = await ctx.newPage();
        const detailOfOrder = new ModuleDetail(page);
        await detailOfOrder.goto("sorders", order.id);
        await detailOfOrder.action("Create dispatch");
        await expect(page.locator("#salesOrderId")).toHaveValue(order.id);
        await expect(page.locator("#accountId")).toHaveValue(order.account.id);
        const tag = uniqueTag("DSPUI");
        const values = {
          invoiceNo: `INV-${tag}`, invoiceDate: dateInput(0), dispatchDate: dateInput(1), transporter: `${tag} Roadways`, lrNumber: `LR-${tag}`,
          vehicleNo: `MH12${tag.slice(-4)}`, ewayBill: `EW-${tag}`, expectedDelivery: dateInput(5),
        };
        await new ModuleDrawer(page).fill(values);
        await new ModuleDrawer(page).save();
        await expect(page).toHaveURL(DETAIL_RE, { timeout: 10_000 });
        const id = page.url().split("/").at(-1) ?? "";
        created.push(id);
        const record = await dispatchOf(await apiAs("operations"), id);
        expect(record).toMatchObject({
          status: "Planned", salesOrderId: order.id, accountId: order.account.id, invoiceNo: values.invoiceNo, transporter: values.transporter,
          lrNumber: values.lrNumber, vehicleNo: values.vehicleNo, ewayBill: values.ewayBill,
        });
        expect(String(record.dispatchDate).slice(0, 10)).toBe(values.dispatchDate);
        expect(String(record.invoiceDate).slice(0, 10)).toBe(values.invoiceDate);
        expect(String(record.expectedDelivery).slice(0, 10)).toBe(values.expectedDelivery);
        expect(record.actualDelivery ?? null, "no actual delivery yet").toBeNull();
        // the saved detail shows the transport details and the Planned status
        const detail = new ModuleDetail(page);
        expect(await detail.statusText()).toBe("Planned");
        await expect(fieldValue(page, "Transporter")).toHaveText(values.transporter);
        await expect(fieldValue(page, "LR / AWB")).toHaveText(values.lrNumber);
        await expect(fieldValue(page, "Vehicle no.")).toHaveText(values.vehicleNo);
        await expect(fieldValue(page, "E-way bill")).toHaveText(values.ewayBill);
        await expect(fieldValue(page, "Invoice no.")).toHaveText(values.invoiceNo);
        // no SLA-18 timer until the shipment actually leaves
        expect(await timerOf(id, SLA18), "SLA-18 not started for a Planned dispatch").toBeUndefined();
      } finally {
        await ctx.close();
      }
    } finally {
      await archiveQuietly(created);
    }
  });

  tc("TC-DSP-002", async ({ page }) => {
    const order = await newOrder();
    const id = await newDispatch(order);
    const operations = await apiAs("operations");
    try {
      const detail = await openDispatch(page, id);
      expect(await detail.statusText()).toBe("Planned");
      await detail.expectNoAction("In transit");
      await detail.expectNoAction("Mark delivered");
      // Planned -> Dispatched: SLA-18 starts
      await detail.action("Mark dispatched");
      await expect(page.getByTestId("status-badge")).toHaveText("Dispatched");
      expect((await dispatchOf(operations, id)).status).toBe("Dispatched");
      expect(await timerOf(id, SLA18), "SLA-18 started by Mark dispatched").toBe(true);
      expect((await dispatchOf(operations, id)).sla, "record carries the running timer").not.toBeNull();
      // Dispatched -> In transit: timer keeps running
      await detail.action("In transit");
      await expect(page.getByTestId("status-badge")).toHaveText("In transit");
      expect((await dispatchOf(operations, id)).status).toBe("In transit");
      expect(await timerOf(id, SLA18), "SLA-18 still running in transit").toBe(true);
      // In transit -> Delivered with the actual delivery date: stored, SLA-18 stops
      await detail.action("Mark delivered");
      await detail.answerPrompt(TODAY());
      await expect(page.getByTestId("status-badge")).toHaveText("Delivered");
      const done = await dispatchOf(operations, id);
      expect(done.status).toBe("Delivered");
      expect(String(done.actualDelivery).slice(0, 10), "actual delivery date stored").toBe(TODAY());
      expect(await timerOf(id, SLA18), "SLA-18 stopped by Mark delivered").toBe(false);
      expect((done.sla as { l: string }).l, "timer shows Met").toBe("Met");
      // the flow is finished: no transition button is offered
      for (const label of ["Mark dispatched", "In transit", "Mark delivered"]) await detail.expectNoAction(label);
    } finally {
      await archiveQuietly([id]);
    }
  });

  tc("TC-DSP-003", async ({ page }) => {
    const order = await newOrder();
    const id = await newDispatch(order);
    const operations = await apiAs("operations");
    try {
      ok(await operations.action("dispatch", id, "Mark dispatched"), "mark dispatched");
      ok(await operations.action("dispatch", id, "In transit"), "in transit");
      // API: missing / blank date rejected, nothing changes
      await expectActionRejected(operations, "dispatch", id, "Mark delivered", {}, "'actual' is required to Mark delivered.");
      await expectActionRejected(operations, "dispatch", id, "Mark delivered", { actual: "" }, "'actual' is required to Mark delivered.");
      // UI: the prompt cannot be confirmed without a date; cancelling leaves the dispatch untouched
      const detail = await openDispatch(page, id);
      expect(await detail.statusText()).toBe("In transit");
      await detail.action("Mark delivered");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
      await page.locator("#action-ask-field").fill("   ");
      await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(await detail.statusText(), "UI state unchanged").toBe("In transit");
      const after = await dispatchOf(operations, id);
      expect(after.status).toBe("In transit");
      expect(after.actualDelivery ?? null, "no actual delivery stored").toBeNull();
      expect(await timerOf(id, SLA18), "SLA-18 still running").toBe(true);
    } finally {
      await archiveQuietly([id]);
    }
  });

  tc("TC-DSP-004", async ({ page }) => {
    const order = await newOrder();
    const id = await newDispatch(order);
    const operations = await apiAs("operations");
    try {
      await expectActionRejected(operations, "dispatch", id, "In transit", {}, "Cannot In transit a dispatch in status 'Planned'.");
      await expectActionRejected(operations, "dispatch", id, "Mark delivered", { actual: TODAY() }, "Cannot Mark delivered a dispatch in status 'Planned'.");
      // UI: only Mark dispatched is offered for a Planned dispatch (positive signal first: the loaded status and the offered button)
      const detail = await openDispatch(page, id);
      expect(await detail.statusText()).toBe("Planned");
      await detail.expectAction("Mark dispatched");
      await detail.expectNoAction("In transit");
      await detail.expectNoAction("Mark delivered");
      const record = await dispatchOf(operations, id);
      expect(record.status, "status unchanged").toBe("Planned");
      expect(record.actualDelivery ?? null).toBeNull();
      // control: the valid next step still works
      ok(await operations.action("dispatch", id, "Mark dispatched"), "mark dispatched");
      expect((await dispatchOf(operations, id)).status).toBe("Dispatched");
    } finally {
      await archiveQuietly([id]);
    }
  });

  tc("TC-DSP-005", async ({ page }) => {
    const order = await newOrder();
    const other = await newOrder();
    const operations = await apiAs("operations");
    const tag = uniqueTag("PART");
    const created: string[] = [];
    try {
      const first = await newDispatch(order, { invoiceNo: `${tag}-A`, qty: "1", partial: true });
      const second = await newDispatch(order, { invoiceNo: `${tag}-B`, qty: "1", partial: true });
      const control = await newDispatch(other, { invoiceNo: `${tag}-C` });
      created.push(first, second, control);
      ok(await operations.action("dispatch", first, "Mark dispatched"), "dispatch the first");
      // each dispatch has its own status and invoice
      expect(await dispatchOf(operations, first)).toMatchObject({ status: "Dispatched", invoiceNo: `${tag}-A`, salesOrderId: order.id, partial: true });
      expect(await dispatchOf(operations, second)).toMatchObject({ status: "Planned", invoiceNo: `${tag}-B`, salesOrderId: order.id, partial: true });
      // the order's related list: exactly its two dispatches, not the other order's
      const related = ok(await operations.get(`/modules/sorders/${order.id}/related/dispatch`), "order dispatches").body.data ?? [];
      expect(related.map((d) => d.id as string).sort()).toEqual([first, second].sort());
      // UI: both rows on the Dispatches tab with their invoice and status; the control row is absent
      await page.goto(`/sales-orders/${order.id}`);
      const detail = new ModuleDetail(page);
      await detail.tab("Dispatches");
      const panel = page.getByRole("tabpanel");
      const rowA = panel.getByRole("row").filter({ hasText: `${tag}-A` });
      const rowB = panel.getByRole("row").filter({ hasText: `${tag}-B` });
      await expect(rowA).toHaveCount(1);
      await expect(rowB).toHaveCount(1);
      await expect(rowA).toContainText("Dispatched");
      await expect(rowB).toContainText("Planned");
      await expect(panel.getByRole("row").filter({ hasText: `${tag}-C` })).toHaveCount(0);
      // the other order lists only its own dispatch
      const otherRelated = ok(await operations.get(`/modules/sorders/${other.id}/related/dispatch`), "other order dispatches").body.data ?? [];
      expect(otherRelated.map((d) => d.id as string)).toEqual([control]);
    } finally {
      await archiveQuietly(created);
    }
  });
});

test.describe("Dispatch - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-DSP-006", async () => {
    // The salesperson owns the order (PO registered with them as owner); a dispatch is created for it.
    const salesId = await userIdOf("salesExec1");
    const order = await newOrder(salesId);
    const tag = uniqueTag("NTF");
    const id = await newDispatch(order, { invoiceNo: tag });
    try {
      const sales = await apiAs("salesExec1");
      const mentions = async (): Promise<boolean> => {
        const inbox = ok(await sales.get("/notifications"), "read notifications").body as unknown as { data?: { title: string; body: string; link: string | null }[] };
        return (inbox.data ?? []).some((n) => `${n.title} ${n.body} ${n.link ?? ""}`.includes(id) || `${n.title} ${n.body}`.includes(tag));
      };
      // the inbox endpoint answered (positive signal); give an asynchronous notification a moment to land
      await sleep(2_000);
      // positive control: the inbox read works and returns a list. (Only SLA escalations ever create notifications, so a guaranteed notification for this user cannot be produced cheaply.)
      const inbox = ok(await sales.get("/notifications"), "read notifications").body as unknown as { data?: unknown };
      expect(Array.isArray(inbox.data), "notification inbox returned a list").toBe(true);
      const seen = await mentions();
      // Spec §17: the salesperson is notified when a dispatch is created. Current: no notification (SLA escalations are the only producer).
      await knownDefect(test.info(), "D-92", async () => {
        expect(seen, "Sales Executive notified of the new dispatch").toBe(true);
      });
      // the salesperson can at least see the dispatch (read access)
      expect((await dispatchOf(sales, id)).status).toBe("Planned");
    } finally {
      await archiveQuietly([id]);
    }
  });

  tc("TC-DSP-007", async ({ page }) => {
    const order = await newOrder();
    const id = await newDispatch(order, { transporter: "Read Only Roadways" });
    const sales = await apiAs("salesExec1");
    try {
      // read access: the list API and the detail show the record
      expect(await dispatchOf(sales, id)).toMatchObject({ status: "Planned", transporter: "Read Only Roadways" });
      const detail = await openDispatch(page, id);
      expect(await detail.statusText()).toBe("Planned");
      await expect(fieldValue(page, "Transporter")).toHaveText("Read Only Roadways");
      // every write is refused by the server (exact message) and nothing changes
      const forbidden = "Your role does not have 'update' access to 'dispatch'.";
      const move = await sales.action("dispatch", id, "Mark dispatched");
      expect(move.status).toBe(403);
      expect(ApiClient.message(move)).toBe(forbidden);
      const edit = await sales.patch(`/modules/dispatch/${id}`, { transporter: "Changed" });
      expect(edit.status).toBe(403);
      expect(ApiClient.message(edit)).toBe(forbidden);
      const create = await sales.post("/modules/dispatch", { salesOrderId: order.id, accountId: order.account.id, dispatchDate: isoDate(1) });
      expect(create.status).toBe(403);
      expect(ApiClient.message(create)).toBe("Your role does not have 'create' access to 'dispatch'.");
      const record = await dispatchOf(await apiAs("operations"), id);
      expect(record).toMatchObject({ status: "Planned", transporter: "Read Only Roadways" });
      expect(await timerOf(id, SLA18), "no SLA-18 timer started by the refused action").toBeUndefined();
      // Spec: action buttons hidden for a read-only role. The screen offers them anyway (same defect as sales orders, D-89).
      await knownDefect(test.info(), "D-89", async () => {
        await detail.expectNoAction("Mark dispatched");
      });
    } finally {
      await archiveQuietly([id]);
    }
  });
});
