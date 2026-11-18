// e2e/specs/mfg/so.spec.ts - Sales orders: handover, execution flow, commissioning (TC-SO-001..011): created-from-PO state, acknowledge, SLA timers,
// advance through the whole flow, serial rule, installed asset + warranty, boundary, dispatch action, milestone history, immutable references.
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { apiAs, ApiClient, build, isoDate, ok, TERMS, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { slaTimersOf } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";
import { inr, shortId } from "../../mfg/format";

type Rec = Record<string, unknown>;

const FLOW = ["Order accepted", "Design", "Procurement", "Production", "Quality check", "Ready for dispatch", "Dispatched", "Delivered", "Installation", "Commissioned", "Closed"];
const SLA16 = "Operations handover acknowledgement";
const SLA17 = "Delivery commitment risk";
const DAY_MS = 86_400_000;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
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
const timerOf = async (id: string, name: string): Promise<boolean | undefined> => (await slaTimersOf(id)).find((t) => t.name === name)?.open;

/** Account + opportunity (owned by salesExec1, product 'Weighbridge') + a Sent quotation. */
const base = async (productOver: Rec = {}) => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const product = await build.product(await apiAs("commercial"), productOver);
  const quote = await build.sentQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id });
  return { sales, account, opp, quote };
};
/** Sales order created by Accept PO (Commercial registers and accepts the PO, so Commercial owns the order unless `ownerId` is given). */
const newOrder = async (o: { paymentTerms?: string; value?: number; ownerId?: string } = {}) => {
  const c = await base();
  const commercial = await apiAs("commercial");
  const poId = rec(await commercial.post("/modules/pos", {
    poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: c.opp.id, quotationId: c.quote.id, accountId: c.account.id,
    value: o.value ?? 1_000_000, paymentTerms: o.paymentTerms ?? TERMS, ...(o.ownerId ? { ownerId: o.ownerId } : {}),
  }), "create PO").id as string;
  ok(await commercial.action("pos", poId, "Accept PO"), "accept PO");
  const operations = await apiAs("operations");
  const { id } = await build.salesOrderFor(operations, poId);
  return { c, poId, id, operations, commercial };
};
type Order = Awaited<ReturnType<typeof newOrder>>;
/** Order created straight through the sales-order endpoint (starts SLA-16 in the service, unlike Accept PO). */
const directOrder = async (accountId: string, over: Rec = {}): Promise<string> =>
  rec(await (await apiAs("director")).post("/modules/sorders", { accountId, value: 500_000, ...over }), "create sales order").id as string;
const orderOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/sorders/${id}`), "read sales order");
const eventsOf = async (api: ApiClient, id: string): Promise<{ label: string; at: string }[]> =>
  ok(await api.get(`/modules/sorders/${id}/events/milestones`), "milestone events").body as unknown as { label: string; at: string }[];
const advanceTo = async (api: ApiClient, id: string, target: string, serial?: string): Promise<void> => {
  const steps = FLOW.indexOf(target) - FLOW.indexOf(String((await orderOf(api, id)).status));
  for (let i = 0; i < steps; i += 1) ok(await api.action("sorders", id, "Advance status", serial ? { serial } : {}), "advance");
};
const openOrder = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("sorders", id);
  return detail;
};
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);
/**
 * Clicks Advance status on an order in Installation. Spec: the screen prompts for the serial (dialog 'Serial number required'). The prompt is triggered
 * by the error message containing 'serial', but the UI only sees axios's generic "Request failed with status code 400", so no dialog ever opens (D-90).
 * The wrapper records that; the step is then completed through the API so the rest of the flow can still be verified.
 */
const commissionInUi = async (page: Page, detail: ModuleDetail, api: ApiClient, id: string, serial: string): Promise<void> => {
  await detail.action("Advance status");
  const dialog = page.getByRole("dialog", { name: "Serial number required" });
  await knownDefect(test.info(), "D-90", async () => {
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await dialog.locator("#commission-serial").fill(serial);
    await dialog.getByRole("button", { name: "Advance", exact: true }).click();
  });
  expect((await orderOf(api, id)).status, "the click without a serial changed nothing").toBe("Installation");
  ok(await api.action("sorders", id, "Advance status", { serial }), "commission through the API");
  await page.reload();
  await expect(page.locator('[data-testid="status-step"][data-current="true"] span').last()).toHaveText("Commissioned");
};
const assetsBySerial = async (serial: string): Promise<Rec[]> => ok(await (await apiAs("director")).get(`/modules/assets?search=${encodeURIComponent(serial)}`), "find asset").body.data ?? [];

test.describe("Sales orders - Operations", () => {
  test.use({ storageState: authFile("operations") });

  tc("TC-SO-001", async ({ page }) => {
    const { c, poId, id, operations } = await newOrder();
    const order = await orderOf(operations, id);
    expect(order).toMatchObject({ status: "Order accepted", ackStatus: "Pending", purchaseOrderId: poId, accountId: c.account.id, value: 1_000_000 });
    const detail = await openOrder(page, id);
    expect(await detail.statusText()).toBe("Order accepted");
    await detail.tab("Handover");
    // Shown as the user reads them: the PO by its number, the account (not readable by Operations) by its short id, money formatted
    await expect(fieldValue(page, "Purchase order")).toHaveText(String(ok(await operations.get(`/modules/pos/${poId}`), "read PO").body.poNo));
    await expect(fieldValue(page, "Account")).toHaveText(shortId("A-", c.account.id));
    await expect(fieldValue(page, "Order value")).toHaveText(inr(1_000_000));
    // Spec: Handover status Pending is shown. The registry reads key `ack` but the record carries `ackStatus`, so the field renders blank.
    await knownDefect(test.info(), "D-83", async () => {
      await expect(fieldValue(page, "Operations acknowledgement")).toHaveText("Pending", { timeout: 1_000 });
    });
    // Spec: SLA-16 'Handover acknowledgement' is running. Accept PO creates the order straight through Prisma, so the service's SLA start never runs.
    await knownDefect(test.info(), "D-84", async () => {
      expect(await timerOf(id, SLA16), "SLA-16 timer of an order created by Accept PO").toBe(true);
    });
    // control: an order created through the sales-order service does start SLA-16 (not yet Met)
    const control = await directOrder(c.account.id);
    expect(await timerOf(control, SLA16), "SLA-16 of a directly created order").toBe(true);
    expect(((await orderOf(operations, control)).sla as { l: string } | null)?.l).not.toBe("Met");
  });

  tc("TC-SO-002", async ({ page }) => {
    const { c, id, operations } = await newOrder();
    const detail = await openOrder(page, id);
    await detail.action("Acknowledge handover");
    await expect.poll(async () => (await orderOf(operations, id)).ackStatus, { message: "ack status after clicking Acknowledge handover" }).toBe("Acknowledged");
    expect((await orderOf(operations, id)).status, "status unchanged").toBe("Order accepted");
    // UI: the handover field and the list column read `ack` (record key is `ackStatus`) and stay blank (D-83)
    await detail.tab("Handover");
    await expect(fieldValue(page, "Order value")).toBeVisible(); // loaded
    await knownDefect(test.info(), "D-83", async () => {
      await expect(fieldValue(page, "Operations acknowledgement")).toHaveText("Acknowledged", { timeout: 1_000 });
    });
    // SLA-16 stops on acknowledgement: proven on an order created through the service (the Accept PO order has no timer, D-84)
    const control = await directOrder(c.account.id);
    expect(await timerOf(control, SLA16)).toBe(true);
    ok(await operations.action("sorders", control, "Acknowledge handover"), "acknowledge control");
    expect(await timerOf(control, SLA16), "SLA-16 stopped").toBe(false);
    expect((await orderOf(operations, control)).ackStatus).toBe("Acknowledged");
    expect(((await orderOf(operations, control)).sla as { l: string }).l).toBe("Met");
    await knownDefect(test.info(), "D-84", async () => {
      expect(await timerOf(id, SLA16), "SLA-16 of the Accept PO order stopped (needs a timer first)").toBe(false);
    });
  });

  tc("TC-SO-003", async () => {
    // Escalation after the target is breach handling (Task 11b); here only that an unacknowledged order has a running SLA-16 timer to escalate.
    const { c, id, operations } = await newOrder();
    const control = await directOrder(c.account.id);
    expect(await timerOf(control, SLA16), "directly created order: SLA-16 running").toBe(true);
    expect((await orderOf(operations, control)).ackStatus).toBe("Pending");
    await knownDefect(test.info(), "D-84", async () => {
      expect(await timerOf(id, SLA16), "unacknowledged order created from a PO: SLA-16 running").toBe(true);
    });
  });

  tc("TC-SO-004", async ({ page }) => {
    test.setTimeout(240_000);
    const { id, operations } = await newOrder();
    // committed delivery in 3 days: the date sweep starts SLA-17, which must stop when the order is dispatched
    ok(await (await apiAs("director")).patch(`/modules/sorders/${id}`, { committedDelivery: isoDate(3) }), "set committed delivery");
    expect(await eventually(() => timerOf(id, SLA17), (v) => v === true, 40_000), "SLA-17 timer started by the sweep").toBe(true);
    const serial = uniqueTag("SN");
    const detail = await openOrder(page, id);
    expect(await detail.statusText()).toBe("Order accepted");
    for (const [i, label] of FLOW.slice(1).entries()) {
      if (label === "Commissioned") {
        await commissionInUi(page, detail, operations, id, serial);
      } else {
        await detail.action("Advance status");
      }
      await expect(page.locator('[data-testid="status-step"][data-current="true"] span').last()).toHaveText(label);
      expect((await orderOf(operations, id)).status).toBe(label);
      await detail.tab("Milestones");
      const items = page.getByRole("tabpanel").getByRole("listitem");
      await expect(items).toHaveCount(i + 1);
      await expect(items.last()).toContainText(label);
    }
    // the whole history in order, each with a valid timestamp
    const events = await eventsOf(operations, id);
    expect(events.map((e) => e.label)).toEqual(FLOW.slice(1));
    expect(events.every((e) => !Number.isNaN(Date.parse(e.at)))).toBe(true);
    expect(events.map((e) => Date.parse(e.at))).toEqual([...events.map((e) => Date.parse(e.at))].sort((a, b) => a - b));
    // Closed is the end of the flow: the button is gone
    await detail.expectNoAction("Advance status");
    // SLA-17 stopped when the order dispatched
    expect(await timerOf(id, SLA17), "SLA-17 stopped at Dispatched").toBe(false);
    expect(await assetsBySerial(serial), "installed asset created at Commissioned").toHaveLength(1);
  });

  tc("TC-SO-005", async ({ page }) => {
    const { id, operations } = await newOrder();
    await advanceTo(operations, id, "Installation");
    // API: blank / missing serial rejected, status unchanged
    await expectActionRejected(operations, "sorders", id, "Advance status", {}, "'serial' is required to advance a sales order to Commissioned.");
    await expectActionRejected(operations, "sorders", id, "Advance status", { serial: "" }, "'serial' is required to advance a sales order to Commissioned.");
    expect((await orderOf(operations, id)).status).toBe("Installation");
    // UI: the click prompts for the serial; the confirm button stays disabled while it is blank; cancelling leaves the order untouched
    const detail = await openOrder(page, id);
    expect(await detail.statusText()).toBe("Installation");
    await detail.action("Advance status");
    const dialog = page.getByRole("dialog", { name: "Serial number required" });
    // Spec: the click prompts for the serial and the confirm stays disabled while it is blank (the prompt never opens, D-90)
    await knownDefect(test.info(), "D-90", async () => {
      await expect(dialog).toBeVisible({ timeout: 3_000 });
      await expect(dialog.getByRole("button", { name: "Advance", exact: true })).toBeDisabled();
      await dialog.locator("#commission-serial").fill("   ");
      await expect(dialog.getByRole("button", { name: "Advance", exact: true })).toBeDisabled();
    });
    expect(await detail.statusText(), "UI state unchanged").toBe("Installation");
    expect((await orderOf(operations, id)).status).toBe("Installation");
    expect(ok(await operations.get(`/modules/sorders/${id}/related/assets`), "order assets").body.data, "no asset created for the order").toHaveLength(0);
    // a whitespace-only serial is blank too (the dialog agrees): the API accepts it and commissions with a blank serial
    const other = await newOrder();
    await advanceTo(other.operations, other.id, "Installation");
    const blank = await other.operations.action("sorders", other.id, "Advance status", { serial: "   " });
    try {
      if (blank.status !== 400) expect(blank.status, "current: accepted (remove with D-85)").toBe(201);
      await knownDefect(test.info(), "D-85", async () => {
        expect(blank.status, "whitespace-only serial").toBe(400);
      });
    } finally {
      // cleanup of the blank-serial asset (errors swallowed only here)
      try {
        const director = await apiAs("director");
        const assets = (await director.get(`/modules/sorders/${other.id}/related/assets`)).body.data ?? [];
        for (const asset of assets) await director.post(`/modules/assets/${asset.id as string}/archive`);
      } catch {
        // cleanup only
      }
    }
  });

  tc("TC-SO-006", async ({ page, browser }) => {
    // product warranty of 24 months on the quoted product; order in Installation; serial entered in the UI
    const c = await base({ warrantyMonths: 24 });
    const commercial = await apiAs("commercial");
    const po = await build.po(commercial, { opportunityId: c.opp.id, accountId: c.account.id, quotationId: c.quote.id });
    ok(await commercial.action("pos", po.id, "Accept PO"), "accept PO");
    const operations = await apiAs("operations");
    const { id } = await build.salesOrderFor(operations, po.id);
    await advanceTo(operations, id, "Installation");
    const serial = `WB-60-${uniqueTag("SN")}`;
    const before = Date.now();
    const detail = await openOrder(page, id);
    await commissionInUi(page, detail, operations, id, serial);
    const assets = await assetsBySerial(serial);
    expect(assets, "exactly one asset for the serial").toHaveLength(1);
    const asset = assets[0] as Rec;
    expect(asset).toMatchObject({ serial, status: "Under warranty", accountId: c.account.id, salesOrderId: id, model: "Weighbridge" });
    // installed / commissioned / warranty start = today, warranty end = +1 year (+-2 days)
    for (const key of ["installedOn", "commissionedOn", "warrantyStart"]) expect(Math.abs(Date.parse(asset[key] as string) - before), key).toBeLessThan(5 * 60_000);
    const yearMs = Date.parse(asset.warrantyEnd as string) - Date.parse(asset.warrantyStart as string);
    expect(Math.abs(yearMs - 365 * DAY_MS), "warranty end = start + 1 year").toBeLessThanOrEqual(2 * DAY_MS);
    // visible on the order's Installed assets tab and on Account -> Installed assets
    await detail.tab("Installed assets");
    await expect(page.getByRole("tabpanel").getByText(serial)).toBeVisible();
    // (Operations itself cannot open the account: accounts are own-record scoped although the role holds read access - D-91 - so the Director opens it)
    const opsRead = await operations.get(`/modules/accounts/${c.account.id}`);
    await knownDefect(test.info(), "D-91", async () => {
      expect(opsRead.status, "Operations reads the account of its order").toBe(200);
    });
    if (opsRead.status !== 200) expect(opsRead.status, ApiClient.message(opsRead)).toBe(404);
    const ctx = await browser.newContext({ storageState: authFile("director"), baseURL: "http://localhost:5174" });
    try {
      const dp = await ctx.newPage();
      const account = new ModuleDetail(dp);
      await account.goto("accounts", c.account.id);
      await account.tab("Installed assets");
      await expect(dp.getByRole("tabpanel").getByText(serial)).toBeVisible();
    } finally {
      await ctx.close();
    }
    // Spec §8/§39: the warranty period comes from the product (24 months here); the code always adds 1 year.
    await knownDefect(test.info(), "D-86", async () => {
      expect(Math.abs(yearMs - 730 * DAY_MS), "warranty end = start + the product's 24 months").toBeLessThanOrEqual(2 * DAY_MS);
    });
  });

  tc("TC-SO-007", async ({ page }) => {
    const { id, operations } = await newOrder();
    await advanceTo(operations, id, "Commissioned", uniqueTag("SN"));
    ok(await operations.action("sorders", id, "Advance status"), "advance to Closed");
    expect((await orderOf(operations, id)).status).toBe("Closed");
    const detail = await openOrder(page, id);
    expect(await detail.statusText()).toBe("Closed");
    await detail.expectNoAction("Advance status");
    await expectActionRejected(operations, "sorders", id, "Advance status", {}, "Cannot advance a sales order in status 'Closed'.");
    expect((await orderOf(operations, id)).status, "still Closed").toBe("Closed");
    expect((await eventsOf(operations, id)).map((e) => e.label), "no extra milestone").toEqual(FLOW.slice(1));
  });

  tc("TC-SO-008", async ({ page }) => {
    const { c, id, operations } = await newOrder();
    await advanceTo(operations, id, "Ready for dispatch");
    const detail = await openOrder(page, id);
    expect(await detail.statusText()).toBe("Ready for dispatch");
    await detail.action("Create dispatch");
    // the dispatch drawer opens prefilled with the order and the account
    const drawer = new ModuleDrawer(page);
    await expect(page.locator("#salesOrderId")).toHaveValue(id);
    await expect(page.locator("#accountId")).toHaveValue(c.account.id);
    await drawer.fill({ dispatchDate: new Date(Date.now() + DAY_MS).toISOString().slice(0, 10) });
    await drawer.save();
    // Spec: saving creates a Planned dispatch. Operations holds only read/update on dispatch (no create), so the server refuses with 403 and the drawer errors.
    await knownDefect(test.info(), "D-87", async () => {
      await expect(page).toHaveURL(/\/dispatch\/[0-9a-f-]{36}$/, { timeout: 8_000 });
    });
    if (!/\/dispatch\/[0-9a-f-]{36}$/.test(page.url())) await expect(drawer.error, "the drawer reports the failed save").toBeVisible();
    const direct = await operations.post("/modules/dispatch", { salesOrderId: id, accountId: c.account.id, dispatchDate: isoDate(1) });
    expect(direct.status, "Operations creating a dispatch").toBe(403);
    expect(ApiClient.message(direct)).toBe("Your role does not have 'create' access to 'dispatch'.");
    // the same dispatch saved by a role that may create it is a Planned dispatch of this order (and the order's Dispatches tab lists it)
    const created = rec(await (await apiAs("director")).post("/modules/dispatch", { salesOrderId: id, accountId: c.account.id, dispatchDate: isoDate(1) }), "create dispatch");
    expect(created).toMatchObject({ status: "Planned", salesOrderId: id, accountId: c.account.id });
    await page.goto(`/sales-orders/${id}`);
    await new ModuleDetail(page).tab("Dispatches");
    await expect(page.getByRole("tabpanel").getByRole("row").nth(1)).toContainText("Planned");
  });

  tc("TC-SO-010", async () => {
    // Committed delivery within 7 days and not dispatched -> the date sweep starts SLA-17 'Delivery commitment risk' (the alert itself is a breach case, Task 11b)
    const { id, operations } = await newOrder();
    const far = await newOrder();
    ok(await operations.patch(`/modules/sorders/${id}`, { committedDelivery: isoDate(5) }), "set committed delivery (+5d)");
    ok(await operations.patch(`/modules/sorders/${far.id}`, { committedDelivery: isoDate(30) }), "set committed delivery (+30d)");
    // SLA date sweeps run every SLA_DATE_SWEEP_MS=5000 (backend/.env.e2e.local), hence the 40 s polling window
    expect(await eventually(() => timerOf(id, SLA17), (v) => v === true, 40_000), "SLA-17 timer for a delivery due in 5 days").toBe(true);
    expect(((await orderOf(operations, id)).sla as { l: string } | null)?.l, "order shows a running timer").not.toBe("Met");
    // control: delivery in 30 days is outside the 7-day window (the sweep that started the first timer has also covered this order)
    await sleep(6_000); // one more sweep cycle (SLA_DATE_SWEEP_MS=5000 in backend/.env.e2e.local)
    expect(await timerOf(far.id, SLA17), "no SLA-17 timer for a delivery due in 30 days").toBeUndefined();
    // dispatching stops it
    await advanceTo(operations, id, "Dispatched");
    expect(await timerOf(id, SLA17), "SLA-17 stopped on dispatch").toBe(false);
  });

  tc("TC-SO-011", async ({ page }) => {
    const { poId, id, operations } = await newOrder({ value: 750_000 });
    const detail = await openOrder(page, id);
    await detail.tab("Handover");
    // PO reference and value are shown on the handover tab
    await expect(fieldValue(page, "Purchase order")).toHaveText(String(ok(await operations.get(`/modules/pos/${poId}`), "read PO").body.poNo));
    await expect(fieldValue(page, "Order value")).toHaveText(inr(750_000));
    await expect(fieldValue(page, "Payment terms")).toHaveText(TERMS);
    // Spec §16: references are immutable for normal users. Operations (update right) can re-point the order to another PO and change its value.
    const other = await newOrder();
    const repoint = await operations.patch(`/modules/sorders/${id}`, { purchaseOrderId: other.poId, value: 1 });
    if (repoint.status < 400) expect(repoint.status, "current: the edit is accepted (remove with D-88)").toBe(200);
    await knownDefect(test.info(), "D-88", async () => {
      expect(repoint.status, "re-pointing the PO reference as Operations").toBeGreaterThanOrEqual(400);
    });
    await knownDefect(test.info(), "D-88", async () => {
      expect(await orderOf(operations, id), "order after the attempted edit").toMatchObject({ purchaseOrderId: poId, value: 750_000 });
    });
  });
});

test.describe("Sales orders - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-SO-009", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    // the typical chain: Commercial registers + accepts the PO, so Commercial owns the order and the Sales Executive's own deal is invisible to them
    const typical = await newOrder();
    await advanceTo(typical.operations, typical.id, "Procurement");
    const hidden = await sales.get(`/modules/sorders/${typical.id}/events/milestones`);
    // an order owned by the Sales Executive (PO registered with them as owner) with several milestones
    const mine = await newOrder({ ownerId: await userIdOf("salesExec1") });
    await advanceTo(mine.operations, mine.id, "Procurement");
    const expected = ["Design", "Procurement"];
    const events = await eventsOf(sales, mine.id);
    expect(events.map((e) => e.label)).toEqual(expected);
    expect(events.every((e) => !Number.isNaN(Date.parse(e.at)))).toBe(true);
    const detail = await openOrder(page, mine.id);
    await detail.tab("Milestones");
    const items = page.getByRole("tabpanel").getByRole("listitem");
    await expect(items).toHaveCount(expected.length);
    for (const [i, label] of expected.entries()) await expect(items.nth(i)).toContainText(label);
    // read-only: the server refuses every change from this role
    const advance = await sales.action("sorders", mine.id, "Advance status");
    expect(advance.status).toBe(403);
    expect(ApiClient.message(advance)).toBe("Your role does not have 'update' access to 'sorders'.");
    expect((await orderOf(await apiAs("operations"), mine.id)).status, "unchanged").toBe("Procurement");
    // ... and the screen offers no change controls to a read-only role
    await knownDefect(test.info(), "D-89", async () => {
      await detail.expectNoAction("Advance status");
    });
    // The Sales Executive who owns the opportunity cannot open the order created for it (own-record scope on the order owner, cf. D-32).
    await knownDefect(test.info(), "D-32", async () => {
      expect(hidden.status, "Sales Executive reads the order of their own opportunity").toBe(200);
    });
    if (hidden.status !== 200) expect(hidden.status, ApiClient.message(hidden)).toBe(404);
  });
});
