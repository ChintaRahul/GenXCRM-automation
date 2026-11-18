// e2e/specs/mfg/act.spec.ts - ACT module (TC-ACT-001..009): activities, outcome rule, cancel, linking, overdue, SLA-06, timeline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { slaTimersOf } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

/** User id of a seeded role, read from the JWT the API login returns. */
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const actOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/activities/${id}`), "read activity");
const oppOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/opps/${id}`), "read opportunity");
const idsOf = (r: ApiResult): string[] => (r.body.data ?? []).map((a) => a.id as string);
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DETAIL_RE = /\/activities\/[0-9a-f-]{36}$/;
const SLA_STATE = /^(Due in \d+[mhd]|Breached .+)$/;
const ACTIVITY_TYPES = ["Call", "WhatsApp", "Email", "Meeting", "Site visit", "Demo", "Quotation follow-up", "PO follow-up", "Payment follow-up", "Service follow-up"];

type NewActivity = { subject: string; type?: string; priority?: string; dueDate?: string } & Rec;
const newActivity = async (api: ApiClient, over: NewActivity): Promise<{ id: string; subject: string }> => {
  const r = ok(await build.activity(api, { type: "Call", priority: "Medium", dueDate: isoDate(2), ...over }), "create activity");
  return { id: r.body.id as string, subject: over.subject };
};
const slaOf = async (api: ApiClient, id: string): Promise<{ l: string; t: string } | null> => (await actOf(api, id)).sla as { l: string; t: string } | null;

/** Re-reads `read` until `done(value)` or the deadline; returns the last value (so the caller can assert inside a knownDefect). */
const eventually = async <T>(read: () => Promise<T>, done: (v: T) => boolean, ms: number): Promise<T> => {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    value = await read();
  }
  return value;
};

test("ACT type list mirrors the backend seed data (drift guard)", () => {
  const src = readFileSync(join(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
  const seeded = /\.\.\.simple\('activityTypes', \[([^\]]+)\]\)/.exec(src)?.[1]?.match(/'([^']+)'/g)?.map((s) => s.slice(1, -1));
  expect(seeded).toEqual(ACTIVITY_TYPES);
});

test.describe("ACT - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-ACT-001", async ({ page }) => {
    test.slow(); // cold stack
    const api = await apiAs("salesExec1");
    const [exec1Id, exec2Id] = await Promise.all([userIdOf("salesExec1"), userIdOf("salesExec2")]);
    const account = await build.account(api);
    const opp = await build.opportunity(api, account.id);
    const subject = `${uniqueTag("A1")} call about the quotation`;
    const list = new ModuleList(page, "activities");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // A Sales Executive gets no Owner picker: the creator always owns the activity.
    await drawer.fill({ type: "Call", subject, opportunityId: opp.id, dueDate: dateInput(2), priority: "High" });
    await drawer.save();
    await page.waitForURL(DETAIL_RE);
    const id = idFromUrl(page);
    const detail = new ModuleDetail(page);
    await detail.expectAction("Complete");
    expect(await detail.statusText()).toBe("Open");
    const activity = await actOf(api, id);
    expect(activity).toMatchObject({ type: "Call", subject, opportunityId: opp.id, priority: "High", status: "Open" });
    expect(activity.ownerId, "owner is the creator").toBe(exec1Id);
    expect(Date.parse(activity.dueDate as string)).toBeGreaterThan(Date.now());
    // and the API itself ignores an explicit ownerId from a Sales Executive
    const viaApi = await newActivity(api, { subject: `${uniqueTag("A1")} api`, ownerId: exec2Id });
    expect((await actOf(api, viaApi.id)).ownerId).toBe(exec1Id);
    expect((await (await apiAs("salesExec2")).get(`/modules/activities/${viaApi.id}`)).status, "the other rep cannot see it").toBe(404);
    // appears on the opportunity's Activities tab and in the list
    await list.goto();
    await list.search(subject);
    await expect(list.row(subject)).toBeVisible();
    expect(idsOf(await api.get(`/modules/opps/${opp.id}/related/acts`))).toEqual([id]);
  });

  tc("TC-ACT-002", async ({ page }) => {
    const list = new ModuleList(page, "activities");
    await list.goto();
    await list.clickNew();
    await expect(page.getByRole("heading", { name: "New Activity" })).toBeVisible();
    const options = page.locator("#type option");
    await expect(options).toHaveCount(ACTIVITY_TYPES.length + 1); // + "Select…"
    expect(await options.allTextContents()).toEqual(["Select…", ...ACTIVITY_TYPES]);
    // every listed type is accepted by the server
    const api = await apiAs("salesExec1");
    for (const type of ACTIVITY_TYPES) {
      const r = await api.post("/modules/activities", { type, subject: `${uniqueTag("A2")} ${type}`, priority: "Low", dueDate: isoDate(1) });
      expect(r.status, type).toBe(201);
    }
    const bad = await api.post("/modules/activities", { type: "Carrier pigeon", subject: uniqueTag("A2"), priority: "Low", dueDate: isoDate(1) });
    expect(bad.status).toBe(400);
  });

  tc("TC-ACT-003", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    // SLA-05 (next action overdue) lives on the opportunity: its next action date is in the past so the date sweep starts the timer.
    const opp = await build.opportunity(api, account.id, { stage: "Negotiation", nextActionDate: isoDate(-1) });
    const act = await newActivity(api, { subject: `${uniqueTag("A3")} follow-up`, opportunityId: opp.id, accountId: account.id, dueDate: isoDate(-1) });
    const running = (s: { l: string } | null): boolean => s !== null && s.l !== "Met";
    await expect.poll(async () => running(await slaOf(api, act.id)), { timeout: 30_000, message: "SLA-06 follow-up timer is running" }).toBe(true);
    // SLA-05 starts when the next action date is reached (the date sweep; D-40 fixed by d1e2f72).
    const started = await eventually(async () => running((await oppOf(api, opp.id)).sla as { l: string } | null), (v) => v, 12_000);
    expect(started, "SLA-05 timer of the opportunity is running").toBe(true);

    const detail = new ModuleDetail(page);
    await detail.goto("activities", act.id);
    await detail.action("Complete");
    await detail.answerPrompt("Customer confirmed the order date");
    await expect.poll(() => detail.statusText()).toBe("Completed");
    await detail.expectNoAction("Complete");
    const done = await actOf(api, act.id);
    expect(done).toMatchObject({ status: "Completed", outcome: "Customer confirmed the order date" });
    // SLA-06 stopped (the date sweep skips Completed activities, so this state is stable)
    expect(done.sla).toMatchObject({ l: "Met" });

    // SLA-05 on the linked opportunity also stops when an activity is completed (D-40 fixed by d1e2f72).
    // The next action date is moved into the future first so the 5s date sweep cannot re-arm SLA-05 after the stop, and the state is read
    // once, immediately. Limitation: the API exposes only the record's latest timer (getSlaState), not per-policy timers.
    const act2 = await newActivity(api, { subject: `${uniqueTag("A3")} second`, opportunityId: opp.id, accountId: account.id });
    ok(await api.patch(`/modules/opps/${opp.id}`, { nextAction: "Call customer", nextActionDate: isoDate(5) }), "move next action date");
    ok(await api.action("activities", act2.id, "Complete", { outcome: "Done" }), "complete");
    const nextActionTimer = (await slaTimersOf(opp.id)).find((t) => t.name === "Next action overdue");
    expect(nextActionTimer?.open, "SLA-05 of the linked opportunity stopped").toBe(false);
  });

  tc("TC-ACT-004", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const act = await newActivity(api, { subject: `${uniqueTag("A4")} call` });
    const detail = new ModuleDetail(page);
    await detail.goto("activities", act.id);
    await detail.action("Complete");
    await expect(page.locator("label[for=action-ask-field]")).toContainText("Outcome");
    await expect(page.locator("#action-ask-field")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled(); // blank outcome cannot be submitted
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    // Server guard
    await expectActionRejected(api, "activities", act.id, "Complete", {}, "'outcome' is required to Complete.");
    await expectActionRejected(api, "activities", act.id, "Complete", { outcome: "" }, "'outcome' is required to Complete.");
    expect(await actOf(api, act.id)).toMatchObject({ status: "Open", outcome: null });
    await page.reload();
    await detail.expectAction("Complete");
    expect(await detail.statusText()).toBe("Open");
  });

  tc("TC-ACT-005", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const act = await newActivity(api, { subject: `${uniqueTag("A5")} call` });
    const detail = new ModuleDetail(page);
    await detail.goto("activities", act.id);
    await detail.action("Cancel");
    await expect.poll(() => detail.statusText()).toBe("Cancelled");
    await detail.expectNoAction("Complete");
    await detail.expectNoAction("Cancel");
    expect((await actOf(api, act.id)).status).toBe("Cancelled");
    await expectActionRejected(api, "activities", act.id, "Complete", { outcome: "Too late" }, "Cannot Complete an activity in status 'Cancelled'.");
    await expectActionRejected(api, "activities", act.id, "Cancel", {}, "Cannot Cancel an activity in status 'Cancelled'.");
    expect(await actOf(api, act.id)).toMatchObject({ status: "Cancelled", outcome: null });
    // Cancel is allowed from Open only: a Completed activity cannot be cancelled either
    const completed = await newActivity(api, { subject: `${uniqueTag("A5")} done` });
    ok(await api.action("activities", completed.id, "Complete", { outcome: "Done" }), "complete");
    await expectActionRejected(api, "activities", completed.id, "Cancel", {}, "Cannot Cancel an activity in status 'Completed'.");
    expect((await actOf(api, completed.id)).status).toBe("Completed");
  });

  tc("TC-ACT-006", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const orgB = await apiAs("orgBAdmin");
    const lead = await build.lead(api);
    const account = await build.account(api);
    const contact = await build.contact(api, account.id);
    const controlLead = await build.lead(api);
    const controlAccount = await build.account(api);
    const controlContact = await build.contact(api, controlAccount.id);
    const tag = uniqueTag("A6");
    const forLead = await newActivity(api, { subject: `${tag} lead`, mfgLeadId: lead.id });
    const forAccount = await newActivity(api, { subject: `${tag} account`, accountId: account.id });
    const forContact = await newActivity(api, { subject: `${tag} contact`, contactId: contact.id });
    await newActivity(api, { subject: `${tag} control lead`, mfgLeadId: controlLead.id });
    await newActivity(api, { subject: `${tag} control account`, accountId: controlAccount.id });
    await newActivity(api, { subject: `${tag} control contact`, contactId: controlContact.id });

    const detail = new ModuleDetail(page);
    const panel = page.getByRole("tabpanel");
    for (const [key, id, own, control] of [
      ["leads", lead.id, forLead, `${tag} control lead`],
      ["accounts", account.id, forAccount, `${tag} control account`],
      ["contacts", contact.id, forContact, `${tag} control contact`],
    ] as const) {
      await detail.goto(key, id);
      await detail.tab("Activities");
      await expect(panel.getByText(own.subject)).toBeVisible(); // positive loaded signal first
      // an account's tab also lists its contacts' activities (the contact's account is filled in)
      const expected = key === "accounts" ? [forAccount.id, forContact.id] : [own.id];
      await expect(panel.getByRole("row")).toHaveCount(expected.length + 1); // header + the linked activities
      await expect(panel.getByText(control)).toHaveCount(0);
      expect(idsOf(await api.get(`/modules/${key}/${id}/related/acts`)).sort(), key).toEqual([...expected].sort());
    }

    // Links to another organization's records are rejected (nothing is created)
    const foreignAccount = await build.account(orgB);
    const foreignContact = await build.contact(orgB, foreignAccount.id);
    const foreignOpp = await build.opportunity(orgB, foreignAccount.id);
    const foreignLead = await build.lead(orgB);
    for (const [field, label, id] of [
      ["accountId", "Account", foreignAccount.id], ["contactId", "Contact", foreignContact.id],
      ["opportunityId", "Opportunity", foreignOpp.id], ["mfgLeadId", "Lead", foreignLead.id],
    ] as const) {
      const subject = `${tag} foreign ${field}`;
      const r = await api.post("/modules/activities", { type: "Call", subject, priority: "Low", dueDate: isoDate(1), [field]: id });
      expect(r.status, field).toBe(400);
      expect(ApiClient.message(r)).toBe(`${label} '${id}' not found in your organization.`);
      expect(idsOf(await api.get(`/modules/activities?search=${encodeURIComponent(subject)}`)), `${field}: nothing created`).toEqual([]);
    }
  });

  tc("TC-ACT-007", async ({ page }) => {
    const api = await apiAs("salesExec1");
    // Leftovers of earlier runs (open, due 3000 days ago) would crowd the dashboard's 50-item queue: cancel them first.
    const prefix = "A7STALE";
    for (const stale of (await api.get(`/modules/activities?search=${prefix}&limit=100&status=Open`)).body.data ?? []) {
      ok(await api.action("activities", stale.id as string, "Cancel"), "cancel leftover");
    }
    const tag = `${prefix}-${uniqueTag("A7")}`;
    // Low priority (its pill is gray) and a very old due date, so this activity sorts first in the dashboard's 50-item action queue
    const overdue = await newActivity(api, { subject: `${tag} stale chase`, priority: "Low", dueDate: isoDate(-3000) });
    const later = await newActivity(api, { subject: `${tag} future chase`, priority: "Low", dueDate: isoDate(10) });
    try {
    // Activities list: the overdue row is flagged red (spec). The Due column renders a plain date for every row.
    const list = new ModuleList(page, "activities");
    await list.goto();
    await list.search(tag);
    const row = list.row(overdue.subject);
    await expect(row).toBeVisible();
    await expect(list.row(later.subject)).toBeVisible();
    await expect(row.getByText(/overdue/i).or(row.locator("[class*='destructive'], [class*='text-red'], [class*='bg-red']"))).toBeVisible({ timeout: 1_000 });

    // Dashboard "My day" action queue (50 oldest-due open items, so only the very old overdue item is guaranteed to be listed): it carries the Overdue tag
    const queue = await api.get("/mfg-dashboard/my-day");
    const items = queue.body.actionQueue as { id: string; state: string }[];
    expect(items.find((i) => i.id === overdue.id)?.state).toBe("overdue");
    await page.goto("/");
    const item = (subject: string) => page.locator("div.divide-y > div").filter({ hasText: subject });
    await expect(item(overdue.subject)).toBeVisible();
    await expect(item(overdue.subject)).toContainText("Overdue");
    } finally {
      // cleanup (cancel both), never masking the test result
      for (const a of [overdue, later]) {
        try { await api.action("activities", a.id, "Cancel"); } catch { /* ignore */ }
      }
    }
  });

  tc("TC-ACT-009", async ({ page }) => {
    // Spec: the Activities tab is a chronological timeline of interactions (activities, visits, stage changes) with owner, type, outcome.
    // Current (Partial): the tab is the related list of activities only.
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const opp = await build.opportunity(api, account.id);
    const controlAccount = await build.account(api);
    const control = await build.opportunity(api, controlAccount.id);
    const tag = uniqueTag("A9");
    const link = { opportunityId: opp.id, accountId: account.id };
    const call = await newActivity(api, { subject: `${tag} call`, type: "Call", ...link });
    ok(await api.action("activities", call.id, "Complete", { outcome: `${tag} agreed to a site visit` }), "complete");
    const meeting = await newActivity(api, { subject: `${tag} meeting`, type: "Meeting", ...link });
    const siteVisit = await newActivity(api, { subject: `${tag} visit`, type: "Site visit", ...link });
    await newActivity(api, { subject: `${tag} control`, type: "Call", opportunityId: control.id, accountId: controlAccount.id });
    ok(await api.post("/modules/visits", { title: `${tag} plant survey`, opportunityId: opp.id, accountId: account.id, visitDate: isoDate(2), objective: "Survey" }), "create visit");
    ok(await api.patch(`/modules/opps/${opp.id}`, { stage: "Requirement collected", nextAction: "Follow up", nextActionDate: isoDate(3) }), "stage change");

    const expectedIds = [call.id, meeting.id, siteVisit.id].sort();
    expect(idsOf(await api.get(`/modules/opps/${opp.id}/related/acts`)).sort()).toEqual(expectedIds);
    expect(idsOf(await api.get(`/modules/accounts/${account.id}/related/acts`)).sort()).toEqual(expectedIds);

    const detail = new ModuleDetail(page);
    const panel = page.getByRole("tabpanel");
    for (const [key, id] of [["opps", opp.id], ["accounts", account.id]] as const) {
      await detail.goto(key, id);
      await detail.tab("Activities");
      await expect(panel.getByText(`${tag} call`)).toBeVisible(); // loaded
      await expect(panel.getByRole("row")).toHaveCount(4); // header + the three activities
      for (const [subject, type] of [[`${tag} call`, "Call"], [`${tag} meeting`, "Meeting"], [`${tag} visit`, "Site visit"]]) {
        await expect(panel.getByRole("row").filter({ hasText: subject }), `${key} row ${subject}`).toContainText(type as string);
      }
      await expect(panel.getByText(`${tag} control`)).toHaveCount(0);
    }
    // outcome / visits / stage changes in the timeline (spec) - only activities with type, subject, due date, priority, owner id, status are shown
    await detail.goto("opps", opp.id);
    await detail.tab("Activities");
    await expect(panel.getByText(`${tag} call`)).toBeVisible();
    await knownDefect(test.info(), "D-39", async () => {
      await expect(panel.getByText(`${tag} agreed to a site visit`)).toBeVisible({ timeout: 1_000 }); // outcome of the completed call
    });
    await knownDefect(test.info(), "D-39", async () => {
      await expect(panel.getByText(`${tag} plant survey`)).toBeVisible({ timeout: 1_000 }); // the visit appears on the timeline
    });
    // the visit and the stage change live on their own tabs (they exist)
    await detail.tab("Visits");
    await expect(panel.getByText(`${tag} plant survey`)).toBeVisible();
    await detail.tab("Stage history");
    await expect(panel.getByText("Qualified → Requirement collected")).toBeVisible();
  });
});

test.describe("ACT - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-ACT-008", async ({ page }) => {
    // Escalation levels / breach logging belong to the SLA engine specs (Task 11b); here: the SLA-06 timer of a High-priority activity
    // due now exists and is shown.
    test.info().annotations.push({ type: "note", description: "breach/escalation is covered by the SLA engine specs (Task 11b)" });
    const api = await apiAs("salesManager");
    const subject = `${uniqueTag("A8")} urgent call`;
    const act = await newActivity(api, { subject, priority: "High", dueDate: isoDate(0) });
    // the date-triggered sweep starts the timer once the scheduled time is reached
    await expect.poll(async () => (await slaOf(api, act.id))?.l ?? "", { timeout: 30_000, message: "SLA-06 timer exists" }).toMatch(SLA_STATE);
    expect(["green", "amber", "red"]).toContain((await slaOf(api, act.id))?.t);

    const list = new ModuleList(page, "activities");
    await list.goto();
    await list.search(subject);
    const row = list.row(subject);
    await expect(row).toBeVisible();
    // "Follow-up SLA" column renders the sla object as "[object Object]" instead of the remaining time (D-16)
    await expect(row.getByText(SLA_STATE)).toBeVisible({ timeout: 1_000 });
    const detail = new ModuleDetail(page);
    await detail.goto("activities", act.id);
    await detail.tab("SLA");
    await expect(page.getByRole("tabpanel").getByText(SLA_STATE)).toBeVisible({ timeout: 3_000 });
  });
});
