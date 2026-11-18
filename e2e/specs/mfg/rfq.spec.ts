// e2e/specs/mfg/rfq.spec.ts - RFQ module (TC-RFQ-001..010): create, feasibility flow, clarification, revisions, costing gate, notifications.
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
type Sla = { l: string; t: string } | null;

/** User id of a seeded role, read from the JWT the API login returns. */
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const rfqOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/rfqs/${id}`), "read RFQ");
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DETAIL_RE = /\/rfqs\/[0-9a-f-]{36}$/;

/** Opportunity (owned by salesExec1) + an RFQ on it created by the Application Engineer, who becomes the technical owner. */
const newRfq = async (over: Rec = {}) => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const engineer = await apiAs("appEngineer");
  const rfq = await build.rfq(engineer, { opportunityId: opp.id, accountId: account.id }, over);
  return { engineer, sales, account, opp, ...rfq };
};

test.describe("RFQ - Application Engineer", () => {
  test.use({ storageState: authFile("appEngineer") });

  tc("TC-RFQ-001", async ({ page }) => {
    test.slow(); // cold stack
    const sales = await apiAs("salesExec1");
    const engineer = await apiAs("appEngineer");
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id);
    const custNo = uniqueTag("RFQ1");
    const fields = {
      custNo, opportunityId: opp.id, accountId: account.id, receivedOn: dateInput(0), application: "Truck weighing at the plant gate",
      product: "Weighbridge", capacity: "60 T",
    };
    const list = new ModuleList(page, "rfqs");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // The Opportunity / Account fields are raw-UUID text boxes (D-31 pattern); the technical owner is left to the server (defaults to the caller).
    await drawer.fill({ ...fields, qty: 2 });
    await drawer.save();
    await expect(drawer.error.or(page.getByRole("button", { name: "More actions", exact: true }))).toBeVisible({ timeout: 15_000 });
    // Spec: quantity is part of the create. Number fields are posted as strings and the API rejects them (D-6): the save fails.
    await expect(page).toHaveURL(DETAIL_RE, { timeout: 1_000 });
    if (!DETAIL_RE.test(page.url())) {
      await expect(drawer.error).toHaveText("Couldn't save — please try again.");
      await list.goto();
      await list.clickNew();
      await drawer.fill(fields); // same RFQ without the quantity
      await drawer.save();
      await page.waitForURL(DETAIL_RE);
    }
    const id = idFromUrl(page);
    const detail = new ModuleDetail(page);
    await detail.expectAction("Mark feasible");
    expect(await detail.statusText()).toBe("Received");
    const rfq = await rfqOf(engineer, id);
    expect(rfq).toMatchObject({ custNo, opportunityId: opp.id, accountId: account.id, application: fields.application, product: "Weighbridge", capacity: "60 T", status: "Received" });
    expect(rfq.ownerId).toBe(await userIdOf("appEngineer"));
    // Spec: revision 1. A new RFQ is stored with revision 0 (schema default; create() never sets it).
    expect(rfq.revision, "revision of a new RFQ").toBe(1);
    // SLA-07 'Technical feasibility response' starts on create: a running (not yet Met) timer exists on the record
    expect(rfq.sla, "SLA-07 timer exists").not.toBeNull();
    expect((rfq.sla as Sla)?.l).not.toBe("Met");
    // listed under its customer RFQ number
    await list.goto();
    await list.search(custNo);
    await expect(list.row(custNo)).toBeVisible();
  });

  tc("TC-RFQ-002", async ({ page }) => {
    const { engineer, opp, account, id } = await newRfq();
    expect(((await rfqOf(engineer, id)).sla as Sla)?.l, "SLA-07 running while Received").not.toBe("Met");
    const detail = new ModuleDetail(page);
    await detail.goto("rfqs", id);
    expect(await detail.statusText()).toBe("Received");
    await detail.expectNoAction("Approve for costing"); // only offered once Technically feasible
    await detail.action("Mark feasible");
    await expect.poll(() => detail.statusText()).toBe("Technically feasible");
    expect((await rfqOf(engineer, id)).status).toBe("Technically feasible");
    // SLA-07 stops on the first decision
    expect((await rfqOf(engineer, id)).sla).toMatchObject({ l: "Met" });
    await detail.action("Approve for costing");
    await expect.poll(() => detail.statusText()).toBe("Approved for costing");
    expect((await rfqOf(engineer, id)).status).toBe("Approved for costing");
    // no further feasibility actions once approved
    await detail.expectAction("New revision");
    await detail.expectNoAction("Mark feasible");
    await detail.expectNoAction("Approve for costing");
    // a costing sheet can be created now and starts SLA-10
    const commercial = await apiAs("commercial");
    const sheet = rec(await commercial.post("/modules/costing", { opportunityId: opp.id, accountId: account.id, sellingPrice: 1_000_000 }), "create costing sheet");
    expect(sheet.status).toBe("Draft");
    const read = rec(await commercial.get(`/modules/costing/${sheet.id as string}`), "read costing sheet");
    expect(read.sla, "SLA-10 timer exists").not.toBeNull();
  });

  tc("TC-RFQ-003", async ({ page }) => {
    const { engineer, id } = await newRfq();
    const detail = new ModuleDetail(page);
    await detail.goto("rfqs", id);
    await detail.expectAction("Mark feasible"); // loaded
    await detail.expectNoAction("Approve for costing"); // the UI does not even offer it
    await expectActionRejected(engineer, "rfqs", id, "Approve for costing", {}, "Cannot Approve for costing an RFQ in status 'Received'.");
    expect((await rfqOf(engineer, id)).status).toBe("Received");
    await page.reload();
    await detail.expectAction("Mark feasible");
    expect(await detail.statusText()).toBe("Received");
  });

  tc("TC-RFQ-004", async ({ page }) => {
    const { engineer, sales, custNo, id } = await newRfq();
    const note = `${uniqueTag("NOTE")} please confirm the pit dimensions`;
    const detail = new ModuleDetail(page);
    await detail.goto("rfqs", id);
    await detail.action("Request clarification");
    await detail.answerPrompt(note);
    await expect.poll(() => detail.statusText()).toBe("Clarification required");
    const rfq = await rfqOf(engineer, id);
    expect(rfq.status).toBe("Clarification required");
    // clarification request counts as the feasibility response: SLA-07 stops
    expect(rfq.sla).toMatchObject({ l: "Met" });
    // Spec: the note is saved. The action only changes the status (the payload is validated, never stored; the RFQ has no field for it).
    expect(JSON.stringify(rfq), "the clarification note is stored on the RFQ").toContain(note);
    // Spec: the sales owner is notified. Only SLA escalations create notifications (see TC-RFQ-010).
    const inbox = ok(await sales.get("/notifications"), "read notifications").body as unknown as { data: { title: string; body: string; link: string | null }[] };
    expect(Array.isArray(inbox.data)).toBe(true);
    expect(inbox.data.some((n) => [n.title, n.body, n.link ?? ""].join(" ").match(new RegExp(`${id}|${custNo}`))), "notification about the RFQ").toBeTruthy();
  });

  tc("TC-RFQ-005", async ({ page }) => {
    const { engineer, id } = await newRfq();
    const detail = new ModuleDetail(page);
    await detail.goto("rfqs", id);
    await detail.action("Request clarification");
    await expect(page.locator("#action-ask-field")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled(); // blank note cannot be submitted
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    // Server guard: missing and empty note
    const message = "'clarification' is required to Request clarification.";
    await expectActionRejected(engineer, "rfqs", id, "Request clarification", {}, message);
    await expectActionRejected(engineer, "rfqs", id, "Request clarification", { clarification: "" }, message);
    expect((await rfqOf(engineer, id)).status).toBe("Received");
    await page.reload();
    await detail.expectAction("Mark feasible");
    expect(await detail.statusText()).toBe("Received");
  });

  tc("TC-RFQ-006", async ({ page }) => {
    const { engineer, id } = await newRfq();
    const reason = `${uniqueTag("NF")} exceeds the largest platform we build`;
    const detail = new ModuleDetail(page);
    await detail.goto("rfqs", id);
    // blank reason: the dialog blocks it, the server rejects it
    await detail.action("Not feasible");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expectActionRejected(engineer, "rfqs", id, "Not feasible", {}, "'nf' is required to Not feasible.");
    expect((await rfqOf(engineer, id)).status).toBe("Received");
    // with a reason
    await detail.action("Not feasible");
    await detail.answerPrompt(reason);
    await expect.poll(() => detail.statusText()).toBe("Not feasible");
    const rfq = await rfqOf(engineer, id);
    expect(rfq.status).toBe("Not feasible");
    expect(rfq.sla).toMatchObject({ l: "Met" });
    // Spec: the reason is stored. Like the clarification note it is validated but never persisted.
    expect(JSON.stringify(rfq), "the Not feasible reason is stored on the RFQ").toContain(reason);
    // final: no way forward
    await detail.goto("rfqs", id);
    await detail.expectAction("New revision");
    await detail.expectNoAction("Approve for costing");
    await detail.expectNoAction("Mark feasible");
  });

  tc("TC-RFQ-007", async ({ page }) => {
    const { engineer, id } = await newRfq();
    ok(await engineer.action("rfqs", id, "Mark feasible"), "mark feasible");
    const detail = new ModuleDetail(page);
    await detail.goto("rfqs", id);
    await detail.tab("Revisions");
    await expect(page.getByText("No revisions recorded yet.")).toBeVisible(); // loaded, nothing yet
    await detail.tab("Specification");

    // first revision: counter increments, the RFQ goes back through feasibility review
    await detail.action("New revision");
    await expect.poll(async () => (await rfqOf(engineer, id)).revision).toBe(1);
    const first = await rfqOf(engineer, id);
    expect(first.status, "revision sends the RFQ back to Received").toBe("Received");
    expect((first.sla as Sla)?.l, "SLA-07 restarted").not.toBe("Met");
    // change a spec, then a second revision
    ok(await engineer.patch(`/modules/rfqs/${id}`, { capacity: "100 T" }), "change the capacity");
    await detail.goto("rfqs", id);
    await detail.action("New revision");
    await expect.poll(async () => (await rfqOf(engineer, id)).revision).toBe(2);
    expect(await rfqOf(engineer, id)).toMatchObject({ capacity: "100 T", status: "Received" });

    // Revisions tab (API + UI): one row per revision, oldest first, with the author
    const events = (await engineer.get(`/modules/rfqs/${id}/events/revs`)).body as unknown as { label: string; actor?: string }[];
    expect(events.map((e) => e.label)).toEqual(["Revision 1", "Revision 2"]);
    expect(new Set(events.map((e) => e.actor))).toEqual(new Set(["Mfg App Engineer"]));
    await page.reload();
    await detail.tab("Revisions");
    const items = page.getByRole("tabpanel").getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Revision 1");
    await expect(items.nth(1)).toContainText("Revision 2");
    // Spec: the previous revision is retained and viewable. Only the revision number/note is kept; the superseded specification
    // (capacity "60 T" before the change) is not snapshotted anywhere.
    await knownDefect(test.info(), "D-43", async () => {
      expect(JSON.stringify(events), "the superseded specification is viewable in the revision history").toContain("60 T");
    });
  });

  tc("TC-RFQ-008", async () => {});
});

test.describe("RFQ - Commercial", () => {
  test.use({ storageState: authFile("commercial") });

  tc("TC-RFQ-009", async ({ page }) => {
    const { engineer, opp, account, id } = await newRfq();
    expect((await rfqOf(engineer, id)).status).toBe("Received"); // not yet Approved for costing
    const commercial = await apiAs("commercial");
    // Current behaviour: costing create only validates the opportunity, so the sheet is created although the RFQ is not approved.
    // Spec §7 Gate: costing/quotation is gated until the RFQ is 'Approved for costing'.
    const attempt = await commercial.post("/modules/costing", { opportunityId: opp.id, accountId: account.id, sellingPrice: 1_000_000 });
    expect([201, 400], `unexpected status ${attempt.status} ${ApiClient.message(attempt)}`).toContain(attempt.status);
    expect(attempt.status, "costing create is blocked while the RFQ is not approved").toBe(400);
    // The UI offers the costing module and its New button regardless of the RFQ state
    await page.goto("/costing");
    const newButton = page.getByRole("button", { name: /^New [^(]/ });
    await expect(newButton).toBeVisible({ timeout: 15_000 }); // page loaded; the UI has no feasibility gate either (D-45): spec says it should be blocked
    // approving the RFQ for costing lets the same call through (control)
    ok(await engineer.action("rfqs", id, "Mark feasible"), "mark feasible");
    ok(await engineer.action("rfqs", id, "Approve for costing"), "approve for costing");
    const control = await commercial.post("/modules/costing", { opportunityId: opp.id, accountId: account.id, sellingPrice: 1_000_000 });
    expect(control.status).toBe(201);
  });
});

test.describe("RFQ - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-RFQ-010", async () => {
    const { engineer, sales, custNo, id } = await newRfq();
    ok(await engineer.action("rfqs", id, "Request clarification", { clarification: `${uniqueTag("CL")} need drawings` }), "request clarification");
    expect((await rfqOf(engineer, id)).status).toBe("Clarification required");
    const inbox = ok(await sales.get("/notifications"), "read notifications").body as unknown as { data: { title: string; body: string; link: string | null }[]; unreadCount: number };
    expect(Array.isArray(inbox.data), "the inbox loaded").toBe(true);
    // Spec: the sales owner (the opportunity's owner, salesExec1) gets an in-app notification. RFQ actions create none: only SLA-engine
    // escalations land in the inbox (notifications.create is called from the SLA engine only).
    const about = (n: { title: string; body: string; link: string | null }): boolean => [n.title, n.body, n.link ?? ""].join(" ").includes(id) || [n.title, n.body].join(" ").includes(custNo);
    expect(inbox.data.some(about), "in-app notification about the clarification request").toBe(true);
  });
});
