// e2e/specs/mfg/po.spec.ts - Purchase orders & acceptance (TC-PO-001..014): create, verification flow, PO vs quotation compare, accept cascade
// (Won + sales order + payment milestones), terms parser, status guards, atomicity, notification, org / role scope.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, TERMS, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { slaTimersOf } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const DETAIL_RE = /\/purchase-orders\/[0-9a-f-]{36}$/;
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/** Account + opportunity (owned by salesExec1) + a Sent quotation for one line of 10,00,000 (qty 1). */
const base = async () => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const product = await build.product(await apiAs("commercial"));
  const quote = await build.sentQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id });
  return { sales, account, opp, quote };
};
type Ctx = Awaited<ReturnType<typeof base>>;
const poOpts = (c: Ctx, over: { value?: number; paymentTerms?: string } = {}) => ({ opportunityId: c.opp.id, accountId: c.account.id, quotationId: c.quote.id, ...over });
/** Fresh PO (status Received) created by Commercial. */
const newPo = async (over: { value?: number; paymentTerms?: string } = {}) => {
  const c = await base();
  const commercial = await apiAs("commercial");
  const po = await build.po(commercial, poOpts(c, over));
  return { c, commercial, id: po.id };
};
const poOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/pos/${id}`), "read PO");
const stageOf = async (accountId: string, oppId: string): Promise<string> => {
  const r = rec(await (await apiAs("director")).get(`/modules/opps/${oppId}`), "read opportunity");
  expect(r.accountId).toBe(accountId);
  return r.stage as string;
};
/** Sales orders / payment milestones created for a PO: server-side filters (accountId of the PO, salesOrderId), read as Director (whole org), then matched exactly client-side. */
const ordersOf = async (poId: string): Promise<Rec[]> => {
  const director = await apiAs("director");
  const { accountId } = rec(await director.get(`/modules/pos/${poId}`), "read PO");
  return (ok(await director.get(`/modules/sorders?accountId=${accountId as string}&limit=100`), "list sales orders").body.data ?? []).filter((o) => o.purchaseOrderId === poId);
};
const milestonesOf = async (orderId: string): Promise<Rec[]> =>
  (ok(await (await apiAs("director")).get(`/modules/payments?salesOrderId=${orderId}&limit=100`), "list payment milestones").body.data ?? [])
    .filter((m) => m.salesOrderId === orderId)
    .sort((a, b) => (a.amount as number) - (b.amount as number));
/** Best-effort cleanup of throwaway records: errors are swallowed only here. */
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
const historyOf = async (oppId: string): Promise<string[]> =>
  ((await (await apiAs("director")).get(`/modules/opps/${oppId}/events/history`)).body as unknown as { label: string }[]).map((e) => e.label);
const acceptAndOrder = async (poId: string) => {
  const commercial = await apiAs("commercial");
  ok(await commercial.action("pos", poId, "Accept PO"), "accept PO");
  const orders = await ordersOf(poId);
  expect(orders, "one sales order per accepted PO").toHaveLength(1);
  const order = orders[0] as Rec;
  return { order, milestones: await milestonesOf(order.id as string) };
};
const compareRows = async (api: ApiClient, id: string): Promise<Record<string, Rec>> => {
  const t = rec(await api.get(`/modules/pos/${id}/table/compare`), "compare table") as { rows?: Rec[] };
  return Object.fromEntries((t.rows ?? []).map((r) => [r.check as string, r]));
};
const openDetail = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("pos", id);
  return detail;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const slaOpen = async (id: string, name = "PO verification"): Promise<boolean | undefined> => (await slaTimersOf(id)).find((t) => t.name === name)?.open;

test.describe("Purchase orders - Commercial", () => {
  test.use({ storageState: authFile("commercial") });

  tc("TC-PO-001", async ({ page }) => {
    test.slow(); // cold stack
    const c = await base();
    const commercial = await apiAs("commercial");
    const poNo = uniqueTag("PO");
    const fields = {
      poNo, poDate: dateInput(0), opportunityId: c.opp.id, quotationId: c.quote.id, accountId: c.account.id, value: 1_000_000,
      deliveryDate: dateInput(45), paymentTerms: TERMS,
    };
    const list = new ModuleList(page, "pos");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    await drawer.fill(fields); // Opportunity / Quotation / Account are raw-UUID text boxes (D-31 pattern)
    await drawer.save();
    await expect(drawer.error.or(page.getByRole("button", { name: "More actions", exact: true }))).toBeVisible({ timeout: 15_000 });
    // Spec: the PO is saved from the form. The money field is posted as a string and the API rejects it (D-6).
    await expect(page).toHaveURL(DETAIL_RE, { timeout: 1_000 });
    let id: string;
    if (DETAIL_RE.test(page.url())) {
      id = idFromUrl(page);
    } else {
      await expect(drawer.error).toHaveText("Couldn't save — please try again.");
      id = rec(await commercial.post("/modules/pos", { ...fields, poDate: isoDate(0), deliveryDate: isoDate(45) }), "create the same PO through the API").id as string;
    }
    const po = await poOf(commercial, id);
    expect(po).toMatchObject({ status: "Received", poNo, value: 1_000_000, opportunityId: c.opp.id, quotationId: c.quote.id, accountId: c.account.id, paymentTerms: TERMS });
    // SLA-15 'PO verification' is running (not yet Met) and the 2-business-day timer exists
    expect(po.sla, "SLA-15 timer exists").not.toBeNull();
    expect((po.sla as { l: string }).l).not.toBe("Met");
    expect(await slaOpen(id), "SLA-15 PO verification timer is open").toBe(true);
    // listed (search is by PO number) and the detail shows the Received status with the verification actions
    await list.goto();
    await list.search(poNo);
    await expect(list.row("Received")).toBeVisible();
    const detail = await openDetail(page, id);
    expect(await detail.statusText()).toBe("Received");
    await detail.expectAction("Start verification");
    await detail.expectAction("Accept PO");
  });

  tc("TC-PO-002", async ({ page }) => {
    const { commercial, id } = await newPo();
    const detail = await openDetail(page, id);
    expect(await detail.statusText()).toBe("Received");
    await detail.action("Start verification");
    await detail.expectAction("Request clarification"); // reloaded in Under verification
    expect(await detail.statusText()).toBe("Under verification");
    expect((await poOf(commercial, id)).status).toBe("Under verification");
    await detail.expectNoAction("Start verification");
    // only from Received: a second start is refused and the status is unchanged
    await expectActionRejected(commercial, "pos", id, "Start verification", {}, "Cannot Start verification a purchase order in status 'Under verification'.");
    expect((await poOf(commercial, id)).status).toBe("Under verification");
    // not from the other statuses either (Accepted)
    const accepted = await newPo();
    ok(await accepted.commercial.action("pos", accepted.id, "Accept PO"), "accept");
    await expectActionRejected(accepted.commercial, "pos", accepted.id, "Start verification", {}, "Cannot Start verification a purchase order in status 'Accepted'.");
  });

  tc("TC-PO-003", async ({ page }) => {
    // PO value 8,00,000 vs quotation line total 10,00,000; payment terms differ from the quotation's
    const c = await base();
    const commercial = await apiAs("commercial");
    const po = await build.po(commercial, poOpts(c, { value: 800_000, paymentTerms: "50% advance, 50% before dispatch" }));
    // control PO: same value and same terms as the quotation
    const control = await build.po(commercial, poOpts(c, { value: 1_000_000 }));
    const rows = await compareRows(commercial, po.id);
    expect(Object.keys(rows)).toEqual(["Value", "Quantity", "Delivery", "Payment terms", "Products"]);
    expect(rows.Value).toMatchObject({ quotation: 1_000_000, po: 800_000, result: "Mismatch" });
    expect(rows["Payment terms"]).toMatchObject({ quotation: TERMS, po: "50% advance, 50% before dispatch", result: "Mismatch" });
    expect(rows.Delivery?.result, "no delivery on either side").toBe("Match");
    const controlRows = await compareRows(commercial, control.id);
    expect(controlRows.Value?.result).toBe("Match");
    expect(controlRows["Payment terms"]?.result).toBe("Match");

    const detail = await openDetail(page, po.id);
    await detail.tab("PO vs Quotation");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("row").filter({ hasText: "Payment terms" })).toBeVisible(); // loaded
    const resultOf = (check: string) => panel.getByRole("row").filter({ has: page.getByRole("cell", { name: check, exact: true }) });
    await expect(resultOf("Value")).toContainText("Mismatch");
    await expect(resultOf("Payment terms")).toContainText("Mismatch");
    await expect(resultOf("Delivery")).toContainText("Match");
    await expect(resultOf("Delivery")).not.toContainText("Mismatch");
    for (const check of ["Value", "Quantity", "Delivery", "Payment terms", "Products"]) await expect(resultOf(check)).toHaveCount(1);
    // Quantity and Products always show n/a (the PO stores no quantity or products). Spec: qty, price, tax and specifications are compared.
    await knownDefect(test.info(), "D-78", async () => {
      expect(rows.Quantity?.result, "Quantity row").not.toBe("n/a");
      expect(rows.Products?.result, "Products row").not.toBe("n/a");
    });
    expect([rows.Quantity?.result, rows.Products?.result], "current: both rows are n/a (remove with D-78)").toEqual(["n/a", "n/a"]);
  });

  tc("TC-PO-004", async ({ page }) => {
    // A Rs 1 PO against a Rs 10 L quotation: flagged in the compare table, accepted without any block or warning
    const c = await base();
    const commercial = await apiAs("commercial");
    const po = await build.po(commercial, poOpts(c, { value: 1 }));
    const rows = await compareRows(commercial, po.id);
    expect(rows.Value?.result).toBe("Mismatch");
    const detail = await openDetail(page, po.id);
    await detail.tab("PO vs Quotation");
    await expect(page.getByRole("tabpanel").getByRole("row").filter({ hasText: "Value" }).first()).toContainText("Mismatch");
    await detail.action("Accept PO");
    await expect(page.getByTestId("status-badge")).toContainText("Accepted");
    expect((await poOf(commercial, po.id)).status).toBe("Accepted");
    expect(await ordersOf(po.id), "the mismatching PO created a sales order").toHaveLength(1);
    expect(await stageOf(c.account.id, c.opp.id)).toBe("Won");
    // Spec §15/§37: a material mismatch must be reviewed before acceptance (blocked or at least warned). Neither the API (no 4xx, no warning in the
    // response) nor the UI (no confirmation dialog) does so.
    const second = await newPo({ value: 1 });
    const accepted = await second.commercial.action("pos", second.id, "Accept PO");
    expect(accepted.status, "current: the mismatching PO is accepted (remove with D-79)").toBe(201);
    await knownDefect(test.info(), "D-79", async () => {
      expect(accepted.status, "accepting a mismatching PO").toBe(400);
    });
  });

  tc("TC-PO-005", async ({ page }) => {
    const { commercial, id } = await newPo();
    // not allowed from Received
    await expectActionRejected(commercial, "pos", id, "Request clarification", { clar: "Need drawing" }, "Cannot Request clarification a purchase order in status 'Received'.");
    ok(await commercial.action("pos", id, "Start verification"), "start verification");
    // blank note rejected, status unchanged
    await expectActionRejected(commercial, "pos", id, "Request clarification", {}, "'clar' is required to Request clarification.");
    await expectActionRejected(commercial, "pos", id, "Request clarification", { clar: "" }, "'clar' is required to Request clarification.");
    expect((await poOf(commercial, id)).status).toBe("Under verification");
    expect(await slaOpen(id), "SLA-15 still running").toBe(true);
    const detail = await openDetail(page, id);
    expect(await detail.statusText()).toBe("Under verification");
    const note = `Please confirm the pit dimensions ${uniqueTag("CLR")}`;
    await detail.action("Request clarification");
    await detail.answerPrompt(note);
    await expect(page.getByTestId("status-badge")).toContainText("Clarification required");
    const po = await poOf(commercial, id);
    expect(po).toMatchObject({ status: "Clarification required", clarification: note });
    expect(await slaOpen(id), "SLA-15 stopped").toBe(false);
    // a PO awaiting clarification can be rejected but not clarified again or accepted
    await detail.expectNoAction("Request clarification");
    await detail.expectNoAction("Accept PO");
    await expectActionRejected(commercial, "pos", id, "Accept PO", {}, "Cannot accept a purchase order in status 'Clarification required'.");
  });

  tc("TC-PO-006", async ({ page }) => {
    const { c, commercial, id } = await newPo();
    // blank reason rejected
    await expectActionRejected(commercial, "pos", id, "Reject", {}, "'rej' is required to Reject.");
    expect((await poOf(commercial, id)).status).toBe("Received");
    const detail = await openDetail(page, id);
    const reason = `Customer cancelled the order ${uniqueTag("REJ")}`;
    await detail.action("Reject");
    await detail.answerPrompt(reason);
    await expect(page.getByTestId("status-badge")).toContainText("Rejected / cancelled");
    expect(await poOf(commercial, id)).toMatchObject({ status: "Rejected / cancelled", rejectionReason: reason });
    expect(await ordersOf(id), "no sales order for a rejected PO").toHaveLength(0);
    expect(await stageOf(c.account.id, c.opp.id), "opportunity not won").not.toBe("Won");
    await detail.expectNoAction("Accept PO");
    await detail.expectNoAction("Reject");
    await expectActionRejected(commercial, "pos", id, "Reject", { rej: "again" }, "Cannot Reject a purchase order in status 'Rejected / cancelled'.");
    // allowed from Under verification and Clarification required too
    for (const path of [["Start verification"], ["Start verification", "Request clarification"]]) {
      const other = await newPo();
      for (const action of path) ok(await other.commercial.action("pos", other.id, action, { clar: "note" }), action);
      ok(await other.commercial.action("pos", other.id, "Reject", { rej: "not needed" }), "reject");
      expect(await poOf(other.commercial, other.id)).toMatchObject({ status: "Rejected / cancelled", rejectionReason: "not needed" });
    }
  });

  tc("TC-PO-007", async ({ page }) => {
    const { c, commercial, id } = await newPo({ value: 1_000_000, paymentTerms: TERMS });
    ok(await commercial.action("pos", id, "Start verification"), "start verification");
    expect(await slaOpen(id), "SLA-15 running before accept").toBe(true);
    const detail = await openDetail(page, id);
    await detail.action("Accept PO");
    await expect(page.getByTestId("status-badge")).toContainText("Accepted");
    expect((await poOf(commercial, id)).status).toBe("Accepted");
    // opportunity Won with a stage-history row
    expect(await stageOf(c.account.id, c.opp.id)).toBe("Won");
    expect((await historyOf(c.opp.id)).at(-1)).toBe("Qualified → Won");
    // Sales order: Order accepted, handover Pending
    const orders = await ordersOf(id);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "Order accepted", ackStatus: "Pending", accountId: c.account.id, value: 1_000_000, paymentTerms: TERMS });
    // 3 milestones: Advance 30%, Before dispatch 60%, After installation 10%, all Not due
    const milestones = await milestonesOf(orders[0]?.id as string);
    expect(milestones.map((m) => [m.milestone, m.pct, m.amount, m.status])).toEqual([
      ["After installation", 10, 100_000, "Not due"],
      ["Advance", 30, 300_000, "Not due"],
      ["Before dispatch", 60, 600_000, "Not due"],
    ]);
    // SLA-15 stopped
    expect(await slaOpen(id), "SLA-15 stopped").toBe(false);
    expect(((await poOf(commercial, id)).sla as { l: string }).l).toBe("Met");
    // the PO details tab still shows the accepted PO's terms
    await detail.tab("PO details");
    await expect(page.getByRole("tabpanel").getByText(TERMS)).toBeVisible();
  });

  tc("TC-PO-008", async () => {
    const { commercial, id } = await newPo({ value: 500_000, paymentTerms: "45 days credit" });
    const po = await poOf(commercial, id);
    const { milestones } = await acceptAndOrder(id);
    expect(milestones, "single milestone").toHaveLength(1);
    const [m] = milestones as [Rec];
    expect(m).toMatchObject({ pct: 100, amount: 500_000, status: "Not due" });
    // due date = PO date + 45 days
    const due = Date.parse(m.dueDate as string);
    expect(due - Date.parse(po.poDate as string)).toBe(45 * DAY_MS);
    // The milestone is named 'Retention' (verified current behaviour); spec: a credit-days term is a plain 100% payment due after the credit period,
    // not a retention.
    expect(m.milestone, "current: named 'Retention' (remove with D-80)").toBe("Retention");
    await knownDefect(test.info(), "D-80", async () => {
      expect(m.milestone, "milestone name for '45 days credit'").not.toBe("Retention");
    });
  });

  tc("TC-PO-009", async () => {
    for (const terms of [undefined, "as agreed with customer"]) {
      const c = await base();
      const commercial = await apiAs("commercial");
      const poId = rec(await commercial.post("/modules/pos", {
        poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: c.opp.id, quotationId: c.quote.id, accountId: c.account.id, value: 250_000, ...(terms === undefined ? {} : { paymentTerms: terms }),
      }), "create PO").id as string;
      const po = await poOf(commercial, poId);
      const { milestones } = await acceptAndOrder(poId);
      expect(milestones, `single milestone for terms ${JSON.stringify(terms)}`).toHaveLength(1);
      expect(milestones[0]).toMatchObject({ milestone: "Full payment", pct: 100, amount: 250_000, status: "Not due" });
      expect(Date.parse(milestones[0]?.dueDate as string), "due on the PO date").toBe(Date.parse(po.poDate as string));
    }
  });

  tc("TC-PO-010", async ({ page }) => {
    // already Accepted: the second accept is refused and nothing is duplicated
    const accepted = await newPo();
    const first = await acceptAndOrder(accepted.id);
    expect(first.milestones).toHaveLength(3);
    await expectActionRejected(accepted.commercial, "pos", accepted.id, "Accept PO", {}, "Cannot accept a purchase order in status 'Accepted'.");
    expect(await ordersOf(accepted.id), "still one sales order").toHaveLength(1);
    expect(await milestonesOf(first.order.id as string), "still three milestones").toHaveLength(3);
    const detail = await openDetail(page, accepted.id);
    expect(await detail.statusText()).toBe("Accepted");
    await detail.expectNoAction("Accept PO");
    // Rejected PO cannot be accepted
    const rejected = await newPo();
    ok(await rejected.commercial.action("pos", rejected.id, "Reject", { rej: "wrong customer" }), "reject");
    await expectActionRejected(rejected.commercial, "pos", rejected.id, "Accept PO", {}, "Cannot accept a purchase order in status 'Rejected / cancelled'.");
    expect(await ordersOf(rejected.id)).toHaveLength(0);
    // double click: two accepts sent at once must create exactly one order set (spec). A duplicate only happens when both status reads precede the
    // first commit, so the race is retried on FRESH POs.
    const attempts = 5;
    const created: string[] = [];
    const createdMilestones: string[] = [];
    let duplicated: { statuses: number[]; orders: number; milestones: number } | undefined;
    let allGuarded = true;
    try {
      for (let i = 0; i < attempts && !duplicated; i += 1) {
        const dbl = await newPo();
        const results = await Promise.all([dbl.commercial.action("pos", dbl.id, "Accept PO"), dbl.commercial.action("pos", dbl.id, "Accept PO")]);
        const orders = await ordersOf(dbl.id);
        const sets = await Promise.all(orders.map((o) => milestonesOf(o.id as string)));
        created.push(...orders.map((o) => o.id as string));
        createdMilestones.push(...sets.flat().map((m) => m.id as string));
        const statuses = results.map((r) => r.status);
        // always: at least one accept wins and every order carries its own full milestone set
        expect(statuses, "at least one concurrent accept succeeds").toContain(201);
        expect(sets.flat().length, "milestones = 3 per sales order").toBe(3 * orders.length);
        if (orders.length > 1) {
          duplicated = { statuses, orders: orders.length, milestones: sets.flat().length };
        } else {
          const rejected = results.find((r) => r.status !== 201);
          const guarded = rejected?.status === 400 && ApiClient.message(rejected) === "Cannot accept a purchase order in status 'Accepted'.";
          allGuarded &&= guarded;
        }
      }
    } finally {
      await archiveQuietly("payments", createdMilestones);
      await archiveQuietly("sorders", created);
    }
    if (duplicated) {
      // current evidence of D-81: both accepts succeed and the PO has two sales orders with two milestone sets
      expect(duplicated, "D-81 evidence (remove when fixed)").toEqual({ statuses: [201, 201], orders: 2, milestones: 6 });
      await knownDefect(test.info(), "D-81", async () => {
        expect(duplicated?.orders, "sales orders after a concurrent double accept").toBe(1);
      });
    } else if (allGuarded) {
      throw new Error(`D-81 appears fixed: ${attempts} concurrent double accepts each created one order and the loser got the guard message - remove the D-81 handling`);
    } else {
      test.info().annotations.push({ type: "known-defect", description: `D-81: race not reproduced in ${attempts} attempts (no duplicate, but the guard message was not seen either)` });
    }
  });

  tc("TC-PO-011", async () => {
    // A failure midway: '99999999999 days credit' makes the milestone due date an invalid Date, which fails inside the accept transaction AFTER the
    // opportunity was set Won and the sales order was created. Everything must roll back.
    const { c, commercial, id } = await newPo({ paymentTerms: "99999999999 days credit" });
    const failed = await commercial.action("pos", id, "Accept PO");
    // current: an unhandled error inside the transaction answers 500 (remove the 500 pin when the product returns a clean 4xx)
    expect(failed.status, "accept with an impossible due date fails").toBe(500);
    expect(await poOf(commercial, id), "PO untouched").toMatchObject({ status: "Received" });
    expect(await stageOf(c.account.id, c.opp.id), "opportunity not won").toBe("Qualified");
    expect(await historyOf(c.opp.id), "no stage-history rows (an API-created opportunity has none)").toEqual([]);
    expect(await ordersOf(id), "no sales order").toHaveLength(0);
    expect(await slaOpen(id), "SLA-15 still running").toBe(true);
    // after fixing the terms the same PO accepts and ALL parts exist together
    ok(await commercial.patch(`/modules/pos/${id}`, { paymentTerms: TERMS }), "fix terms");
    const { milestones } = await acceptAndOrder(id);
    expect(milestones).toHaveLength(3);
    expect((await poOf(commercial, id)).status).toBe("Accepted");
    expect(await stageOf(c.account.id, c.opp.id)).toBe("Won");
    expect((await historyOf(c.opp.id)).at(-1)).toBe("Qualified → Won");
  });

  // TC-PO-013 (upload customer PO document) is manual-visual: skipped by the wrapper.
  tc("TC-PO-013", async () => {});
});

test.describe("Purchase orders - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-PO-012", async () => {
    const { commercial, id } = await newPo();
    const po = await poOf(commercial, id);
    const poNo = po.poNo as string;
    const mentions = async (role: "salesManager" | "commercial"): Promise<boolean> => {
      const inbox = rec(await (await apiAs(role)).get("/notifications"), `${role} notifications`) as { data?: { title: string; body: string; link: string | null }[] };
      return (inbox.data ?? []).some((n) => `${n.title} ${n.body} ${n.link ?? ""}`.includes(poNo) || `${n.link ?? ""}`.includes(id));
    };
    // the inbox endpoint answered (positive loaded signal); give an asynchronous notification a moment to land
    await sleep(2_000);
    const [manager, commercialSeen] = [await mentions("salesManager"), await mentions("commercial")];
    // Spec §15: the sales manager / commercial team is notified when a PO is received. Nothing in the PO module creates a notification (SLA escalations
    // are the only producer), so neither inbox mentions the PO.
    await knownDefect(test.info(), "D-82", async () => {
      expect(manager, "Sales Manager notified of the new PO").toBe(true);
    });
    await knownDefect(test.info(), "D-82", async () => {
      expect(commercialSeen, "Commercial notified of the new PO").toBe(true);
    });
  });
});

test.describe("Purchase orders - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-PO-014", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const orgB = await apiAs("orgBAdmin");
    // Org B chain with a PO of its own
    const bAccount = await build.account(orgB);
    const bOpp = await build.opportunity(orgB, bAccount.id);
    const bProduct = await build.product(orgB);
    const bQuote = await build.sentQuotation(orgB, { opportunityId: bOpp.id, accountId: bAccount.id, productId: bProduct.id });
    const bPo = await build.po(orgB, { opportunityId: bOpp.id, accountId: bAccount.id, quotationId: bQuote.id });
    // Org A PO (control, created by Commercial) and a PO created by the Sales Executive's own account
    const own = await newPo();
    const bPoRec = await poOf(orgB, bPo.id);
    expect(bPoRec.status, "control: Org B reads its own PO").toBe("Received");

    // Org A callers (Sales Executive and Commercial, and the action endpoint) get 404 for the Org B PO, exact message
    for (const [name, client] of [["salesExec1", sales], ["commercial", commercial]] as const) {
      const r = await client.get(`/modules/pos/${bPo.id}`);
      expect(r.status, `${name} reads an Org B PO`).toBe(404);
      expect(ApiClient.message(r)).toBe(`Purchase order '${bPo.id}' not found.`);
      const a = await client.action("pos", bPo.id, "Accept PO");
      // the Sales Executive has no update right on POs at all (the permission guard answers first); Commercial reaches the service, which hides the record
      expect(a.status, `${name} accepts an Org B PO`).toBe(name === "salesExec1" ? 403 : 404);
      expect(ApiClient.message(a)).toBe(name === "salesExec1" ? "Your role does not have 'update' access to 'pos'." : `Purchase order '${bPo.id}' not found.`);
      const cmp = await client.get(`/modules/pos/${bPo.id}/table/compare`);
      expect(cmp.status, `${name} compare of an Org B PO`).toBe(404);
    }
    expect((await poOf(orgB, bPo.id)).status, "the foreign accept changed nothing").toBe("Received");
    // search and list never leak it across orgs
    const poNoB = bPoRec.poNo as string;
    const found = ok(await commercial.get(`/modules/pos?search=${poNoB}`), "search").body.data ?? [];
    expect(found, "Org A search for an Org B PO number").toHaveLength(0);
    expect(ok(await orgB.get(`/modules/pos?search=${poNoB}`), "org B search").body.data?.map((p) => p.id)).toEqual([bPo.id]);
    // reverse direction: Org B cannot read an Org A PO
    const reverse = await orgB.get(`/modules/pos/${own.id}`);
    expect(reverse.status).toBe(404);
    expect(ApiClient.message(reverse)).toBe(`Purchase order '${own.id}' not found.`);
    // control: Commercial reads the Org A PO it created
    expect((await poOf(commercial, own.id)).id).toBe(own.id);

    // the UI of the Sales Executive shows no data for the Org B PO id
    await page.goto(`/purchase-orders/${bPo.id}`);
    await expect(page.getByText(/couldn.t load|not found/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(poNoB)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept PO", exact: true })).toHaveCount(0);

    // role scope within the org: the Sales Executive owns no PO (Commercial created it), so the Org A PO is not visible to them either
    const poNo = (await poOf(commercial, own.id)).poNo as string;
    const ownSees = ok(await sales.get(`/modules/pos?search=${poNo}`), "sales exec search").body.data ?? [];
    const direct = await sales.get(`/modules/pos/${own.id}`);
    expect(direct.status, "Sales Executive reads a PO they do not own").toBe(404);
    expect(ApiClient.message(direct)).toBe(`Purchase order '${own.id}' not found.`);
    expect(ownSees, "Sales Executive list search for another user's PO").toHaveLength(0);
    expect((ok(await commercial.get(`/modules/pos?search=${poNo}`), "commercial search").body.data ?? []).map((p) => p.id), "control: the owner finds it").toEqual([own.id]);
  });
});
