// e2e/specs/mfg/dsh.spec.ts - Dashboards (TC-DSH-001..008): My day (Sales Executive), Team (Director / Sales Manager), weighted pipeline, funnel, drill-down,
// hierarchy scoping, target vs achievement (gap), deals needing attention.
// The dashboards aggregate the whole org's data and the DB is never reset, so every number is asserted as a before / after DELTA around records created
// under a unique tag (the suite is serial; only the SLA engine runs in the background and it does not change pipeline or lead counts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { authFile, MFG_PASSWORD, MFG_USERS } from "../../fixtures/mfgUsers";
import { apiAs, build, isoDate, ok, type ApiClient } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
interface Team {
  kpis: {
    newLeads: number; qualifiedLeads: number; qualificationRatePct: number; activePipeline: number; weightedPipeline: number;
    quotationsIssued: { count: number; revised: number }; poBooked: { count: number; value: number };
    wonLost: { won: number; lost: number; winRatePct: number; wonValue: number }; outstanding: { amount: number; overdueAmount: number; overdueCount: number };
  };
  funnel: { label: string; count: number; conversionPct: number | null }[];
  aging: { group: string; buckets: { bucket: string; count: number }[] }[];
  teamPerformance: unknown[]; pendingApprovals: unknown[]; overduePayments: unknown[];
}
interface MyDay {
  kpis: {
    dueToday: number; overdueCount: number; newLeadsToContact: number; leadsPastSla: number;
    quotesAwaitingReply: { count: number; value: number }; posExpectedThisMonth: { count: number; value: number };
    quarterTarget: { pct: number; booked: number; target: number };
  };
  actionQueue: { id: string; subject: string; state: string }[];
  dealsNeedingAttention: { id: string; title: string; reason: string; value: number }[];
  visitsAndTrials: { id: string; kind: string; title: string }[];
  pipelineByPhase: { phase: string; total: number }[];
}

const teamOf = async (api: ApiClient): Promise<Team> => ok(await api.get("/mfg-dashboard/team"), "team dashboard").body as unknown as Team;
const myDayOf = async (api: ApiClient): Promise<MyDay> => ok(await api.get("/mfg-dashboard/my-day"), "my-day dashboard").body as unknown as MyDay;
/** My day's action queue shows only the 50 oldest open activities and the DB is never reset, so older runs' follow-ups could push this test's own out of view (TC-DSH-001 failed in run 4 with 339 open).
 * Cancel the rep's open activities (E2E data only) until nothing cancellable is left. Archived activities still listed by the queue answer 404 (defect D-139) and are skipped; the queue must keep room for this test's two rows. */
const clearActionQueue = async (api: ApiClient): Promise<void> => {
  for (let round = 0; round < 20; round += 1) {
    const { actionQueue } = await myDayOf(api);
    let cancelled = 0;
    for (const a of actionQueue) {
      const r = await api.action("activities", a.id, "Cancel");
      if (r.status === 404) continue; // archived but still shown (D-139)
      ok(r, `cancel activity ${a.subject}`);
      cancelled += 1;
    }
    if (cancelled === 0) {
      expect(actionQueue.length, "action queue has room for this test's two follow-ups").toBeLessThanOrEqual(45);
      return;
    }
  }
  throw new Error("could not empty the My day action queue");
};
const totalOf = async (api: ApiClient, key: string, query = ""): Promise<number> => (ok(await api.get(`/modules/${key}?limit=1${query}`), `${key} list`).body.total ?? NaN) as number;
const userIdOf = async (api: ApiClient): Promise<string> => {
  const payload = JSON.parse(Buffer.from(api.token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error("no user id in the JWT");
  return id;
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
// Same abbreviations as frontend/src/lib/format.ts rupeeShort (what the tiles print).
const rupeeShort = (n: number): string => (n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : n >= 1_000 ? `₹${(n / 1_000).toFixed(1)}k` : `₹${n.toLocaleString("en-IN")}`);
const tile = (page: Page, title: string): Locator => page.locator(".rounded-xl").filter({ has: page.getByText(title, { exact: true }) }).first();
const openTeam = async (page: Page): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(page.getByText("Conversion funnel", { exact: true })).toBeVisible(); // team view loaded
};
/** Stage probability from the seeded masters, read from the backend seed so a changed probability fails here first (drift guard). */
const stageProbability = (stage: string): number => {
  const src = readFileSync(resolve(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
  const m = new RegExp(`\\['${stage}', (\\d+)\\]`).exec(src);
  if (!m) throw new Error(`stage '${stage}' not found in STAGES (manufacturing-defaults.data.ts)`);
  return Number(m[1]);
};

test.describe("Dashboard - Sales Executive (My day)", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-DSH-001", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const otherRep = await apiAs("salesExec2");
    const tag = uniqueTag("DSH1");
    const created: Record<string, string[]> = { opps: [], leads: [], visits: [], demos: [] };
    const activities: string[] = [];
    try {
      await clearActionQueue(sales);
      const before = await myDayOf(sales);
      const account = await build.account(sales);
      // a big deal whose next action is overdue (listed under 'Deals needing attention'), a new lead, a visit and a trial this week, one overdue and one due-today follow-up
      const opp = await build.opportunity(sales, account.id, { title: `${tag} overdue next action`, value: 250_000_000, nextActionDate: isoDate(-2) });
      created.opps?.push(opp.id);
      created.leads?.push((await build.lead(sales)).id);
      const visit = await build.visit(sales, { accountId: account.id, opportunityId: opp.id }, { title: `${tag} visit` });
      created.visits?.push(visit.id);
      const trial = await build.evaluation(sales, { opportunityId: opp.id, accountId: account.id }, { title: `${tag} trial` });
      created.demos?.push(trial.id);
      for (const [suffix, dueDate] of [["overdue call", isoDate(-1)], ["call today", isoDate(0)]] as const) {
        const r = ok(await build.activity(sales, { subject: `${tag} ${suffix}`, type: "Call", priority: "Medium", dueDate }), `create activity ${suffix}`);
        activities.push(r.body.id as string);
      }

      const after = await myDayOf(sales);
      expect(after.kpis.overdueCount - before.kpis.overdueCount, "overdue follow-ups +1").toBe(1);
      expect(after.kpis.dueToday - before.kpis.dueToday, "due today (today + overdue) +2").toBe(2);
      expect(after.kpis.newLeadsToContact - before.kpis.newLeadsToContact, "new leads to contact +1").toBe(1);
      expect(after.actionQueue.find((a) => a.subject === `${tag} overdue call`)?.state).toBe("overdue");
      expect(after.actionQueue.find((a) => a.subject === `${tag} call today`)?.state).toBe("today");
      expect(after.dealsNeedingAttention.find((d) => d.id === opp.id)?.reason).toBe("Next action overdue");
      expect(after.visitsAndTrials.filter((v) => v.title.startsWith(tag)).map((v) => v.kind).sort()).toEqual(["trial", "visit"]);
      // opportunities by stage: the open deal is in the Discovery phase total
      const phase = (d: MyDay): number => d.pipelineByPhase.find((p) => p.phase === "Discovery")?.total ?? NaN;
      expect(phase(after) - phase(before), "pipeline by stage (Discovery) grows by the deal value").toBe(250_000_000);

      // only this rep: another rep's My day shows none of it
      const other = await myDayOf(otherRep);
      expect([
        other.actionQueue.some((a) => a.subject.startsWith(tag)), other.dealsNeedingAttention.some((d) => d.id === opp.id), other.visitsAndTrials.some((v) => v.title.startsWith(tag)),
      ], "control rep sees none of this rep's records").toEqual([false, false, false]);

      // UI
      await page.goto("/");
      for (const title of ["Due today", "New leads to contact", "Quotes awaiting reply", "POs expected this month", "Quarter target"]) {
        await expect(page.getByText(title, { exact: true }), `tile '${title}'`).toBeVisible();
      }
      for (const heading of ["Action queue", "Deals needing attention", "Visits & trials this week", "Pipeline by stage"]) {
        await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      }
      await expect(tile(page, "Due today")).toContainText(`${after.kpis.overdueCount} overdue`);
      await expect(page.getByText(`${tag} overdue call`, { exact: true })).toBeVisible();
      await expect(page.getByText(`${tag} overdue next action`, { exact: true })).toBeVisible();
      await expect(page.getByText(`${tag} visit`, { exact: true })).toBeVisible();
      await expect(page.getByText(`${tag} trial`, { exact: true })).toBeVisible();
      // The My-day tiles are loaded (above), so the toggle state is settled. Spec: Team is hidden for a Sales Executive; the login user has no mfgRole (D-116).
      await expect(page.getByRole("button", { name: "Team", exact: true }), "Team view is hidden for a Sales Executive").toHaveCount(0, { timeout: 1_000 });
      if ((await page.getByRole("button", { name: "Team", exact: true }).count()) > 0) {
        const login = await fetch("http://localhost:3001/api/v1/auth/login", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: MFG_USERS.salesExec1.email, password: MFG_PASSWORD }),
        });
        const { user } = (await login.json()) as { user: Rec };
        expect(user.role, "current: only the legacy role SALES_REP is sent").toBe("SALES_REP");
      }
    } finally {
      for (const id of activities) {
        try {
          await sales.action("activities", id, "Cancel"); // activities have no archive: cancel so no open past-due follow-up is left behind
        } catch {
          // cleanup only
        }
      }
      for (const [key, ids] of Object.entries(created)) await archiveQuietly(key, ids);
    }
  });

  tc("TC-DSH-007", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const kpis = (await myDayOf(sales)).kpis as unknown as Rec;
    // Preconditions (plain Errors, so a setup problem is never mistaken for the gap): the payload and the quarterly tile exist and the tile shows BOTH a target and
    // an achievement (3 x the user's monthlyTarget vs the won value of the quarter; the case's verification note "no target/achievement data" predates it).
    const quarter = kpis.quarterTarget as { target?: number; booked?: number; pct?: number } | undefined;
    if (!quarter || typeof quarter.target !== "number" || typeof quarter.booked !== "number" || typeof quarter.pct !== "number") {
      throw new Error("precondition: kpis.quarterTarget {pct, booked, target} is missing from /mfg-dashboard/my-day");
    }
    await page.goto("/");
    const quarterTile = tile(page, "Quarter target");
    try {
      await quarterTile.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      throw new Error("precondition: the 'Quarter target' tile is not shown on My day");
    }
    const tileText = await quarterTile.innerText();
    if (!tileText.includes(`${quarter.pct}%`) || !tileText.includes(rupeeShort(quarter.booked)) || !tileText.includes(rupeeShort(quarter.target))) {
      throw new Error(`precondition: the Quarter tile should show the achievement and target (got: ${tileText.replace(/\s+/g, " ")})`);
    }
    // Spec: MONTHLY / quarterly target vs achievement. The quarterly half is there; the only gap is the monthly one: a monthly target + achievement entry
    // (numbers) in the My-day kpis. (The monthly target is used only in the Team performance table.)
    const monthly = Object.entries(kpis).find(([key, value]) => /month/i.test(key) && /target/i.test(key) && typeof value === "object" && value !== null && Object.values(value).filter((v) => typeof v === "number").length >= 2);
    expect(monthly?.[0], `a monthly target vs achievement entry in the My-day kpis (keys: ${Object.keys(kpis).join(", ")})`).toBeDefined();
  });

  tc("TC-DSH-008", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const tag = uniqueTag("DSH8");
    const opps: string[] = [];
    try {
      const account = await build.account(sales);
      const stale = await build.opportunity(sales, account.id, { title: `${tag} stale`, value: 300_000_000, nextActionDate: isoDate(-5) });
      const healthy = await build.opportunity(sales, account.id, { title: `${tag} healthy`, value: 300_000_000, nextActionDate: isoDate(5) });
      opps.push(stale.id, healthy.id);
      const deals = (await myDayOf(sales)).dealsNeedingAttention;
      // Current behaviour (cases.json: Partial): the tile lists open deals whose NEXT ACTION date has passed, highest value first (top 10); it does not look at
      // time-in-stage or at deal size. Spec 'stagnant deals listed' is met for the next-action definition of stagnant.
      expect(deals.find((d) => d.id === stale.id), "overdue next action is listed").toMatchObject({ title: stale.title, reason: "Next action overdue", value: 300_000_000 });
      expect(deals.some((d) => d.id === healthy.id), "a deal with a future next action is not listed").toBe(false);
      expect(deals.length).toBeLessThanOrEqual(10);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Deals needing attention" })).toBeVisible();
      const row = page.getByRole("link", { name: new RegExp(`${tag} stale`) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Next action overdue");
      await expect(row).toContainText("₹30.0Cr");
      await expect(page.getByText(`${tag} healthy`)).toHaveCount(0);
    } finally {
      await archiveQuietly("opps", opps);
    }
  });
});

test.describe("Dashboard - Director (Team)", () => {
  test.use({ storageState: authFile("director") });

  tc("TC-DSH-002", async ({ page }) => {
    const director = await apiAs("director");
    const data = await teamOf(director);
    expect(Object.keys(data.kpis).sort()).toEqual(
      ["activePipeline", "newLeads", "outstanding", "poBooked", "qualificationRatePct", "qualifiedLeads", "quotationsIssued", "weightedPipeline", "wonLost"].sort(),
    );
    expect(data.funnel.map((f) => f.label)).toEqual(["Leads", "Opportunities", "Quotations", "Negotiation", "PO received"]);
    expect(data.aging.flatMap((g) => g.buckets.map((b) => b.bucket)).filter((b, i, all) => all.indexOf(b) === i)).toEqual(["0–15d", "16–30d", "31–60d", "60d+"]);
    for (const key of ["teamPerformance", "pendingApprovals", "overduePayments"] as const) expect(Array.isArray(data[key]), `payload has ${key}`).toBe(true);

    await openTeam(page);
    for (const title of ["New leads", "Qualified leads", "Active pipeline", "Weighted pipeline", "Quotations issued", "PO booked", "Won / Lost", "Outstanding"]) {
      await expect(page.getByText(title, { exact: true }), `KPI tile '${title}'`).toBeVisible();
    }
    for (const heading of ["Conversion funnel", "Opportunity aging", "Team performance", "Pending approvals", "Overdue payments"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    for (const bucket of ["0–15d", "16–30d", "31–60d", "60d+"]) await expect(page.getByText(bucket, { exact: true }).first(), `aging bucket ${bucket}`).toBeVisible();
    // the tiles print the payload numbers
    await expect(tile(page, "Won / Lost")).toContainText(`${data.kpis.wonLost.won} / ${data.kpis.wonLost.lost}`);
    await expect(tile(page, "Outstanding")).toContainText(rupeeShort(data.kpis.outstanding.amount));
  });

  tc("TC-DSH-003", async ({ page }) => {
    const [costing, negotiation] = [stageProbability("Costing"), stageProbability("Negotiation")];
    expect([costing, negotiation], "seeded stage probabilities (drift guard)").toEqual([45, 60]);
    const director = await apiAs("director");
    const sales = await apiAs("salesExec1");
    const before = (await teamOf(director)).kpis;
    const opps: string[] = [];
    try {
      const account = await build.account(sales); // fresh account: nothing else of this test shares it
      opps.push((await build.opportunity(sales, account.id, { title: `${uniqueTag("DSH3")} costing`, value: 1_000_000, stage: "Costing" })).id);
      opps.push((await build.opportunity(sales, account.id, { title: `${uniqueTag("DSH3")} negotiation`, value: 2_000_000, stage: "Negotiation" })).id);
      const after = (await teamOf(director)).kpis;
      expect(after.activePipeline - before.activePipeline, "active pipeline = Rs 10 L + Rs 20 L").toBeCloseTo(3_000_000, 2);
      // 10 L x 45 % + 20 L x 60 % = 4.5 L + 12 L = Rs 16.5 L
      expect(after.weightedPipeline - before.weightedPipeline, "weighted pipeline = 4.5 L + 12 L").toBeCloseTo(1_650_000, 2);

      await openTeam(page);
      await expect(tile(page, "Active pipeline")).toContainText(rupeeShort(after.activePipeline));
      await expect(tile(page, "Weighted pipeline")).toContainText(rupeeShort(after.weightedPipeline));
      await expect(tile(page, "Weighted pipeline")).toContainText("Value × stage probability");
    } finally {
      await archiveQuietly("opps", opps);
    }
  });

  tc("TC-DSH-005", async ({ page }) => {
    const director = await apiAs("director");
    const dash = (await teamOf(director)).kpis;
    // Pipeline report = the dashboard KPIs (same org-wide, open-stage definition) and its per-stage deal counts equal the Opportunities list per stage.
    const reports = ok(await director.get("/modules/reports?search=Pipeline&limit=10"), "find report").body.data ?? [];
    const report = reports.find((r) => r.name === "Pipeline & weighted pipeline");
    if (!report) throw new Error("precondition: the 'Pipeline & weighted pipeline' report is seeded");
    const table = ok(await director.get(`/modules/reports/${report.id as string}/table/data`), "run Pipeline report").body as unknown as {
      rows: { stage: string; count: number; value: number; weighted: number }[]; totals: { value: number; weighted: number };
    };
    expect(table.totals.value, "Pipeline report total = Active pipeline KPI").toBe(dash.activePipeline);
    expect(Math.abs(table.totals.weighted - dash.weightedPipeline), "report weighted total (rounded per stage) = Weighted pipeline KPI").toBeLessThanOrEqual(table.rows.length);
    for (const row of table.rows) {
      expect(await totalOf(director, "opps", `&status=${encodeURIComponent(row.stage)}`), `opportunities list count of stage '${row.stage}'`).toBe(row.count);
    }
    // The stage-less aggregate: open deals in the list = sum of the report counts
    const [won, lost, all] = [await totalOf(director, "opps", "&status=Won"), await totalOf(director, "opps", "&status=Lost"), await totalOf(director, "opps")];
    expect(all - won - lost, "open deals (list) = sum of report counts").toBe(table.rows.reduce((s, r) => s + r.count, 0));

    // Drill-down by clicking a KPI tile (only the My-day tiles are links; the Team KPI tiles are not clickable).
    const mine = (await myDayOf(director)).kpis;
    // The first two tiles link to real pages; the other two link to /quotes and /opps, which are no routes (the pages are /quotations and /opportunities),
    // so the app bounces back to the dashboard (D-117).
    const tiles = [["Due today", "/activities", true], ["New leads to contact", "/leads", true], ["Quotes awaiting reply", "/quotations", false], ["POs expected this month", "/opportunities", false]] as const;
    for (const [title, path, works] of tiles) {
      await page.goto("/");
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      if (!works) expect(await tile(page, title).getAttribute("href"), `current: '${title}' links to a non-route (remove with D-117)`).toBe(path === "/quotations" ? "/quotes" : "/opps");
      await page.getByText(title, { exact: true }).click();
      const opens = async (): Promise<void> => { await expect(page, `drill-down of '${title}' opens ${path}`).toHaveURL(new RegExp(`${path}$`), { timeout: 3_000 }); };
      if (works) await opens();
      else {
        await knownDefect(test.info(), "D-117", opens);
        if (!new RegExp(`${path}$`).test(page.url())) await expect(page, "current: bounced back to the dashboard (remove with D-117)").toHaveURL(/^http:\/\/localhost:5174\/$/);
      }
    }
    expect(mine.newLeadsToContact, "the leads the director is told to contact = his own New leads").toBe(await totalOf(director, "leads", `&status=New&owner=${await userIdOf(director)}`));
  });
});

test.describe("Dashboard - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-DSH-004", async ({ page }) => {
    const manager = await apiAs("salesManager");
    const sales = await apiAs("salesExec1");
    const before = await teamOf(manager);
    const listBefore = { leads: await totalOf(manager, "leads"), opps: await totalOf(manager, "opps"), quotes: await totalOf(manager, "quotes") };
    const ids: Record<string, string[]> = { leads: [], opps: [], quotes: [] };
    try {
      ids.leads?.push((await build.lead(sales)).id);
      const account = await build.account(sales);
      const negotiating = await build.opportunity(sales, account.id, { stage: "Negotiation" });
      const poReceived = await build.opportunity(sales, account.id, { stage: "PO received" });
      ids.opps?.push(negotiating.id, poReceived.id);
      ids.quotes?.push((await build.quotation(sales, { opportunityId: negotiating.id, accountId: account.id })).id);

      const after = await teamOf(manager);
      const delta = (label: string): number => (after.funnel.find((f) => f.label === label)?.count ?? NaN) - (before.funnel.find((f) => f.label === label)?.count ?? NaN);
      // known counts: +1 lead, +2 opportunities, +1 quotation, +2 in Negotiation-or-later, +1 PO received
      expect([delta("Leads"), delta("Opportunities"), delta("Quotations"), delta("Negotiation"), delta("PO received")]).toEqual([1, 2, 1, 2, 1]);
      // ... and equal the list counts (the lists show everything the manager may see)
      expect(await totalOf(manager, "leads"), "leads list").toBe(listBefore.leads + delta("Leads"));
      expect(await totalOf(manager, "opps"), "opportunities list").toBe(listBefore.opps + delta("Opportunities"));
      expect(await totalOf(manager, "quotes"), "quotations list").toBe(listBefore.quotes + delta("Quotations"));
      // conversion % per step = round(count / previous step)
      after.funnel.forEach((step, i) => {
        const prev = after.funnel[i - 1];
        expect(step.conversionPct, `${step.label} conversion %`).toBe(i === 0 || !prev ? null : prev.count > 0 ? Math.round((step.count / prev.count) * 100) : 0);
      });

      await openTeam(page);
      const row = (label: string): Locator => page.locator("div.flex.items-center.gap-2.text-xs").filter({ has: page.getByText(label, { exact: true }) }).first();
      for (const step of after.funnel) await expect(row(step.label), `funnel row ${step.label}`).toContainText(String(step.count));
    } finally {
      for (const [key, list] of Object.entries(ids)) await archiveQuietly(key, list);
    }
  });

  tc("TC-DSH-006", async () => {
    const [manager, director, rep1, rep2] = [await apiAs("salesManager"), await apiAs("director"), await apiAs("salesExec1"), await apiAs("salesExec2")];
    const orgB = await apiAs("orgBAdmin");
    const snapshot = async () => ({
      manager: (await teamOf(manager)).kpis.activePipeline, director: (await teamOf(director)).kpis.activePipeline,
      rep1: (await teamOf(rep1)).kpis.activePipeline, rep2: (await teamOf(rep2)).kpis.activePipeline, orgB: (await teamOf(orgB)).kpis.activePipeline,
    });
    const before = await snapshot();
    const opps: string[] = [];
    try {
      const account = await build.account(rep2);
      opps.push((await build.opportunity(rep2, account.id, { title: `${uniqueTag("DSH6")} rep2 deal`, value: 7_000_000 })).id);
      const after = await snapshot();
      const d = (k: keyof typeof before): number => after[k] - before[k];
      // The E2E org has ONE team (all 12 users), so 'two teams' cannot be built through the API: the checks are own-vs-team-vs-all within the team plus the org boundary.
      expect(d("rep2"), "the rep that owns the deal sees it").toBe(7_000_000);
      expect(d("rep1"), "another rep (own-record scope) does not").toBe(0);
      expect(d("manager"), "the manager sees the whole team's numbers").toBe(7_000_000);
      expect(d("director"), "the director sees the whole org").toBe(7_000_000);
      expect(d("orgB"), "Org B (another tenant) does not").toBe(0);
    } finally {
      await archiveQuietly("opps", opps);
    }
  });
});
