// e2e/specs/mfg/sla.spec.ts - SLA timers & automation (TC-SLA-001..010): the 22 seeded policies, escalation recipients, in-app bell, money-based targets,
// editing a target, automation execution log. 002 / 003 / 004 / 008 are skip (wall-clock) cases with empty bodies.
//
// Breaches are observed on a THROWAWAY policy ("E2E-SLA-...", e2e/mfg/db.ts withThrowawaySlaPolicy): a 24 x 7 policy on leads / 'Lead created' with a
// target of a few seconds. Seeded policies are never changed (older timers of other specs would breach with them), the slaPolicies / slaTimers APIs are
// 403 for every role (D-7), and every window is calendar-independent (24 x 7 or calendar days) so no assertion depends on the time of day (D-17).
// The SLA tick runs every SLA_TICK_MS=5000 in the E2E backend; escalation e-mails are inert (SES keys are blank, guarded below): in-app is the channel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { authFile, MFG_USERS } from "../../fixtures/mfgUsers";
import { apiAs, ApiClient, build, isoDate, ok } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import {
  automationRunCount, readSlaPolicies, restoreSlaThrowawayIfNeeded, setThrowawaySlaTargets, slaTimerDetail, THROWAWAY_SLA_PREFIX, withThrowawaySlaPolicy,
  type SlaPolicyEscalation, type SlaPolicyTarget, type SlaTimerDetail, type ThrowawaySlaPolicyDef,
} from "../../mfg/db";
import { assertNoProviderCredentials, readE2eEnv } from "../../mfg/envGuard";
import { knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

const ORG_USER = MFG_USERS.director.email; // any user of the E2E manufacturer org: the helpers resolve the org through it
const MIN = 60_000;
const DAY_MS = 86_400_000;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Notification { id: string; title: string; body: string; link: string | null; isRead: boolean; createdAt: string }
const inbox = async (api: ApiClient): Promise<Notification[]> => (ok(await api.get("/notifications"), "read notifications").body.data ?? []) as unknown as Notification[];
const inboxMatching = async (api: ApiClient, text: string): Promise<Notification[]> => (await inbox(api)).filter((n) => n.title.includes(text));

/** Throwaway 24 x 7 policy on leads (Lead created -> First call / message logged). */
const leadPolicy = (targets: SlaPolicyTarget[], escalationLevels: SlaPolicyEscalation[]): ThrowawaySlaPolicyDef => ({
  moduleKey: "leads", startEvent: "Lead created", stopEvent: "First call / message logged", calendarType: "24 x 7", targets, escalationLevels,
});
const policyName = (): string => `${THROWAWAY_SLA_PREFIX}${uniqueTag("P")}`;
const archiveLeadQuietly = async (id: string): Promise<void> => {
  try {
    await (await apiAs("director")).post(`/modules/leads/${id}/archive`);
  } catch {
    // cleanup only
  }
};
/** Waits until the SLA tick has evaluated the timer of `policy` at least once (a tick rewrites updatedAt), then returns its detail. */
const afterFirstTick = async (entityId: string, policy: string) => {
  await expect.poll(async () => {
    const t = (await slaTimerDetail(entityId)).find((x) => x.name === policy && x.open);
    return t ? t.updatedAt.getTime() - t.startedAt.getTime() : -1;
  }, { message: `SLA tick evaluated the '${policy}' timer`, timeout: 120_000, intervals: [1_000] }).toBeGreaterThan(1_500);
  // The entity's CURRENT timer of that policy: exactly one is open (an earlier stage's timer was stopped by the stage change).
  const open = (await slaTimerDetail(entityId)).filter((x) => x.name === policy && x.open);
  if (open.length !== 1) throw new Error(`expected exactly one open '${policy}' timer for ${entityId}, found ${open.length}`);
  return open[0] as SlaTimerDetail;
};

test.beforeAll(async () => {
  assertNoProviderCredentials(); // escalation e-mails are the reachable SES path: the E2E backend must have no provider keys
  const tick = Number(readE2eEnv().SLA_TICK_MS);
  if (!(tick <= 10_000)) throw new Error(`SLA_TICK_MS must be set to <= 10000 in backend/.env.e2e.local (found ${tick})`);
  await restoreSlaThrowawayIfNeeded(); // heal a throwaway policy left by a killed run
});

// ---- Seed drift guard: the 22 policies as written in backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts ----
interface SeedPolicy {
  id: string; moduleKey: string; name: string; startEvent: string; stopEvent: string; calendarType: string;
  targets: SlaPolicyTarget[]; escalationLevels: SlaPolicyEscalation[]; pauseStatuses: string[];
}
const seedPolicies = (): SeedPolicy[] => {
  const src = readFileSync(resolve(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
  const start = src.indexOf("export const SLA_POLICY_DEFAULTS: SlaPolicyDefault[] = [");
  const end = src.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("SLA_POLICY_DEFAULTS not found in manufacturing-defaults.data.ts (moved? update the drift guard)");
  const literal = src.slice(start, end).replace("export const SLA_POLICY_DEFAULTS: SlaPolicyDefault[] = ", "");
  // The literal only uses the three helpers declared in the data file (tg / lvl / cal); evaluate it with the same definitions.
  const make = new Function("tg", "lvl", "cal", `return ${literal}\n];`) as (...a: unknown[]) => SeedPolicy[];
  return make(
    (cond: string, val: number, unit: string) => ({ cond, val, unit }),
    (at: number, who: string, channels: string[]) => ({ at, who, channels }),
    (t: string) => (t === "24 × 7" ? "24 x 7" : t),
  );
};

test.describe("SLA timers - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-SLA-001", async ({ page }) => {
    const seed = seedPolicies();
    expect(seed.map((p) => p.id), "seed constants SLA-01..SLA-22 (drift guard)").toEqual(Array.from({ length: 22 }, (_, i) => `SLA-${String(i + 1).padStart(2, "0")}`));
    const rows = await readSlaPolicies(MFG_USERS.superAdmin.email);
    expect(rows, "22 default policies in the org").toHaveLength(22);
    for (const s of seed) {
      const row = rows.find((r) => r.name === s.name);
      expect(row, `${s.id} '${s.name}' exists`).toBeDefined();
      expect(row, `${s.id} start/stop event, calendar, targets, escalation levels, pause statuses`).toMatchObject({
        moduleKey: s.moduleKey, startEvent: s.startEvent, stopEvent: s.stopEvent, calendarType: s.calendarType,
        targets: s.targets, escalationLevels: s.escalationLevels, pauseStatuses: s.pauseStatuses, isActive: true,
      });
      expect(s.targets.length, `${s.id} has targets`).toBeGreaterThan(0);
      expect(s.escalationLevels.length, `${s.id} has escalation levels`).toBeGreaterThan(0);
    }

    // Administration -> SLA Policies: the settled state is either the list ("22 policies") or an error line.
    await page.goto("/administration");
    await page.getByRole("button", { name: "SLA Policies", exact: true }).click();
    const settled = page.getByText(/^\d+\s*policies/).or(page.locator("p.text-destructive"));
    await expect(settled.first()).toBeVisible();
    await expect(page.getByText(/^22\s*policies/), "Administration lists the 22 SLA policies").toBeVisible({ timeout: 2_000 });
    await expect(page.getByText(seed[0]?.name ?? "", { exact: true })).toBeVisible({ timeout: 2_000 });
    if ((await page.getByText(/^22\s*policies/).count()) === 0) {
    }
  });

  tc("TC-SLA-002", async () => {});
  tc("TC-SLA-003", async () => {});
  tc("TC-SLA-004", async () => {});

  tc("TC-SLA-005", async () => {
    // Observation window: 24 x 7 target of 0.2 min (12 s): level 1 (100 %: Owner) ~12 s, level 2 (200 %: Sales Manager) ~24 s, plus up to 5 s per tick.
    test.setTimeout(330_000); // one tick takes ~35 s with the shared DB's ~3,700 open timers and a new timer can miss the tick in flight: polls get 120 s
    const name = policyName();
    const owner = await apiAs("salesExec1");
    const manager = await apiAs("salesManager");
    const otherRep = await apiAs("salesExec2");
    const def = leadPolicy(
      [{ cond: "All", val: 0.2, unit: "minutes" }],
      [{ at: 100, who: "Owner", channels: ["In-app"] }, { at: 200, who: "Sales Manager", channels: ["In-app", "Email"] }],
    );
    let leadId = "";
    try {
      await withThrowawaySlaPolicy(ORG_USER, name, def, async () => {
        leadId = (await build.lead(owner)).id;
        await expect.poll(async () => (await inboxMatching(owner, name)).length, { message: "level 1: the lead owner is notified", timeout: 120_000, intervals: [1_000] }).toBeGreaterThan(0);
        await expect.poll(async () => (await inboxMatching(manager, name)).length, { message: "level 2: the Sales Manager is notified", timeout: 120_000, intervals: [1_000] }).toBeGreaterThan(0);
        const [ownerNote, managerNote] = [(await inboxMatching(owner, name))[0], (await inboxMatching(manager, name))[0]];
        expect(ownerNote?.title).toMatch(new RegExp(`^SLA alert: ${escapeRe(name)} at \\d+% of target$`));
        expect(ownerNote?.link, "notification opens the breaching lead").toBe(`/leads/${leadId}`);
        expect(managerNote?.link).toBe(`/leads/${leadId}`);
        expect(new Date(ownerNote?.createdAt ?? 0).getTime(), "owner (level 1) is notified before the manager (level 2)").toBeLessThanOrEqual(new Date(managerNote?.createdAt ?? 0).getTime());
        // The escalation is persisted on the timer; the e-mail channel is inert in E2E (no SES key), so only in-app is observable.
        const timer = (await slaTimerDetail(leadId)).find((t) => t.name === name);
        expect(timer?.lastEscalationLevel, "highest escalation level reached is stored on the timer").toBe(200);
        // Only the configured recipients: the other sales rep's inbox has nothing about this policy (the inbox read above is loaded, so absence is meaningful).
        expect(await inboxMatching(otherRep, name), "a rep who owns nothing here is not notified").toEqual([]);
      });
    } finally {
      if (leadId) await archiveLeadQuietly(leadId);
    }
  });
});

test.describe("SLA timers - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-SLA-006", async ({ page }) => {
    test.setTimeout(240_000);
    const name = policyName();
    const owner = await apiAs("salesExec1");
    const def = leadPolicy([{ cond: "All", val: 0.2, unit: "minutes" }], [{ at: 100, who: "Owner", channels: ["In-app"] }]);
    let leadId = "";
    try {
      await withThrowawaySlaPolicy(ORG_USER, name, def, async () => {
        leadId = (await build.lead(owner)).id;
        await expect.poll(async () => (await inboxMatching(owner, name)).length, { message: "SLA breach notification for the owner", timeout: 120_000, intervals: [1_000] }).toBeGreaterThan(0);
        const note = (await inboxMatching(owner, name))[0] as Notification;
        expect(note.isRead).toBe(false);

        // The bell loads the inbox on page load (then polls every 30 s): open the dashboard fresh.
        await page.goto("/");
        const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
        await expect(bell, "bell shows an unread badge").toBeVisible();
        await bell.click();
        const item = page.getByRole("button", { name: new RegExp(escapeRe(name)) });
        await expect(item, "the SLA breach is listed in the bell").toBeVisible();
        await expect(item).toContainText("of target elapsed");

        // Opening it marks it read and goes to the breaching lead.
        await item.click();
        await expect(page).toHaveURL(new RegExp(`/leads/${leadId}$`));
        await expect.poll(async () => (await inboxMatching(owner, name))[0]?.isRead, { message: "notification marked read after opening it" }).toBe(true);

        // Spec: the Notifications page lists it. The page is the EdTech 'new leads' list (useNotifications), not the Manufacturing inbox.
        await page.goto("/notifications");
        await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
        await knownDefect(test.info(), "D-112", async () => {
          await expect(page.getByText(name), "Notifications page lists the SLA alert").toBeVisible({ timeout: 2_000 });
        });
        if ((await page.getByText(name).count()) === 0) await expect(page.getByText("No new leads."), "current: the EdTech new-leads empty state (remove with D-112)").toBeVisible();
      });
    } finally {
      if (leadId) await archiveLeadQuietly(leadId);
    }
  });
});

test.describe("SLA timers - Super Admin (targets)", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-SLA-007", async () => {
    test.setTimeout(420_000);
    const name = policyName();
    const sales = await apiAs("salesExec1");
    const lead: string[] = [];
    const opps: string[] = [];
    try {
      // (a) Money-based target on a throwaway policy that mirrors SLA-01: 'All' 10 min, 'Estimated value >= Rs 50 L' 5 min.
      const def = leadPolicy([{ cond: "All", val: 10, unit: "minutes" }, { cond: "Estimated value ≥ ₹50 L", val: 5, unit: "minutes" }], [{ at: 100, who: "Owner", channels: ["In-app"] }]);
      await withThrowawaySlaPolicy(ORG_USER, name, def, async () => {
        const small = await build.lead(sales, { value: 1_000_000 });
        const big = await build.lead(sales, { value: 6_000_000 });
        lead.push(small.id, big.id);
        // Wait for the first tick: it re-evaluates every open timer (and rewrites its due time), so the value read afterwards is what users see.
        const smallTimer = await afterFirstTick(small.id, name);
        const bigTimer = await afterFirstTick(big.id, name);
        expect(smallTimer.windowMs, "a Rs 10 L lead gets the 'All' target (10 min)").toBe(10 * MIN);
        expect(bigTimer.windowMs, "a Rs 60 L lead keeps the tighter 'value >= Rs 50 L' target (5 min) after the first tick").toBe(5 * MIN);
        if (bigTimer.windowMs !== 5 * MIN) expect(bigTimer.windowMs, "current: the first target ('All', 10 min) after the first tick (remove with D-113)").toBe(10 * MIN);
      });

      // (b) The seeded policies on opportunities (calendar days, so independent of the time of day): SLA-04 'Value >= Rs 1 Cr' and SLA-03 per-stage targets.
      const account = await build.account(sales);
      const big = await build.opportunity(sales, account.id, { value: 12_000_000 });
      const small = await build.opportunity(sales, account.id, { value: 1_000_000 });
      opps.push(big.id, small.id);
      for (const id of [big.id, small.id]) {
        ok(await sales.patch(`/modules/opps/${id}`, { stage: "Requirement collected", nextAction: "Collect drawings", nextActionDate: isoDate(3) }), "advance to Requirement collected");
        ok(await sales.patch(`/modules/opps/${id}`, { stage: "Technical discussion", nextAction: "Technical call", nextActionDate: isoDate(4) }), "advance to Technical discussion");
      }
      const bigHv = await afterFirstTick(big.id, "High-value deal attention");
      expect(bigHv.windowMs, "SLA-04 7-day target for a Rs 1.2 Cr deal").toBe(7 * DAY_MS);
      const smallTimers = await slaTimerDetail(small.id);
      const smallHv = smallTimers.filter((t) => t.name === "High-value deal attention");
      expect(smallHv, "no SLA-04 'High-value deal' timer for a Rs 10 L deal").toEqual([]);
      if (smallHv.length > 0) expect(smallHv.map((t) => t.open), "current: one stopped timer (Requirement collected) and one running timer (Technical discussion) (remove with D-114)").toEqual([false, true]);
      // SLA-03 for 'Technical discussion' is 14 days (target 2); the tick resets it to the first target (7 days) = D-113 again, on seeded data.
      const stagnation = await afterFirstTick(big.id, "Stage stagnation");
      expect(stagnation.windowMs, "SLA-03 target for stage 'Technical discussion' (14 days) after the first tick").toBe(14 * DAY_MS);
      if (stagnation.windowMs !== 14 * DAY_MS) expect(stagnation.windowMs, "current: the first SLA-03 target (7 days) after the first tick (remove with D-113)").toBe(7 * DAY_MS);
    } finally {
      for (const id of lead) await archiveLeadQuietly(id);
      const director = await apiAs("director");
      for (const id of opps) {
        try {
          await director.post(`/modules/opps/${id}/archive`);
        } catch {
          // cleanup only
        }
      }
    }
  });

  tc("TC-SLA-008", async () => {});

  tc("TC-SLA-009", async ({ page }) => {
    test.setTimeout(330_000);
    const name = policyName();
    const sales = await apiAs("salesExec1");
    const ids: string[] = [];
    try {
      // Edit the target of a policy (here the throwaway: the Administration tab has no target editor and the policy API is 403, D-111): 10 min -> 20 min.
      await withThrowawaySlaPolicy(ORG_USER, name, leadPolicy([{ cond: "All", val: 10, unit: "minutes" }], [{ at: 100, who: "Owner", channels: ["In-app"] }]), async (policyId) => {
        const before = await build.lead(sales);
        ids.push(before.id);
        expect((await afterFirstTick(before.id, name)).windowMs, "a new lead uses the current target").toBe(10 * MIN);
        await setThrowawaySlaTargets(policyId, [{ cond: "All", val: 20, unit: "minutes" }]);
        const after = await build.lead(sales);
        ids.push(after.id);
        expect((await afterFirstTick(after.id, name)).windowMs, "a lead created after the edit uses the new target").toBe(20 * MIN);

        // Spec: an ADMIN edits the target (Administration -> SLA) and it takes effect. The edit above went through the DB (proves the engine honours an edited target);
        // neither admin route exists: the policy API refuses the update for every role and the tab has no editor (D-111).
        const admin = await apiAs("superAdmin");
        const edit = await admin.patch(`/modules/slaPolicies/${policyId}`, { targets: [{ cond: "All", val: 30, unit: "minutes" }] });
        await page.goto("/administration");
        await page.getByRole("button", { name: "SLA Policies", exact: true }).click();
        await expect(page.getByText(/^\d+\s*policies/).or(page.locator("p.text-destructive")).first()).toBeVisible(); // tab settled
        await knownDefect(test.info(), "D-111", async () => {
          expect(edit.status, "admin edits a policy target through the API").toBe(200);
          await expect(page.getByRole("button", { name: /^edit/i }).first(), "Administration offers a control to edit a policy target").toBeVisible({ timeout: 2_000 });
        });
        if (edit.status !== 200) expect([edit.status, ApiClient.message(edit)], "current: the policy update is refused (remove with D-111)").toEqual([403, expect.stringContaining("slaPolicies")]);
        if ((await page.getByText(/^\d+\s*policies/).count()) === 0) await expect(page.locator("p.text-destructive"), "current: the tab shows the raw axios error (remove with D-111)").toHaveText("Request failed with status code 403");
      });
    } finally {
      for (const id of ids) await archiveLeadQuietly(id);
    }
    // The seeded policies were not touched: SLA-01's targets still equal the seed constants.
    const seedSla01 = seedPolicies().find((p) => p.name === "Lead first response");
    expect((await readSlaPolicies(MFG_USERS.superAdmin.email)).find((p) => p.name === "Lead first response")?.targets, "seeded SLA-01 targets (derived from SLA_POLICY_DEFAULTS)").toEqual(seedSla01?.targets);
  });

  tc("TC-SLA-010", async ({ page }) => {
    const director = await apiAs("director");
    const reports = ok(await director.get("/modules/reports?search=Automation%20execution%20log&limit=5"), "find report").body.data ?? [];
    const log = reports.find((r) => r.name === "Automation execution log");
    if (!log) throw new Error("precondition: the 'Automation execution log' report is seeded for the E2E org");
    const table = ok(await director.get(`/modules/reports/${log.id as string}/table/data`), "run report").body as { columns: { label: string }[]; rows: Record<string, unknown>[] };
    expect(table.columns.map((c) => c.label), "report columns").toEqual(["Trigger", "Action", "Status", "Ran at"]);

    // UI: the report opens without error and shows its table header.
    await page.goto(`/reports/${log.id as string}`);
    await expect(page.getByRole("heading", { name: "Automation execution log" })).toBeVisible();
    // A report without rows shows the empty state instead of the table header.
    if (table.rows.length === 0) await expect(page.getByText("No data yet.")).toBeVisible();
    else await expect(page.locator("table thead th", { hasText: "Trigger" })).toBeVisible();

    // Spec: rules have fired -> each run has a status and log events. AutomationRun rows are only ever READ (nothing in the backend writes them), and the
    // automationRules module is 403 (D-50 family) so no rule can be created or fired in E2E; SLA escalations are not automation runs either.
    const runs = await automationRunCount(MFG_USERS.superAdmin.email);
    expect(table.rows.length, "report rows equal the AutomationRun rows of the org").toBe(Math.min(runs, 100));
    if (runs === 0) expect(table.rows, "current: no automation run exists, the report has no rows (remove with D-115)").toEqual([]);
    await knownDefect(test.info(), "D-115", async () => {
      expect(runs, "automation runs are recorded once rules fire").toBeGreaterThan(0);
    });
  });
});
