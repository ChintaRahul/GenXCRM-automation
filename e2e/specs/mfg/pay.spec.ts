// e2e/specs/mfg/pay.spec.ts - Payment milestones & receipts (TC-PAY-001..013): milestones from PO acceptance, partial / full / over-payment receipts, guards,
// reminders (no-email and already-Received paths only), overdue handling, order payments tab, credit-block gap, receipt field security.
import { expect, test, type Page } from "@playwright/test";
import { authFile, MFG_USERS, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { apiAs, ApiClient, build, isoDate, ok, TERMS, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { readE2eEnv } from "../../mfg/envGuard";
import { restrictedRolesOf, slaTimersOf } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const SLA22 = "Payment collection";
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

/**
 * Sales order created by Accept PO for 10,00,000 with the default terms (3 milestones: 30% / 60% / 10%). `ownerId` is the owner of PO, order and milestones:
 * default = the Accounts user (payment milestones are own-record scoped, so Accounts only sees milestones it owns, D-101); `null` = Commercial (the accepter).
 */
const newOrder = async (ownerId?: string | null) => {
  const owner = ownerId === undefined ? await userIdOf("accounts") : ownerId;
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const product = await build.product(await apiAs("commercial"));
  const quote = await build.sentQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id });
  const commercial = await apiAs("commercial");
  const poId = rec(await commercial.post("/modules/pos", {
    poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: opp.id, quotationId: quote.id, accountId: account.id,
    value: 1_000_000, paymentTerms: TERMS, ...(owner ? { ownerId: owner } : {}),
  }), "create PO").id as string;
  ok(await commercial.action("pos", poId, "Accept PO"), "accept PO");
  const { id } = await build.salesOrderFor(await apiAs("operations"), poId);
  return { account, opp, poId, id };
};
type Order = Awaited<ReturnType<typeof newOrder>>;
const milestonesOf = async (api: ApiClient, orderId: string): Promise<Rec[]> =>
  (ok(await api.get(`/modules/payments?salesOrderId=${orderId}&limit=100`), "list payment milestones").body.data ?? [])
    .filter((m) => m.salesOrderId === orderId)
    .sort((a, b) => (a.amount as number) - (b.amount as number));
/** The Advance milestone (30% = Rs 3,00,000) of an order. */
const advanceOf = async (api: ApiClient, orderId: string): Promise<string> => {
  const advance = (await milestonesOf(api, orderId)).find((m) => m.milestone === "Advance");
  if (!advance) throw new Error(`no Advance milestone for order ${orderId}`);
  return advance.id as string;
};
const milestoneOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/payments/${id}`), "read milestone");
const receiptsOf = async (api: ApiClient, id: string): Promise<Rec[]> => ok(await api.get(`/modules/payments/${id}/related/receipts`), "read receipts").body.data ?? [];
const record = async (api: ApiClient, id: string, amt: number): Promise<Rec> => rec(await api.action("payments", id, "Record receipt", { amt }), `record receipt ${amt}`);
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
const openMilestone = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("payments", id);
  return detail;
};
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);
/** Extra milestone of an order created through the API as Director (Accounts cannot create). */
const extraMilestone = async (o: Order, over: Rec = {}): Promise<string> =>
  rec(await (await apiAs("director")).post("/modules/payments", {
    salesOrderId: o.id, accountId: o.account.id, milestone: "Retention", amount: 50_000, dueDate: isoDate(20), ownerId: await userIdOf("accounts"), ...over,
  }), "create milestone").id as string;

test.describe("Payments - Accounts", () => {
  test.use({ storageState: authFile("accounts") });

  tc("TC-PAY-001", async ({ page }) => {
    const order = await newOrder();
    const other = await newOrder();
    const accounts = await apiAs("accounts");
    const typical = await newOrder(null); // the usual chain: Commercial accepts the PO and owns the milestones
    const list = await milestonesOf(accounts, order.id);
    expect(list.map((m) => m.milestone).sort()).toEqual(["Advance", "After installation", "Before dispatch"]);
    expect(list.map((m) => m.pct), "percentages by amount").toEqual([10, 30, 60]);
    expect(list.map((m) => m.amount), "amounts by percentage").toEqual([100_000, 300_000, 600_000]);
    expect(list.every((m) => m.status === "Not due"), "every milestone is Not due").toBe(true);
    expect(list.every((m) => m.accountId === order.account.id && !Number.isNaN(Date.parse(m.dueDate as string))), "account and due date set").toBe(true);
    expect(list.reduce((sum, m) => sum + (m.amount as number), 0), "amounts sum to the PO value").toBe(1_000_000);
    // control: the other order's milestones are not mixed in
    const otherIds = (await milestonesOf(accounts, other.id)).map((m) => m.id);
    expect(otherIds).toHaveLength(3);
    expect(list.map((m) => m.id).filter((id) => otherIds.includes(id))).toEqual([]);
    // The Accounts role holds payments read/update/export, but own-record scope hides milestones it does not own: the milestones of an order accepted by Commercial
    // are invisible to it (list empty, detail 404), while the Director sees all three (D-101).
    const typicalIds = (await milestonesOf(await apiAs("director"), typical.id)).map((m) => m.id as string);
    expect(typicalIds, "Director sees the milestones of the Commercial-owned order").toHaveLength(3);
    const seenByAccounts = await milestonesOf(accounts, typical.id);
    const detailRead = await accounts.get(`/modules/payments/${typicalIds[0] as string}`);
    if (seenByAccounts.length !== 3) expect([seenByAccounts.length, detailRead.status], "current: list empty, detail 404 (remove with D-101)").toEqual([0, 404]);
    expect(seenByAccounts, "Accounts sees the milestones of an order it did not accept").toHaveLength(3);
    // UI: the Advance milestone shows its percentage, amount, due date and status (the list is not filterable by order in the UI, so each is opened)
    const advance = list.find((m) => m.milestone === "Advance") as Rec;
    const detail = await openMilestone(page, advance.id as string);
    expect(await detail.statusText()).toBe("Not due");
    await expect(fieldValue(page, "Percentage")).toContainText("30");
    await expect(fieldValue(page, "Amount")).toContainText("₹3.0 L");
    await expect(fieldValue(page, "Due date")).not.toHaveText("-");
  });

  tc("TC-PAY-002", async ({ page }) => {
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    const id = await advanceOf(accounts, order.id);
    const control = (await milestonesOf(accounts, order.id)).find((m) => m.milestone === "Before dispatch") as Rec;
    const detail = await openMilestone(page, id);
    expect((await milestoneOf(accounts, id)).amount).toBe(300_000);
    await detail.action("Record receipt");
    await detail.answerPrompt("100000");
    await expect.poll(async () => (await milestoneOf(accounts, id)).status, { message: "status after the partial receipt" }).toBe("Partially received");
    await expect(page.getByTestId("status-badge").or(page.locator('[data-testid="status-step"][data-current="true"]'))).toContainText("Partially received");
    const receipts = await receiptsOf(accounts, id);
    expect(receipts, "one Receipt row").toHaveLength(1);
    expect(receipts[0]).toMatchObject({ amount: 100_000, paymentMilestoneId: id });
    // still open: both buttons stay available
    await detail.expectAction("Record receipt");
    await detail.expectAction("Send reminder");
    // control milestone of the same order untouched
    expect((await milestoneOf(accounts, control.id as string)).status).toBe("Not due");
    expect(await receiptsOf(accounts, control.id as string)).toHaveLength(0);
    // Spec: Received amount and Balance (Rs 2,00,000) are shown. The record never carries `received` / `balance` (and the registry has no receipts tab), so both stay blank (D-93).
    await knownDefect(test.info(), "D-93", async () => {
      await expect(fieldValue(page, "Balance")).toContainText("200000", { timeout: 1_500 });
    });
    await knownDefect(test.info(), "D-93", async () => {
      await expect(fieldValue(page, "Received amount")).toContainText("100000", { timeout: 1_500 });
    });
  });

  tc("TC-PAY-003", async ({ page }) => {
    test.setTimeout(180_000); // the date sweep slows down as SLA timers accumulate during a full run (30 s was not enough once)
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    // A past-due Rs 3,00,000 milestone (same amount as the Advance), so the due-date sweep starts the SLA-22 timer that the receipts must keep running / stop.
    const id = await extraMilestone(order, { milestone: "Advance", amount: 300_000, dueDate: isoDate(-1) });
    try {
    // Setup guard (plain Errors): the sweep must run on a short interval (default 1 h; the 5 s value lives in backend/.env.e2e.local), then the timer must exist.
    const sweepMs = Number(readE2eEnv().SLA_DATE_SWEEP_MS);
    if (!(sweepMs <= 10_000)) throw new Error(`SLA_DATE_SWEEP_MS must be set to <= 10000 in backend/.env.e2e.local (found ${sweepMs})`);
    const started = await eventually(() => timerOf(id, SLA22), (open) => open === true, 75_000);
    if (started !== true) throw new Error("setup: the SLA-22 timer of the past-due milestone did not start within 75 s");
    await record(accounts, id, 100_000);
    expect((await milestoneOf(accounts, id)).status).toBe("Partially received");
    expect(await timerOf(id, SLA22), "SLA-22 timer still running after the partial receipt").toBe(true);
    const detail = await openMilestone(page, id);
    await detail.action("Record receipt");
    await detail.answerPrompt("200000");
    await expect.poll(async () => (await milestoneOf(accounts, id)).status, { message: "status after the balance receipt" }).toBe("Received");
    const done = await milestoneOf(accounts, id);
    expect(Date.parse(done.receivedDate as string), "received date set (today)").toBeGreaterThan(Date.now() - 5 * 60_000);
    expect((await receiptsOf(accounts, id)).map((r) => r.amount).sort((a, b) => (a as number) - (b as number))).toEqual([100_000, 200_000]);
    expect(await detail.statusText()).toBe("Received");
    await detail.expectNoAction("Record receipt");
    await detail.expectNoAction("Send reminder");
    // SLA-22 stops on full receipt (timer exists and is closed).
    const closed = await eventually(() => timerOf(id, SLA22), (open) => open === false, 15_000);
    expect(closed, "SLA-22 timer closed after the full receipt").toBe(false);
    } finally {
      await archiveQuietly("payments", [id]);
    }
  });

  tc("TC-PAY-004", async ({ page }) => {
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    const id = await advanceOf(accounts, order.id);
    const message = "'amt' is required to Record receipt.";
    await expectActionRejected(accounts, "payments", id, "Record receipt", {}, message);
    await expectActionRejected(accounts, "payments", id, "Record receipt", { amt: 0 }, message);
    await expectActionRejected(accounts, "payments", id, "Record receipt", { amt: "" }, message);
    // UI: the prompt cannot be confirmed while blank; a typed 0 is sent and refused by the server, so nothing changes
    const detail = await openMilestone(page, id);
    await detail.action("Record receipt");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await page.locator("#action-ask-field").fill("0");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible(); // the refusal was reported (loaded signal)
    expect(await detail.statusText(), "UI state unchanged").toBe("Not due");
    const after = await milestoneOf(accounts, id);
    expect(after.status).toBe("Not due");
    expect(await receiptsOf(accounts, id), "no receipt created").toHaveLength(0);
  });

  tc("TC-PAY-005", async ({ page }) => {
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    const id = await advanceOf(accounts, order.id);
    await record(accounts, id, 300_000);
    expect((await milestoneOf(accounts, id)).status).toBe("Received");
    await expectActionRejected(accounts, "payments", id, "Record receipt", { amt: 1_000 }, "Cannot record a receipt against a payment milestone that is already Received.");
    expect(await receiptsOf(accounts, id), "no second receipt").toHaveLength(1);
    expect((await milestoneOf(accounts, id)).status).toBe("Received");
    // UI: neither receipt nor reminder is offered for a Received milestone
    const detail = await openMilestone(page, id);
    expect(await detail.statusText()).toBe("Received");
    await detail.expectNoAction("Record receipt");
    await detail.expectNoAction("Send reminder");
  });

  tc("TC-PAY-006", async ({ page }) => {
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    const id = await advanceOf(accounts, order.id);
    const result = await record(accounts, id, 350_000);
    // Received because received >= amount
    expect(result.status).toBe("Received");
    expect((await milestoneOf(accounts, id)).status).toBe("Received");
    // the excess is not lost in the data: the Receipt row keeps the full Rs 3,50,000
    expect(await receiptsOf(accounts, id)).toEqual([expect.objectContaining({ amount: 350_000 })]);
    const detail = await openMilestone(page, id);
    expect(await detail.statusText()).toBe("Received");
    // Spec: the Rs 50,000 excess is visible (received amount / balance), not silently lost. Current: no warning, `received` / `balance` never set (D-98).
    await knownDefect(test.info(), "D-98", async () => {
      await expect(fieldValue(page, "Received amount")).toContainText("350000", { timeout: 1_500 });
    });
    await knownDefect(test.info(), "D-98", async () => {
      expect((await milestoneOf(accounts, id)).received, "record shows the received total").toBe(350_000);
    });
  });

  tc("TC-PAY-007", async () => {}); // email delivery: skipped by the wrapper

  tc("TC-PAY-008", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const order = await newOrder();
    // the account's only contact has no email address
    const noEmail = await build.contact(sales, order.account.id, { email: undefined });
    const contact = rec(await sales.get(`/modules/contacts/${noEmail.id}`), "read contact");
    expect(contact.email ?? null, "the contact has no email").toBeNull();
    const accounts = await apiAs("accounts");
    const id = await advanceOf(accounts, order.id);
    const message = "No contact with an email address is on file for this account — add one before sending a reminder.";
    await expectActionRejected(accounts, "payments", id, "Send reminder", {}, message);
    // UI: the click changes nothing (status and receipts unchanged). The refusal is reported as a generic axios text, not the server message (D-97).
    const detail = await openMilestone(page, id);
    await detail.action("Send reminder");
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible(); // the failure toast rendered (loaded signal)
    await expect(page.getByText(message)).toBeVisible({ timeout: 1_500 });
    expect(await detail.statusText()).toBe("Not due");
    expect((await milestoneOf(accounts, id)).status).toBe("Not due");
    // a milestone of an account without any contact is refused the same way
    const bare = await newOrder();
    const bareContacts = ok(await (await apiAs("director")).get(`/modules/accounts/${bare.account.id}/related/contacts`), "bare account contacts").body.data ?? [];
    expect(bareContacts.filter((c) => c.email), "the bare account has no contact with an email").toHaveLength(0);
    await expectActionRejected(accounts, "payments", await advanceOf(accounts, bare.id), "Send reminder", {}, message);
  });

  tc("TC-PAY-009", async ({ page }) => {
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    const id = await advanceOf(accounts, order.id);
    await record(accounts, id, 300_000);
    await expectActionRejected(accounts, "payments", id, "Send reminder", {}, `Payment milestone '${id}' is already Received — no reminder needed.`);
    const detail = await openMilestone(page, id);
    expect(await detail.statusText()).toBe("Received");
    await detail.expectNoAction("Send reminder");
    expect((await milestoneOf(accounts, id)).status).toBe("Received");
  });

  tc("TC-PAY-010", async ({ page }) => {
    test.setTimeout(180_000); // the date sweep slows down as SLA timers accumulate during a full run (30 s was not enough once)
    const order = await newOrder();
    const accounts = await apiAs("accounts");
    const director = await apiAs("director");
    // unpaid milestone due yesterday (and a control one due in 20 days)
    const id = await extraMilestone(order, { dueDate: isoDate(-1) });
    const future = await extraMilestone(order, { dueDate: isoDate(20) });
    let controlActivity = "";
    let sweepProbe = "";
    try {
      // Guard + positive observation that the date sweep really runs on a short interval (default is 1 h; the 5 s value lives only in backend/.env.e2e.local).
      // Setup problems here are plain Errors, not assertion failures: they must never be mistaken for the D-94 finding.
      const sweepMs = Number(readE2eEnv().SLA_DATE_SWEEP_MS);
      if (!(sweepMs <= 10_000)) throw new Error(`SLA_DATE_SWEEP_MS must be set to <= 10000 in backend/.env.e2e.local (found ${sweepMs})`);
      sweepProbe = rec(await build.activity(director, { subject: `${uniqueTag("PAYSWEEP")} sweep probe`, type: "Call", priority: "Medium", dueDate: isoDate(-1) }), "create sweep probe activity").id as string;
      const swept = await eventually(async () => (await slaTimersOf(sweepProbe)).length, (n) => n > 0, 30_000);
      if (swept === 0) throw new Error("the date sweep did not run within 30 s (no SLA timer for the past-due probe activity); is the E2E backend running with SLA_DATE_SWEEP_MS?");
      // the sweep has now run at least once after the milestones were created: give the milestone one more sweep interval, then read it
      await sleep(sweepMs + 1_000);
      const seen = await milestoneOf(accounts, id);
      await knownDefect(test.info(), "D-94", async () => {
        expect(seen.status, "unpaid past-due milestone after the sweep window").toBe("Overdue");
      });
      expect(["Not due", "Due", "Overdue"], "current status of the past-due milestone").toContain(seen.status);
      expect((await milestoneOf(accounts, future)).status, "control: not past due").toBe("Not due");
      // UI: status and the reminders & escalations tab
      const detail = await openMilestone(page, id);
      const status = await detail.statusText();
      await detail.tab("Reminders & escalations");
      await expect(page.getByRole("tabpanel").getByRole("listitem").first()).toBeVisible(); // tab loaded
      const labels = (ok(await accounts.get(`/modules/payments/${id}/events/esc`), "escalation events").body as unknown as { label: string }[]).map((e) => e.label);
      expect(labels.length).toBeGreaterThan(0);
      await knownDefect(test.info(), "D-94", async () => {
        expect(status, "milestone status shown as Overdue").toBe("Overdue");
        expect(labels).toEqual(expect.arrayContaining(["Reminder sent to customer", "Overdue · Accounts + Sales owner notified"]));
        await expect(page.getByRole("tabpanel").getByText("Overdue · Accounts + Sales owner notified")).toBeVisible({ timeout: 1_500 });
      });
      // SLA-22 'Payment collection' handles the reminders: the due-date sweep starts it for a past-due milestone (D-95 fixed by d1e2f72)
      // (poll: the sweep can lag one interval behind the probe activity's sweep)
      const collection = await eventually(() => timerOf(id, SLA22), (open) => open === true, 75_000);
      expect(collection, "SLA-22 timer of the past-due milestone").toBe(true);
      // Flow chart: Overdue creates a payment follow-up Activity for the account
      // (the Account 360 Activities tab is the account-scoped read; the plain list ignores accountId. A control activity proves the read works.)
      controlActivity = rec(await director.post("/modules/activities", { type: "Call", subject: `${uniqueTag("CTRL")} control`, accountId: order.account.id, priority: "Medium", dueDate: isoDate(2) }), "create control activity").id as string;
      const activities = ok(await director.get(`/modules/accounts/${order.account.id}/related/acts`), "account activities").body.data ?? [];
      expect(activities.map((a) => a.id), "the control activity is listed").toContain(controlActivity);
      await knownDefect(test.info(), "D-96", async () => {
        expect(activities.some((a) => a.id !== controlActivity), "payment follow-up activity for the account").toBe(true);
      });
    } finally {
      if (sweepProbe) {
        try {
          await director.action("activities", sweepProbe, "Cancel"); // leave no open past-due activity behind
        } catch {
          // cleanup only
        }
        await archiveQuietly("activities", [sweepProbe]);
      }
      if (controlActivity) await archiveQuietly("activities", [controlActivity]);
      await archiveQuietly("payments", [id, future]);
    }
  });

  tc("TC-PAY-012", async () => {
    // tc() turns ANY failure of this body into the expected gap failure, so setup and preconditions below throw plain Errors (ok() / must) and only the
    // final gap assertion is an expect() matcher failure.
    const must = (condition: boolean, what: string): void => {
      if (!condition) throw new Error(`precondition failed: ${what}`);
    };
    const order = await newOrder();
    const clean = await newOrder();
    const milestone = await extraMilestone(order, { dueDate: isoDate(-10), amount: 100_000 });
    const created: string[] = [];
    try {
      // Created by Sales Head (CRUE on dispatch) so a refusal can only come from the block rule, not from Operations lacking 'create' (D-87).
      const salesHead = await apiAs("salesHead");
      const dispatchBody = (o: Order) => ({ salesOrderId: o.id, accountId: o.account.id, dispatchDate: isoDate(1) });
      // preconditions: the overdue milestone exists, is unpaid and past due; a control dispatch on a clean order succeeds as the same client
      const ms = await milestoneOf(await apiAs("director"), milestone);
      must(ms.salesOrderId === order.id && ms.status !== "Received" && Date.parse(ms.dueDate as string) < Date.now(), "unpaid past-due milestone on the order");
      const control = await salesHead.post("/modules/dispatch", dispatchBody(clean));
      must(control.status === 201, `control dispatch on a clean order returned ${control.status}`);
      created.push(control.body.id as string);
      // the spec-correct assertion
      const r = await salesHead.post("/modules/dispatch", dispatchBody(order));
      if (r.status === 201) created.push(r.body.id as string);
      expect(r.status, "dispatch against an order with an overdue milestone is refused").toBe(400);
      expect(ApiClient.message(r)).toMatch(/payment|overdue|credit/i);
    } finally {
      await archiveQuietly("dispatch", created);
      await archiveQuietly("payments", [milestone]);
    }
  });
});

test.describe("Payments - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-PAY-011", async ({ page }) => {
    const salesId = await userIdOf("salesExec1");
    const order = await newOrder(salesId);
    const other = await newOrder(salesId);
    const sales = await apiAs("salesExec1");
    const director = await apiAs("director"); // Accounts cannot read milestones owned by the Sales Executive (D-101)
    const advance = await advanceOf(director, order.id);
    await record(director, advance, 100_000);
    const mine = await milestonesOf(director, order.id);
    const control = await milestonesOf(director, other.id);
    // the order's Payments tab lists exactly its own three milestones (not the other order's)
    const related = ok(await sales.get(`/modules/sorders/${order.id}/related/payments`), "order payments").body.data ?? [];
    expect(related.map((m) => m.id as string).sort()).toEqual(mine.map((m) => m.id as string).sort());
    expect(related.some((m) => control.some((c) => c.id === m.id))).toBe(false);
    await page.goto(`/sales-orders/${order.id}`);
    await new ModuleDetail(page).tab("Payments");
    const rows = page.getByRole("tabpanel").getByRole("row");
    await expect(rows).toHaveCount(4); // header + 3 milestones
    await expect(rows.filter({ hasText: "Partially received" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Not due" })).toHaveCount(2);
    // totals reconcile with the milestone list (verified on the API rows behind the tab)
    const total = mine.reduce((sum, m) => sum + (m.amount as number), 0);
    expect(total, "milestone amounts add up to the order value").toBe(1_000_000);
    const open = mine.filter((m) => m.status !== "Received").sort((a, b) => Date.parse(a.dueDate as string) - Date.parse(b.dueDate as string));
    expect(Date.parse(open[0]?.dueDate as string), "next due date exists").toBeGreaterThan(Date.now() - 5 * DAY_MS);
    // Spec §21: a summary of total / received / outstanding / next due above the milestones. Only the plain table exists; received and balance are blank (D-93).
    await knownDefect(test.info(), "D-99", async () => {
      await expect(page.getByRole("tabpanel").getByText(/outstanding/i).first()).toBeVisible({ timeout: 1_500 });
    });
    await knownDefect(test.info(), "D-93", async () => {
      expect(related.find((m) => m.id === advance)?.received, "received amount of the Advance milestone in the tab data").toBe(100_000);
    });
  });

  tc("TC-PAY-013", async ({ page }) => {
    const salesId = await userIdOf("salesExec1");
    const order = await newOrder(salesId);
    const director = await apiAs("director"); // Accounts cannot read milestones owned by the Sales Executive (D-101)
    const sales = await apiAs("salesExec1");
    const id = await advanceOf(director, order.id);
    await record(director, id, 100_000);
    // precondition: 'Payment receipts' is restricted for the Sales Executive role and not for the Director
    const roles = await restrictedRolesOf(MFG_USERS.salesExec1.email, "payments", "Payment receipts");
    expect(roles).toContain("SALES_EXECUTIVE");
    expect(roles).not.toContain("DIRECTOR");
    // unrestricted reader (Director): amounts visible
    expect(await milestoneOf(director, id)).toMatchObject({ amount: 300_000 });
    expect(await receiptsOf(director, id)).toEqual([expect.objectContaining({ amount: 100_000 })]);
    // a Sales Executive who does not own the milestone cannot read it at all (control for the own-record scope)
    const stranger = await (await apiAs("salesExec2")).get(`/modules/payments/${id}`);
    expect(stranger.status).toBe(404);
    // restricted reader (owner): the milestone is readable, the amount fields should be masked
    const mine = await milestoneOf(sales, id);
    expect(mine.id).toBe(id);
    const myReceipts = await receiptsOf(sales, id);
    const listed = (ok(await sales.get(`/modules/payments?salesOrderId=${order.id}&limit=100`), "list as sales").body.data ?? []).find((m) => m.id === id) as Rec;
    const detail = await openMilestone(page, id);
    expect(await detail.statusText()).toBe("Partially received");
    // Spec §21 / field security: receipt amounts are hidden (masked to null) for restricted roles. The payments module never applies the field mask
    // (only products does), so the Sales Executive reads the amounts in the API and on screen (D-100).
    expect(mine.amount ?? null, "milestone amount for a restricted role").toBeNull();
    expect(listed.amount ?? null, "listed amount for a restricted role").toBeNull();
    expect(myReceipts.map((r) => r.amount ?? null), "receipt amounts for a restricted role").toEqual([null]);
    await expect(fieldValue(page, "Amount")).not.toContainText("300000", { timeout: 1_500 });
  });
});
