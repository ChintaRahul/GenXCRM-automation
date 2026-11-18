// e2e/specs/mfg/amc.spec.ts - AMC & warranty coverage (TC-AMC-001..011): create, 90/60/30 reminders, status actions (Mark contacted / renewed / lost),
// renewal opportunity (create, duplicate, wrong status), automation sweep, Quoted/Negotiation reachability, visits used vs included.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { assertNoProviderCredentials, readE2eEnv } from "../../mfg/envGuard";
import { setCoverageStatus, slaTimersOf } from "../../mfg/db";
import { shortId } from "../../mfg/format";
import { expectActionRejected, knownDefect } from "../../mfg/guards";

type Rec = Record<string, unknown>;
type Asset = Awaited<ReturnType<typeof build.asset>>;

const DAY_MS = 86_400_000;
const SLA21 = "Renewal reminders";
// The date sweep is configured for 5 s (backend/.env.e2e.local) but a sweep run takes a while: observed start-to-timer lags of 25-30 s.
const SWEEP_WAIT_MS = 75_000;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
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
const timerOf = async (id: string): Promise<boolean | undefined> => (await slaTimersOf(id)).find((t) => t.name === SLA21)?.open;
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

// One commissioned asset (and account) shared by the cases of this file; every case creates its own coverage on it.
let sharedAsset: Promise<Asset> | undefined;
const asset = (): Promise<Asset> => (sharedAsset ??= build.asset());
const covOf = async (id: string): Promise<Rec> => rec(await (await apiAs("serviceManager")).get(`/modules/amc/${id}`), "read coverage");
/** Coverage of the shared asset created through the API by the Service Manager (it owns it, so it can read it). */
const newCoverage = async (endInDays = 200, over: Rec = {}): Promise<{ id: string; a: Asset }> => {
  const a = await asset();
  const sm = await apiAs("serviceManager");
  const r = rec(await sm.post("/modules/amc", {
    assetId: a.assetId, accountId: a.account.id, type: "AMC", start: isoDate(-165), end: isoDate(endInDays), value: 120_000, visitsIncluded: 4, visitsUsed: 0, ...over,
  }), "create coverage");
  return { id: r.id as string, a };
};
const openCoverage = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("amc", id);
  return detail;
};
/** Reloads the detail page and waits for the loaded header (the status bar renders only after the record arrived). */
const reloaded = async (page: Page): Promise<void> => {
  await page.reload();
  await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
};
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);
const createdOpportunities: string[] = [];
const created: string[] = [];

test.afterAll(async () => {
  await archiveQuietly("amc", created);
  await archiveQuietly("opps", createdOpportunities);
  if (sharedAsset) await archiveQuietly("assets", [(await sharedAsset).assetId]);
});

test.describe("AMC & warranty - Service Manager", () => {
  test.use({ storageState: authFile("serviceManager") });

  tc("TC-AMC-001", async ({ page }) => {
    const a = await asset();
    const sm = await apiAs("serviceManager");
    const day = (n: number): string => new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);
    // AMC -> New: asset, account, type AMC, start, end, value and visits included
    const list = new ModuleList(page, "amc");
    await list.goto();
    await list.clickNew();
    const drawer = new ModuleDrawer(page);
    await drawer.fill({ assetId: a.assetId, accountId: a.account.id, type: "AMC", start: day(0), end: day(365), value: 120000, visitsIncluded: 4 });
    await drawer.save();
    // Spec: the coverage is created (status 'Not due', visits 0/4). The drawer posts the money / number fields as strings and the API rejects them (D-6).
    const covs = async (): Promise<Rec[]> => ok(await sm.get(`/modules/assets/${a.assetId}/related/coverage?limit=100`), "coverages of the asset").body.data ?? [];
    const before = (await covs()).length;
    let saved = false;
    await expect(page).toHaveURL(/\/amc\/[0-9a-f-]{36}$/, { timeout: 8_000 });
    saved = true;
    let id: string;
    if (saved) {
      id = /\/amc\/([0-9a-f-]{36})$/.exec(page.url())?.[1] as string;
    } else {
      await expect(drawer.error, "the drawer reports the failed save").toBeVisible();
      expect(await covs(), "nothing was created by the failed save").toHaveLength(before);
      // the same coverage through the API so the rest of the case (status, visits) is still verified
      id = rec(await sm.post("/modules/amc", { assetId: a.assetId, accountId: a.account.id, type: "AMC", start: isoDate(0), end: isoDate(365), value: 120_000, visitsIncluded: 4 }), "create coverage").id as string;
    }
    created.push(id);
    expect(await covOf(id)).toMatchObject({ assetId: a.assetId, accountId: a.account.id, type: "AMC", status: "Not due", visits: "0/4", visitsIncluded: 4 });
    expect((await covOf(id)).visitsUsed ?? 0, "visits used").toBe(0);
    const detail = await openCoverage(page, id);
    expect(await detail.statusText()).toBe("Not due");
    await list.goto();
    await expect(list.row("0/4").first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Not due" }).filter({ hasText: "0/4" }).first()).toBeVisible();
  });

  tc("TC-AMC-002", async ({ page }) => {
    const { id } = await newCoverage(100); // ends in 100 days
    created.push(id);
    const cov = await covOf(id);
    const end = Date.parse(cov.end as string);
    const events = ok(await (await apiAs("serviceManager")).get(`/modules/amc/${id}/events/reminders`), "reminder events").body as unknown as { label: string; at: string }[];
    // three events at end - 90 / - 60 / - 30 days
    expect(events.map((e) => e.label)).toEqual(["90 days before expiry", "60 days before expiry", "30 days before expiry"]);
    expect(events.map((e) => Date.parse(e.at))).toEqual([90, 60, 30].map((d) => end - d * DAY_MS));
    // UI tab: the same three events, in order
    const detail = await openCoverage(page, id);
    await detail.tab("Renewal reminders");
    const items = page.getByRole("tabpanel").getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("90 days before expiry");
    await expect(items.nth(1)).toContainText("60 days before expiry");
    await expect(items.nth(2)).toContainText("30 days before expiry");
    // the dates shown are end - 90 / - 60 / - 30 (the year of the 90-day event is enough to prove they are rendered from the record)
    await expect(items.nth(0)).toContainText(String(new Date(end - 90 * DAY_MS).getUTCFullYear()));
  });

  tc("TC-AMC-003", async ({ page }) => {
    const { id } = await newCoverage();
    created.push(id);
    const detail = await openCoverage(page, id);
    expect(await detail.statusText()).toBe("Not due");
    await detail.action("Mark contacted");
    await expect.poll(async () => (await covOf(id)).status, { message: "status after Mark contacted" }).toBe("Contacted");
    await reloaded(page);
    expect(await detail.statusText()).toBe("Contacted");
    // not allowed from other statuses: the button is gone and the server refuses (status unchanged)
    await detail.expectNoAction("Mark contacted");
    const sm = await apiAs("serviceManager");
    await expectActionRejected(sm, "amc", id, "Mark contacted", {}, "Cannot Mark contacted coverage in status 'Contacted'.");
    ok(await sm.action("amc", id, "Mark lost", { lost: "Price" }), "mark lost");
    await expectActionRejected(sm, "amc", id, "Mark contacted", {}, "Cannot Mark contacted coverage in status 'Lost'.");
    expect((await covOf(id)).status).toBe("Lost");
  });

  tc("TC-AMC-004", async ({ page }) => {
    const { id, a } = await newCoverage(60, { value: 250_000 });
    created.push(id);
    const sm = await apiAs("serviceManager");
    ok(await sm.action("amc", id, "Mark contacted"), "mark contacted"); // the UI offers the action from Due soon / Contacted
    const detail = await openCoverage(page, id);
    expect(await detail.statusText()).toBe("Contacted");
    await detail.action("Create renewal opportunity");
    // the user is taken to the new opportunity
    await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const oppId = /\/opportunities\/([0-9a-f-]{36})$/.exec(page.url())?.[1] as string;
    createdOpportunities.push(oppId);
    const cov = await covOf(id);
    expect(cov.renewalOpportunityId, "coverage is linked to the opportunity").toBe(oppId);
    // the opportunity as the Director reads it (the Service Manager has no opportunities access)
    const opp = rec(await (await apiAs("director")).get(`/modules/opps/${oppId}`), "read renewal opportunity");
    expect(opp).toMatchObject({ title: "AMC Renewal — Weighbridge", accountId: a.account.id, stage: "Qualified", value: 250_000, nextAction: "Follow up on AMC renewal", ownerId: cov.ownerId });
    expect(Math.abs(Date.parse(opp.closeDate as string) - (Date.now() + 90 * DAY_MS)), "close date about 90 days out").toBeLessThanOrEqual(DAY_MS);
    // the coverage detail shows the link
    await openCoverage(page, id);
    // the Service Manager cannot read opportunities, so the link shows the short id
    await expect(fieldValue(page, "Renewal opportunity")).toHaveText(shortId("OP-", oppId));
  });

  tc("TC-AMC-005", async ({ page }) => {
    const { id } = await newCoverage();
    created.push(id);
    const sm = await apiAs("serviceManager");
    ok(await sm.action("amc", id, "Mark contacted"), "mark contacted");
    const first = rec(await sm.action("amc", id, "Create renewal opportunity"), "create renewal opportunity");
    createdOpportunities.push(first.id as string);
    // the second attempt is rejected with the exact message and creates nothing
    await expectActionRejected(sm, "amc", id, "Create renewal opportunity", {}, `Coverage '${id}' already has a renewal opportunity.`);
    expect((await covOf(id)).renewalOpportunityId, "link unchanged").toBe(first.id);
    const renewalOppIds = async (): Promise<string[]> =>
      (ok(await (await apiAs("director")).get(`/modules/accounts/${String(first.accountId)}/related/opps?limit=100`), "account opportunities").body.data ?? [])
        .filter((o) => o.title === "AMC Renewal — Weighbridge").map((o) => o.id as string).sort();
    const opportunitiesBefore = await renewalOppIds();
    expect(opportunitiesBefore, "the first renewal opportunity exists").toContain(first.id);
    // UI: the button is still offered (Contacted); clicking it again stays on the coverage and changes nothing
    const detail = await openCoverage(page, id);
    await detail.action("Create renewal opportunity");
    await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/amc/${id}$`));
    expect((await covOf(id)).renewalOpportunityId, "link unchanged after the second UI click").toBe(first.id);
    expect(await renewalOppIds(), "no second renewal opportunity was created").toEqual(opportunitiesBefore);
  });

  tc("TC-AMC-006", async () => {
    const sm = await apiAs("serviceManager");
    // Lost coverage
    const lost = await newCoverage();
    created.push(lost.id);
    ok(await sm.action("amc", lost.id, "Mark lost", { lost: "Price" }), "mark lost");
    await expectActionRejected(sm, "amc", lost.id, "Create renewal opportunity", {}, "Cannot create a renewal opportunity for a coverage in status 'Lost'.");
    expect((await covOf(lost.id)).renewalOpportunityId, "no opportunity linked").toBeNull();
    // Renewed coverage (no route reaches Renewed through the API, D-104: the status of this throwaway row is set directly in the isolated DB)
    const renewed = await newCoverage();
    created.push(renewed.id);
    await setCoverageStatus(renewed.id, "Renewed");
    expect((await covOf(renewed.id)).status).toBe("Renewed");
    await expectActionRejected(sm, "amc", renewed.id, "Create renewal opportunity", {}, "Cannot create a renewal opportunity for a coverage in status 'Renewed'.");
    expect((await covOf(renewed.id)).renewalOpportunityId, "no opportunity linked").toBeNull();
  });

  tc("TC-AMC-007", async ({ page }) => {
    test.setTimeout(180_000);
    assertNoProviderCredentials(); // SLA-21 escalation emails are the reachable SES path
    const sm = await apiAs("serviceManager");
    // from Contacted: rejected, status unchanged, button not offered
    const contacted = await newCoverage();
    created.push(contacted.id);
    ok(await sm.action("amc", contacted.id, "Mark contacted"), "mark contacted");
    await expectActionRejected(sm, "amc", contacted.id, "Mark renewed", {}, "Cannot Mark renewed coverage in status 'Contacted'.");
    expect((await covOf(contacted.id)).status).toBe("Contacted");
    const detail = await openCoverage(page, contacted.id);
    await detail.expectNoAction("Mark renewed");
    // from Negotiation: Renewed, and SLA-21 stops. The coverage ends within 90 days so the date sweep (5 s, backend/.env.e2e.local) starts SLA-21 first.
    // Negotiation is unreachable through the API (D-104): set on this throwaway row directly in the isolated DB.
    const negotiating = await newCoverage(60);
    created.push(negotiating.id);
    await setCoverageStatus(negotiating.id, "Negotiation");
    const running = await eventually(() => timerOf(negotiating.id), (v) => v === true, SWEEP_WAIT_MS);
    if (running !== true) throw new Error(`precondition: the date sweep did not start SLA-21 for a coverage ending in 60 days within ${SWEEP_WAIT_MS / 1000} s`);
    const page2 = await openCoverage(page, negotiating.id);
    expect(await page2.statusText()).toBe("Negotiation");
    await page2.action("Mark renewed");
    await expect.poll(async () => (await covOf(negotiating.id)).status, { message: "status after Mark renewed" }).toBe("Renewed");
    expect(await timerOf(negotiating.id), "SLA-21 stopped").toBe(false);
    await reloaded(page);
    expect(await page2.statusText()).toBe("Renewed");
  });

  tc("TC-AMC-008", async ({ page }) => {
    const sm = await apiAs("serviceManager");
    const { id } = await newCoverage(60);
    created.push(id);
    // blank reason: refused by the server (and by the UI: Confirm stays disabled)
    await expectActionRejected(sm, "amc", id, "Mark lost", {}, "'lost' is required to Mark lost.");
    await expectActionRejected(sm, "amc", id, "Mark lost", { lost: "" }, "'lost' is required to Mark lost.");
    expect((await covOf(id)).status, "status unchanged").toBe("Not due");
    const detail = await openCoverage(page, id);
    await detail.action("Mark lost");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await detail.answerPrompt("Competitor");
    await expect.poll(async () => (await covOf(id)).status, { message: "status after Mark lost with a reason" }).toBe("Lost");
    expect((await covOf(id)).lostReason).toBe("Competitor");
    await reloaded(page);
    expect(await detail.statusText()).toBe("Lost");
    // from Lost / Renewed it is not allowed
    await detail.expectNoAction("Mark lost");
    await expectActionRejected(sm, "amc", id, "Mark lost", { lost: "Price" }, "Cannot Mark lost coverage in status 'Lost'.");
    const renewed = await newCoverage();
    created.push(renewed.id);
    await setCoverageStatus(renewed.id, "Renewed"); // D-104
    await expectActionRejected(sm, "amc", renewed.id, "Mark lost", { lost: "Price" }, "Cannot Mark lost coverage in status 'Renewed'.");
    // allowed from any other status, e.g. Contacted
    const contacted = await newCoverage();
    created.push(contacted.id);
    ok(await sm.action("amc", contacted.id, "Mark contacted"), "mark contacted");
    ok(await sm.action("amc", contacted.id, "Mark lost", { lost: "Budget" }), "mark lost from Contacted");
    expect(await covOf(contacted.id)).toMatchObject({ status: "Lost", lostReason: "Budget" });
  });

  tc("TC-AMC-009", async () => {
    test.setTimeout(200_000);
    // Guard + positive observation that the date sweep runs on a short interval (the default is 1 h; the 5 s value lives only in backend/.env.e2e.local).
    assertNoProviderCredentials(); // escalation emails are the reachable SES path
    const sweepMs = Number(readE2eEnv().SLA_DATE_SWEEP_MS);
    if (!(sweepMs <= 10_000)) throw new Error(`SLA_DATE_SWEEP_MS must be set to <= 10000 in backend/.env.e2e.local (found ${sweepMs})`);
    const director = await apiAs("director");
    const a = await asset();
    const countOf = async (tab: "opps" | "acts"): Promise<number> => ok(await director.get(`/modules/accounts/${a.account.id}/related/${tab}?limit=100`), `account ${tab}`).body.data?.length ?? 0;
    const [oppsBefore, actsBefore] = [await countOf("opps"), await countOf("acts")]; // the account is shared by the cases of this file
    const control = await newCoverage(200); // outside the 90-day window
    const near = await newCoverage(60); // inside the window
    created.push(control.id, near.id);
    const swept = await eventually(() => timerOf(near.id), (v) => v === true, SWEEP_WAIT_MS);
    if (swept !== true) throw new Error(`precondition: the date sweep did not start SLA-21 for a coverage ending in 60 days within ${SWEEP_WAIT_MS / 1000} s`);
    await sleep(sweepMs + 1_000); // one more sweep cycle: both coverages have now been seen by the sweep
    // current: the sweep only starts the SLA-21 reminder timer; the coverage outside the window has none
    expect(await timerOf(control.id), "no SLA-21 timer for a coverage ending in 200 days").toBeUndefined();
    // Spec: the status moves to Due soon and a renewal task / opportunity is created automatically (D-105: neither happens)
    const cov = await covOf(near.id);
    const [oppsAfter, actsAfter] = [await countOf("opps"), await countOf("acts")];
    if (cov.status !== "Due soon") expect([cov.status, cov.renewalOpportunityId, oppsAfter - oppsBefore, actsAfter - actsBefore], "current: status stays 'Not due', nothing auto-created (remove with D-105)").toEqual(["Not due", null, 0, 0]);
    await knownDefect(test.info(), "D-105", async () => {
      expect(cov.status, "status of a coverage ending in 60 days after the sweep").toBe("Due soon");
      expect(cov.renewalOpportunityId !== null || oppsAfter > oppsBefore || actsAfter > actsBefore, "renewal opportunity or task created automatically").toBe(true);
    });
  });

  tc("TC-AMC-010", async ({ page }) => {
    const sm = await apiAs("serviceManager");
    const { id } = await newCoverage();
    created.push(id);
    ok(await sm.action("amc", id, "Mark contacted"), "mark contacted");
    // there is no action to Quoted / Negotiation, and no edit route either: the API refuses a status edit and the UI offers only the existing actions
    const refused = await sm.patch(`/modules/amc/${id}`, { status: "Quoted" });
    if (refused.status !== 200) expect([refused.status, JSON.stringify(refused.body.message)], "current: status edits are refused (remove with D-104)").toEqual([400, expect.stringContaining("property status should not exist")]);
    await expectActionRejected(sm, "amc", id, "Mark quoted", {}, "Unknown action 'Mark quoted' for coverage.");
    expect((await covOf(id)).status).toBe("Contacted");
    const detail = await openCoverage(page, id);
    expect(await detail.statusText()).toBe("Contacted");
    for (const label of ["Create renewal opportunity", "Mark lost"]) await detail.expectAction(label);
    for (const label of ["Mark contacted", "Mark renewed", "Mark quoted", "Start negotiation"]) await detail.expectNoAction(label);
    // Spec: Quoted / Negotiation are reachable (manually or through the renewal opportunity's progress). Creating the opportunity and advancing it does not move the coverage either.
    await knownDefect(test.info(), "D-104", async () => {
      expect(refused.status, "PATCH status Quoted").toBe(200);
      expect((await covOf(id)).status).toBe("Quoted");
    });
    await detail.action("Edit");
    await expect(page.locator("#assetId")).toBeVisible();
    await knownDefect(test.info(), "D-104", async () => {
      await expect(page.locator("#status")).toBeVisible({ timeout: 1_000 });
    });
  });

  tc("TC-AMC-011", async ({ page }) => {
    const { id } = await newCoverage(200, { visitsIncluded: 4, visitsUsed: 0 });
    created.push(id);
    const sm = await apiAs("serviceManager");
    // Update visits used to 2 in the edit drawer
    const detail = await openCoverage(page, id);
    await detail.action("Edit");
    await expect(page.locator("#visitsUsed")).toBeVisible();
    await new ModuleDrawer(page).fill({ visitsUsed: 2 });
    await new ModuleDrawer(page).save();
    // the drawer posts number fields as strings and the API rejects them (D-6): the edit is then made through the API
    let uiSaved = true;
    try {
      await expect.poll(async () => (await covOf(id)).visitsUsed, { timeout: 8_000 }).toBe(2);
    } catch {
      uiSaved = false;
    }
    expect(uiSaved, "the edit drawer saved visits used = 2").toBe(true);
    if (!uiSaved) ok(await sm.patch(`/modules/amc/${id}`, { visitsUsed: 2 }), "set visits used through the API");
    expect(await covOf(id)).toMatchObject({ visitsUsed: 2, visitsIncluded: 4, visits: "2/4" });
    // the Visits column shows 2/4
    const list = new ModuleList(page, "amc");
    await list.goto();
    await expect(page.getByRole("row").filter({ hasText: "2/4" }).first()).toBeVisible();
  });
});
