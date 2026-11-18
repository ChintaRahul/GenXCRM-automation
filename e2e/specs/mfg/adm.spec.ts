// e2e/specs/mfg/adm.spec.ts - Administration & masters (TC-ADM-001..011): masters, stage probabilities, permission matrix, record access, field security,
// business hours & holidays, automation rules, document templates, seeded defaults, competitor master, non-admin access.
//
// Every Administration config module (masters, rolePermissions, fieldPermissions, businessCalendar, holidays, automationRules, docTemplates) answers 403 to
// EVERY role of the E2E org (D-124, extends D-7 / D-50 / D-77), so the admin UI cannot list or save anything. Each case therefore (1) tries the real
// Administration UI / API and asserts the spec-correct behaviour inside knownDefect (plus the exact current failure), and (2) tests the EFFECT of the config
// through the guarded db.ts helper (withAdminConfig: exact pre-state persisted to e2e/.auth/admin-config-backup.json BEFORE the change, restored in
// `finally`, healed again by the beforeAll below and by auth.setup.ts). Mutation windows contain only the reads that prove the effect.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { authFile, MFG_USERS, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { AdminPage } from "../../pages/mfg/AdminPage";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import {
  purgeE2eAdminRecords, readAdminDefaults, readAdminExtras, restoreAdminConfigIfNeeded, restoreSlaThrowawayIfNeeded, slaTimerWindows, THROWAWAY_SLA_PREFIX,
  withAdminConfig, withThrowawaySlaPolicy, type AdminDefaults,
} from "../../mfg/db";
import { knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

const BASE = "http://localhost:5174";
const ORG_USER = MFG_USERS.director.email; // any user of the E2E manufacturer org (Org A): the db helpers resolve the org through it
const ORG_B_USER = MFG_USERS.orgBAdmin.email;
const HOUR = 3_600_000;

test.beforeAll(async () => {
  await restoreAdminConfigIfNeeded(); // heal a config change left by a killed run before anything depends on it
  await restoreSlaThrowawayIfNeeded();
  await purgeE2eAdminRecords(ORG_USER);
});

const asRole = (browser: Browser, role: MfgRoleKey): Promise<BrowserContext> => browser.newContext({ storageState: authFile(role), baseURL: BASE });
const forbidden = (op: string, moduleKey: string): string => `Your role does not have '${op}' access to '${moduleKey}'.`;
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
const optionTexts = async (page: Page, selector: string): Promise<string[]> => (await page.locator(`${selector} option`).allTextContents()).map((t) => t.trim()).filter((t) => t && t !== "Select…");

interface Team { kpis: { weightedPipeline: number } }
const teamOf = async (api: ApiClient): Promise<Team> => ok(await api.get("/mfg-dashboard/team"), "team dashboard").body as unknown as Team;

/** The module list request of an Administration config module, as Super Admin. */
const adminList = async (key: string): Promise<ApiResult> => (await apiAs("superAdmin")).get(`/modules/${key}?limit=1`);
/** Spec: Super Admin can read the config module. Current (D-124): 403 for every role - pinned AFTER the knownDefect so a fix is noticed. */
const expectAdminModuleForbidden = async (key: string, testInfo: Parameters<typeof knownDefect>[0]): Promise<void> => {
  const r = await adminList(key);
  await knownDefect(testInfo, "D-124", async () => {
    expect(r.status, `GET /modules/${key} as Super Admin`).toBe(200);
  });
  expect(r.status, `current: GET /modules/${key} is 403 for Super Admin (remove with D-124)`).toBe(403);
  expect(ApiClient.message(r)).toBe(forbidden("read", key));
};

// ---- Seed constants of backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts, evaluated from the source (drift guard for ADM-009) ----
const seedSource = (): string => readFileSync(resolve(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
const between = (src: string, start: string, end: string): string => {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`'${start}' not found in manufacturing-defaults.data.ts (moved? update the drift guard)`);
  const e = src.indexOf(end, s + start.length);
  if (e < 0) throw new Error(`end of '${start}' not found in manufacturing-defaults.data.ts`);
  return src.slice(s + start.length, e);
};
/** Evaluates a plain object / array literal of the data file; `MfgRole.X` evaluates to 'X'. */
const evalLiteral = <T>(literal: string): T => new Function("MfgRole", `return ${literal}`)(new Proxy({}, { get: (_t, k) => String(k) })) as T;
interface Seed {
  permSpec: Record<string, string>; recordAccess: Record<string, string>; roleToEnum: Record<string, string>; moduleKeys: string[];
  unrestrictedLabels: string[]; fieldLabels: string[]; fieldModuleKey: Record<string, string>;
  masters: Record<string, { value: string; numericValue: number | null }[]>;
  calendar: { timezone: string; days: { day: string; isOpen: boolean; from: string; to: string }[] };
  holidays: { date: string; name: string }[]; reports: { category: string; name: string }[]; slaPolicyCount: number; approvalRuleCount: number; competitors: string[];
}
const loadSeed = (): Seed => {
  const src = seedSource();
  const arr = (start: string, end: string): string[] => evalLiteral<string[]>(between(src, start, end));
  const obj = <T>(start: string): T => evalLiteral<T>(`${between(src, start, "\n};")}\n}`);
  const named = (name: string): string[] => arr(`const ${name} = `, ";");
  const masters: Seed["masters"] = {};
  for (const m of src.matchAll(/simple\('(\w+)', (\[[^\]]*\]|\w+)\)/g)) {
    const [, category, list] = m;
    const values = (list ?? "").startsWith("[") ? evalLiteral<string[]>(list ?? "[]") : named(list ?? "");
    masters[category ?? ""] = values.map((value) => ({ value, numericValue: null }));
  }
  masters.stages = evalLiteral<[string, number][]>(between(src, "export const STAGES: [string, number][] = ", "\n];") + "\n]").map(([value, n]) => ({ value, numericValue: n }));
  const milestones = /\.\.\.(\[\[[^\n]*?\]\])\.map/.exec(src)?.[1];
  masters.milestones = evalLiteral<[string, number][]>(milestones ?? "[]").map(([value, n]) => ({ value, numericValue: n }));
  return {
    permSpec: obj<Record<string, string>>("const PERM_SPEC: Record<string, string> = "),
    recordAccess: obj<Record<string, string>>("const RECORD_ACCESS_LABEL: Record<string, RecordAccess> = "),
    roleToEnum: obj<Record<string, string>>("export const ROLE_LABEL_TO_ENUM: Record<string, MfgRole> = "),
    moduleKeys: arr("export const MANUFACTURING_MODULE_KEYS = ", " as const;"),
    unrestrictedLabels: arr("const FIELD_SECURITY_UNRESTRICTED_LABELS = ", ";"),
    fieldLabels: arr("export const FIELD_PERMISSION_DEFAULT_LABELS = ", " as const;"),
    fieldModuleKey: evalLiteral<Record<string, string>>(`${between(src, "const moduleKeyByLabel: Record<string, string> = ", "\n  };")}\n}`),
    masters,
    calendar: evalLiteral(`${between(src, "export const BUSINESS_CALENDAR_DEFAULT = ", "\n};")}\n}`),
    holidays: evalLiteral(`${between(src, "export const HOLIDAY_DEFAULTS: { date: string; name: string }[] = ", "\n];")}\n]`),
    reports: [...between(src, "export const REPORT_DEFAULTS: { category: string; name: string }[] = ", "\n];").matchAll(/\{ category: '([^']+)', name: '([^']+)' \}/g)]
      .map((m) => ({ category: m[1] ?? "", name: m[2] ?? "" })),
    slaPolicyCount: [...between(src, "export const SLA_POLICY_DEFAULTS: SlaPolicyDefault[] = [", "\n];").matchAll(/\{ id: 'SLA-\d+'/g)].length,
    approvalRuleCount: [...between(src, "export const APPROVAL_RULE_DEFAULTS", "\n];").matchAll(/\{ type: '/g)].length,
    competitors: named("COMPETITORS"),
  };
};
/** buildRolePermissionDefaults() semantics: Super Admin / Director = CRUDE on every module, every other role from PERM_SPEC; roles without any op get no row. */
const expectedPermissions = (seed: Seed): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [label, role] of Object.entries(seed.roleToEnum)) {
    const full = label === "Super Admin" || label === "Director";
    const access = full ? "ALL" : (seed.recordAccess[label] ?? "ALL");
    for (const moduleKey of seed.moduleKeys) {
      let ops = full ? "CRUDE" : "";
      if (!full) {
        for (const part of (seed.permSpec[label] ?? "").split(";")) {
          const [mods, o] = part.split(":");
          if (mods && o && (mods === "ALL" || mods.split(",").includes(moduleKey))) ops = o;
        }
      }
      if (ops) out.set(`${role}:${moduleKey}`, `${access}|${ops}`);
    }
  }
  return out;
};
const opsOf = (r: AdminDefaults["rolePermissions"][number]): string => `${r.canCreate ? "C" : ""}${r.canRead ? "R" : ""}${r.canUpdate ? "U" : ""}${r.canDelete ? "D" : ""}${r.canExport ? "E" : ""}`;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

test.describe("ADM - drift guard", () => {
  test("the seed constants evaluated from the backend data file have the sizes the cases state", () => {
    const seed = loadSeed();
    expect(Object.keys(seed.masters).sort(), "13 master lists").toEqual(
      ["activityTypes", "buying", "categories", "competitors", "coverage", "industries", "leadStatus", "lost", "milestones", "priorities", "sources", "stages", "territories"],
    );
    expect(seed.moduleKeys, "22 modules of permissions").toHaveLength(22);
    expect(seed.fieldLabels, "6 field-security toggles").toEqual(["Standard cost", "Minimum selling price", "Costing & margin", "Approval thresholds", "Competitor pricing", "Payment receipts"]);
    expect(Object.keys(seed.roleToEnum), "11 manufacturing roles").toHaveLength(11);
    expect(seed.approvalRuleCount, "8 approval rules").toBe(8);
    expect(seed.slaPolicyCount, "22 SLA policies").toBe(22);
    expect(seed.reports, "25 reports").toHaveLength(25);
    expect(seed.competitors).toEqual(["Avery Weigh-Tronix", "Essae Digitronics", "Mettler Toledo", "Local fabricator", "Other"]);
  });
});

test.describe("ADM - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-ADM-001", async ({ page, browser }, testInfo) => {
    test.slow(); // cold stack
    const tag = uniqueTag("E2E");
    const [source, lost] = [`${tag}-Source`, `${tag}-Lost`];
    const oppIds: string[] = [];
    try {
      // 1) The real flow: Administration -> Masters -> New Master value (a lead source). Current (D-124): the tab cannot load and the save is rejected with 403.
      const admin = new AdminPage(page);
      await admin.goto();
      await admin.main.getByRole("button", { name: /New Master value/ }).click();
      const drawer = new ModuleDrawer(page);
      await drawer.fill({ category: "sources", value: source, label: source });
      const created = page.waitForResponse((r) => r.request().method() === "POST" && /\/modules\/masters$/.test(r.url()));
      await drawer.save();
      const createStatus = (await created).status();
      expect(createStatus, "POST /modules/masters as Super Admin").toBe(201);

      // 2) The effect of a new master value, through the guarded db helper: one new lead source and one new lost reason.
      await withAdminConfig(ORG_USER, { masterValues: [{ category: "sources", value: source }, { category: "lost", value: lost }] }, async () => {
        const sales = await apiAs("salesExec1");
        const account = await build.account(sales);
        const opp = await build.opportunity(sales, account.id, { title: `${tag} lost-reason deal` });
        oppIds.push(opp.id);
        const ctx = await asRole(browser, "salesExec1");
        try {
          const rep = await ctx.newPage();
          // New lead -> Source dropdown
          const leads = new ModuleList(rep, "leads");
          await leads.goto();
          await leads.clickNew();
          await expect(rep.locator("#source")).toBeVisible();
          const sources = await optionTexts(rep, "#source");
          expect(sources, "the seeded sources are listed").toContain("IndiaMART");
          expect(sources, "a new master source appears immediately in New lead").toContain(source);
          // Mark lost -> reason prompt
          const detail = new ModuleDetail(rep);
          await detail.goto("opps", opp.id);
          await detail.action("Mark lost");
          await expect(rep.locator("#action-ask-field")).toBeVisible();
          const reasons = await optionTexts(rep, "#action-ask-field");
          expect(reasons, "the seeded lost reasons are listed").toContain("Price");
          expect(reasons, "a new master lost reason appears immediately in Mark lost").toContain(lost);
          await rep.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
          expect((await sales.get(`/modules/opps/${opp.id}`)).body.stage, "the prompt was cancelled: the deal is still open").toBe("Qualified");
        } finally {
          await ctx.close();
        }
      });
    } finally {
      await archiveQuietly("opps", oppIds);
      await purgeE2eAdminRecords(ORG_USER);
    }
    // Deactivating a value ("hides it from new records but keeps history") needs a consumer of the masters: none exists (D-125), so it cannot be observed.
  });

  tc("TC-ADM-002", async ({ page }, testInfo) => {
    test.slow();
    const seeded = (await readAdminDefaults(ORG_USER)).masterValues.find((m) => m.category === "stages" && m.value === "Negotiation");
    expect(seeded?.numericValue, "seeded Negotiation probability").toBe(60);
    // Real flow: Masters tab -> the 'Negotiation' stage row. Current (D-124): the tab cannot load.
    const admin = new AdminPage(page);
    await admin.goto();
    await expect(admin.main.getByRole("row").filter({ hasText: "Negotiation" }).first(), "the stage master row").toBeVisible({ timeout: 2_000 });
    // Effect: stage probability 70 % in the master (guarded db change) -> the Team dashboard's weighted pipeline of a fresh Rs 20 L Negotiation deal.
    const director = await apiAs("director");
    const sales = await apiAs("salesExec1");
    const oppIds: string[] = [];
    try {
      await withAdminConfig(ORG_USER, { stageProbability: { stage: "Negotiation", numericValue: 70 } }, async () => {
        expect((await readAdminDefaults(ORG_USER)).masterValues.find((m) => m.category === "stages" && m.value === "Negotiation")?.numericValue, "master changed").toBe(70);
        const before = (await teamOf(director)).kpis.weightedPipeline;
        const account = await build.account(sales); // fresh account: nothing else of this test shares it
        oppIds.push((await build.opportunity(sales, account.id, { title: `${uniqueTag("ADM2")} negotiation`, value: 2_000_000, stage: "Negotiation" })).id);
        const delta = (await teamOf(director)).kpis.weightedPipeline - before;
        expect(delta, "weighted pipeline uses 70 % for Negotiation: Rs 20 L x 70 %").toBeCloseTo(1_400_000, 2);
      });
    } finally {
      await archiveQuietly("opps", oppIds);
    }
    expect((await readAdminDefaults(ORG_USER)).masterValues.find((m) => m.category === "stages" && m.value === "Negotiation")?.numericValue, "restored").toBe(60);
  });

  tc("TC-ADM-003", async ({ page, browser }, testInfo) => {
    test.slow();
    const row = async () => (await readAdminDefaults(ORG_USER)).rolePermissions.find((r) => r.role === "SALES_EXECUTIVE" && r.moduleKey === "leads");
    const original = await row();
    expect(original, "seeded Sales Executive / Leads permission").toMatchObject({ canCreate: true, canRead: true, canUpdate: true, canDelete: false });
    // Real flow: Roles & Permissions -> Sales Executive -> Leads -> untick Create. Current (D-124): the tab shows only the 403 error.
    const admin = new AdminPage(page);
    await admin.goto();
    const status = await admin.openTab("Roles & Permissions", "rolePermissions");
    await expect(admin.main.getByRole("button", { name: "Sales Executive", exact: true }), "role chips of the matrix").toBeVisible({ timeout: 2_000 });
    // Effect (guarded db change of the same row): Create removed for Sales Executive on Leads.
    await withAdminConfig(ORG_USER, { rolePermission: { role: "SALES_EXECUTIVE", moduleKey: "leads", set: { canCreate: false } } }, async () => {
      const sales = await apiAs("salesExec1"); // permissions are read from the DB on every request: a fresh login is not needed for the API
      const read = await sales.get("/modules/leads?limit=1");
      expect(read.status, "Read is unchanged").toBe(200);
      const create = await sales.post("/modules/leads", { company: uniqueTag("ADM3"), contactName: "Buyer", phone: "9000000003", product: "Weighbridge", source: "Website" });
      expect(create.status, "API create").toBe(403);
      expect(ApiClient.message(create)).toBe(forbidden("create", "leads"));
      // UI as Sales Executive (a new session): the New lead button is hidden.
      const ctx = await asRole(browser, "salesExec1");
      try {
        const rep = await ctx.newPage();
        const loaded = rep.waitForResponse((r) => r.request().method() === "GET" && /\/modules\/leads\?/.test(r.url()));
        await rep.goto("/leads");
        expect((await loaded).status(), "the Leads list still loads").toBe(200);
        const newLead = rep.getByRole("button", { name: /^New [^(]/ });
        await expect(newLead, "New lead is hidden without the Create permission").toBeHidden({ timeout: 2_000 });
      } finally {
        await ctx.close();
      }
    });
    expect(await row(), "the permission row is restored exactly").toEqual(original);
  });

  tc("TC-ADM-004", async ({ page, browser }, testInfo) => {
    test.slow();
    const row = async () => (await readAdminDefaults(ORG_USER)).rolePermissions.find((r) => r.role === "SALES_EXECUTIVE" && r.moduleKey === "opps");
    const original = await row();
    expect(original, "Sales Executive default record access on Opportunities").toMatchObject({ recordAccess: "OWN", canRead: true });
    const sales2 = await apiAs("salesExec2");
    const sales1 = await apiAs("salesExec1");
    const account = await build.account(sales2);
    const opp = await build.opportunity(sales2, account.id, { title: `${uniqueTag("ADM4")} other rep deal` });
    const idsOf = async (): Promise<string[]> => (ok(await sales1.get(`/modules/opps?search=${encodeURIComponent(opp.title)}`), "list opps").body.data ?? []).map((o) => o.id as string);
    try {
      expect(await idsOf(), "OWN: rep 1 does not see rep 2's opportunity").toEqual([]);
      expect((await sales1.get(`/modules/opps/${opp.id}`)).status, "OWN: direct read is 404").toBe(404);
      // Real flow: Roles & Permissions -> Sales Executive -> Opportunities -> Record access select. Current (D-124): the tab shows only the 403 error.
      const admin = new AdminPage(page);
      await admin.goto();
      const status = await admin.openTab("Roles & Permissions", "rolePermissions");
      await expect(admin.main.locator("select:not([aria-label='Administration section'])").first(), "record-access select of the matrix").toBeVisible({ timeout: 2_000 });
      // Effect: Own -> All for Opportunities.
      await withAdminConfig(ORG_USER, { rolePermission: { role: "SALES_EXECUTIVE", moduleKey: "opps", set: { recordAccess: "ALL" } } }, async () => {
        expect(await idsOf(), "ALL: rep 1 sees rep 2's opportunity (API)").toEqual([opp.id]);
        expect((await sales1.get(`/modules/opps/${opp.id}`)).status, "ALL: direct read").toBe(200);
        const ctx = await asRole(browser, "salesExec1");
        try {
          const rep = await ctx.newPage();
          const list = new ModuleList(rep, "opps");
          await list.goto();
          await list.search(opp.title);
          await expect(list.row(opp.title), "ALL: the other rep's opportunity is listed for rep 1").toBeVisible();
        } finally {
          await ctx.close();
        }
      });
      expect(await row(), "the permission row is restored exactly").toEqual(original);
      expect(await idsOf(), "back to OWN: rep 1 no longer sees it").toEqual([]);
    } finally {
      await archiveQuietly("opps", [opp.id]);
    }
  });

  tc("TC-ADM-005", async ({ page, browser }, testInfo) => {
    test.slow();
    const seed = loadSeed();
    const toggles = async () => (await readAdminDefaults(ORG_USER)).fieldPermissions;
    const original = await toggles();
    // The six toggles exist; 'Costing & margin' is restricted for Sales Manager (default) and open to Super Admin / Director / Sales Head / Commercial.
    expect(original.map((f) => f.fieldLabel).sort(byText)).toEqual([...seed.fieldLabels].sort(byText));
    const costing = original.find((f) => f.fieldLabel === "Costing & margin");
    expect(costing?.moduleKey).toBe("costing");
    expect(costing?.restrictedToRoles).toContain("SALES_MANAGER");
    for (const open of ["SUPER_ADMIN", "DIRECTOR", "SALES_HEAD", "COMMERCIAL_ESTIMATION"]) expect(costing?.restrictedToRoles, `${open} is not restricted`).not.toContain(open);
    // Real flow: Roles & Permissions -> Sales Manager chip -> six switches. Current (D-124): the tab shows only the 403 error.
    const admin = new AdminPage(page);
    await admin.goto();
    const status = await admin.openTab("Roles & Permissions", "rolePermissions");
    const chip = admin.main.getByRole("button", { name: "Sales Manager", exact: true });
    await expect(chip, "Sales Manager role chip").toBeVisible({ timeout: 2_000 });
    await chip.click();
    for (const label of seed.fieldLabels) await expect(admin.main.getByRole("switch", { name: `Restrict ${label} for SALES_MANAGER` })).toBeVisible({ timeout: 2_000 });

    const manager = await apiAs("salesManager");
    const before = await manager.get("/modules/costing?limit=1");
    expect(before.status, "default: Costing is restricted for the Sales Manager").toBe(403);
    expect(ApiClient.message(before)).toBe("Costing is restricted.");
    // Effect: allow 'Costing & margin' for Sales Manager (guarded db change of the toggle).
    await withAdminConfig(ORG_USER, { fieldPermission: { fieldLabel: "Costing & margin", allowRole: "SALES_MANAGER" } }, async () => {
      const allowed = await manager.get("/modules/costing?limit=1");
      expect(allowed.status, "Costing becomes accessible to the Sales Manager").toBe(200);
      const ctx = await asRole(browser, "salesManager");
      try {
        const mgr = await ctx.newPage();
        const loaded = mgr.waitForResponse((r) => r.request().method() === "GET" && /\/modules\/costing\?/.test(r.url()));
        await mgr.goto("/costing");
        expect((await loaded).status()).toBe(200);
        await expect(mgr.getByRole("main").getByText(/\d+ of \d+/).first(), "the list finished loading").toBeVisible();
        await expect(mgr.getByRole("main").getByText("Couldn't load costing."), "no load error").toHaveCount(0);
      } finally {
        await ctx.close();
      }
    });
    // Reverting hides it again (and the toggle is back to the exact seeded value).
    expect(await toggles()).toEqual(original);
    const after = await manager.get("/modules/costing?limit=1");
    expect(after.status, "reverted: restricted again").toBe(403);
    expect(ApiClient.message(after)).toBe("Costing is restricted.");
  });

  tc("TC-ADM-006", async ({ page }, testInfo) => {
    test.slow();
    const tag = uniqueTag("E2E");
    const holiday = { date: "2031-01-01", name: `${tag}-Holiday` };
    const extras = await readAdminExtras(ORG_USER);
    expect(extras.calendarDays.find((d) => d.day === "Sat"), "seeded: Saturday is open (shortened day)").toMatchObject({ isOpen: true });
    // Real flow: Business Hours & Holidays -> Saturday closed -> Save; add a holiday. Current (D-124): the tab shows only the 403 error.
    const admin = new AdminPage(page);
    await admin.goto();
    const status = await admin.openTab("Business Hours & Holidays", "businessCalendar");
    await expect(admin.main.getByText("Sat", { exact: true }), "the Saturday row of the business hours").toBeVisible({ timeout: 2_000 });

    // Effect on SLA due times, deterministic and independent of the time of day: a throwaway 'Business hours' policy with a 7-day (168 open hours) target on
    // leads. Closing Saturday removes 4 open hours per week, so the due time of a NEW timer is strictly later (>= 6 h) than that of a timer started before.
    const sales = await apiAs("salesExec1");
    const name = `${THROWAWAY_SLA_PREFIX}${uniqueTag("ADM6")}`;
    const def = {
      moduleKey: "leads", startEvent: "Lead created", stopEvent: "First call / message logged", calendarType: "Business hours" as const,
      targets: [{ cond: "All", val: 7, unit: "days" as const }], escalationLevels: [{ at: 100, who: "Owner", channels: ["In-app"] }],
    };
    const windowOf = async (leadId: string): Promise<number> => {
      await expect.poll(async () => (await slaTimerWindows(leadId)).find((t) => t.name === name)?.windowMs ?? -1, { message: "throwaway timer started", timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
      return (await slaTimerWindows(leadId)).find((t) => t.name === name)?.windowMs ?? NaN;
    };
    const leadIds: string[] = [];
    try {
      await withThrowawaySlaPolicy(ORG_USER, name, def, async () => {
        const a = await build.lead(sales);
        leadIds.push(a.id);
        const windowOpen = await windowOf(a.id);
        await withAdminConfig(ORG_USER, { calendarDay: { day: "Sat", isOpen: false }, holidays: [holiday] }, async () => {
          const stored = await readAdminExtras(ORG_USER);
          expect(stored.calendarDays.find((d) => d.day === "Sat"), "Saturday is stored as closed").toMatchObject({ isOpen: false });
          expect(stored.holidays, "the holiday is stored").toEqual([holiday]);
          const b = await build.lead(sales);
          leadIds.push(b.id);
          const windowClosed = await windowOf(b.id);
          expect(windowClosed - windowOpen, "a new timer's due time moves later with Saturday closed").toBeGreaterThan(6 * HOUR);
        });
        const restored = await readAdminExtras(ORG_USER);
        expect(restored.calendarDays.find((d) => d.day === "Sat"), "Saturday is open again").toMatchObject({ isOpen: true });
        expect(restored.holidays, "the test holiday is gone").toEqual([]);
      });
    } finally {
      await archiveQuietly("leads", leadIds);
    }
  });

  tc("TC-ADM-007", async ({ page }, testInfo) => {
    const admin = new AdminPage(page);
    await admin.goto();
    const status = await admin.openTab("Automation Rules", "automationRules");
    // The status of the awaited list response is the positive loaded signal; "error text hidden" alone can pass while the page is still loading.
    expect(status, "GET /modules/automationRules answers 200 for Super Admin").toBe(200);
    await expect(admin.main.getByText("Couldn't load automation rules."), "the rules list loads").toBeHidden({ timeout: 2_000 });
    // Read path through the API: the rules list and a run's events (the run history).
    await expectAdminModuleForbidden("automationRules", testInfo);
    await expectAdminModuleForbidden("automationRuns", testInfo);
  });

  tc("TC-ADM-008", async ({ page }, testInfo) => {
    test.slow();
    const tag = uniqueTag("E2E");
    const template = { name: `${tag}-Quotation layout`, numberingPattern: "E2E/QT/{YYYY}/{NNN}" };
    try {
      // Real flow: Document Templates -> New Document template -> Save. Current (D-124): the tab cannot load and the save is rejected with 403.
      const admin = new AdminPage(page);
      await admin.goto();
      await admin.main.getByRole("button", { name: /New Document template/ }).click();
      const drawer = new ModuleDrawer(page);
      await drawer.fill({ name: template.name, numberingPattern: template.numberingPattern });
      const created = page.waitForResponse((r) => r.request().method() === "POST" && /\/modules\/docTemplates$/.test(r.url()));
      await drawer.save();
      const createStatus = (await created).status();
      expect(createStatus, "POST /modules/docTemplates as Super Admin").toBe(201);
      await purgeE2eAdminRecords(ORG_USER);

      // A stored template (guarded db row) is saved - but is it selectable in a quotation? The quotation form has no template control and nothing reads the table (D-128).
      await withAdminConfig(ORG_USER, { templates: [template] }, async () => {
        expect((await readAdminExtras(ORG_USER)).templates, "the template is stored").toEqual([template]);
        await page.goto("/quotations");
        const quotes = new ModuleList(page, "quotes");
        await expect(quotes.searchBox).toBeVisible();
        await quotes.clickNew();
        await expect(page.locator("#validUntil"), "the quotation form is open").toBeVisible();
        await expect(page.getByRole("dialog").getByText(/template/i).first(), "a quotation can use the document template").toBeVisible({ timeout: 2_000 });
      });
    } finally {
      await purgeE2eAdminRecords(ORG_USER);
    }
  });

  tc("TC-ADM-009", async () => {
    const seed = loadSeed();
    const expectedPerms = expectedPermissions(seed);
    for (const user of [ORG_USER, ORG_B_USER]) {
      const d = await readAdminDefaults(user);
      // 13 masters, each equal to the seed list (value, label, number, order)
      expect(Object.keys(seed.masters)).toHaveLength(13);
      const gotMasters: Record<string, { value: string; label: string; numericValue: number | null; sortOrder: number }[]> = {};
      for (const m of d.masterValues) (gotMasters[m.category] ??= []).push({ value: m.value, label: m.label, numericValue: m.numericValue, sortOrder: m.sortOrder });
      const wantMasters = Object.fromEntries(Object.entries(seed.masters).map(([c, vs]) => [c, vs.map((v, i) => ({ value: v.value, label: v.value, numericValue: v.numericValue, sortOrder: i }))]));
      expect(gotMasters, `${user}: master lists`).toEqual(wantMasters);
      expect(d.masterValues.every((m) => m.isActive), `${user}: all masters active`).toBe(true);
      // 22 modules of permissions, every role / module row equal to buildRolePermissionDefaults()
      expect(new Set(d.rolePermissions.filter((r) => r.role === "SUPER_ADMIN").map((r) => r.moduleKey)).size, `${user}: modules covered by the permission matrix`).toBe(22);
      const gotPerms = new Map(d.rolePermissions.map((r) => [`${r.role}:${r.moduleKey}`, `${r.recordAccess}|${opsOf(r)}`]));
      expect(Object.fromEntries([...gotPerms].sort(([a], [b]) => byText(a, b))), `${user}: role permission matrix`).toEqual(Object.fromEntries([...expectedPerms].sort(([a], [b]) => byText(a, b))));
      // 6 field-security entries
      const unrestricted = new Set(seed.unrestrictedLabels.map((l) => seed.roleToEnum[l]));
      const wantRoles = Object.values(seed.roleToEnum).filter((r) => !unrestricted.has(r)).sort(byText);
      expect(d.fieldPermissions.map((f) => ({ moduleKey: f.moduleKey, fieldLabel: f.fieldLabel, restrictedToRoles: [...f.restrictedToRoles].sort(byText) })).sort((a, b) => byText(a.fieldLabel, b.fieldLabel)), `${user}: field security`)
        .toEqual(seed.fieldLabels.map((l) => ({ moduleKey: seed.fieldModuleKey[l] ?? "", fieldLabel: l, restrictedToRoles: wantRoles })).sort((a, b) => byText(a.fieldLabel, b.fieldLabel)));
      // 8 approval rules, 22 SLA policies, calendar, holidays, 25 reports
      expect(d.approvalRuleCount, `${user}: approval rules`).toBe(8);
      expect(d.slaPolicyCount, `${user}: SLA policies`).toBe(22);
      expect(d.calendar, `${user}: one business calendar`).toEqual([seed.calendar]);
      expect(d.holidays, `${user}: holidays`).toEqual(seed.holidays);
      expect(d.reports, `${user}: the 25 standard reports`).toHaveLength(25);
      const key = (r: { category: string; name: string }): string => `${r.category}|${r.name}`;
      expect([...d.reports].sort((x, y) => byText(key(x), key(y))), `${user}: report names`).toEqual([...seed.reports].sort((x, y) => byText(key(x), key(y))));
    }
    // "Create a new Manufacturing org" is not driven: registration sends verification e-mail. The E2E orgs are seeded through the same
    // buildXxxDefaults() / *_DEFAULTS constants (prisma/seed-e2e-mfg.ts), which is what ManufacturingDefaultsService.seedForOrg writes for a new org.
  });

  tc("TC-ADM-010", async ({ page }, testInfo) => {
    const seed = loadSeed();
    const wanted = ["Avery Weigh-Tronix", "Essae Digitronics", "Mettler Toledo", "Local fabricator", "Other"];
    expect(seed.competitors).toEqual(wanted);
    const stored = (await readAdminDefaults(ORG_USER)).masterValues.filter((m) => m.category === "competitors");
    expect(stored.map((m) => m.value), "the competitors master").toEqual(wanted);
    // Real flow: Masters -> competitors. Current (D-124): the Masters tab cannot load.
    const admin = new AdminPage(page);
    await admin.goto();
    await expect(admin.main.getByRole("row").filter({ hasText: "Avery Weigh-Tronix" }).first(), "competitor master row").toBeVisible({ timeout: 2_000 });
    // The competitor choice on an opportunity offers exactly these five values.
    const opps = new ModuleList(page, "opps");
    await opps.goto();
    await opps.clickNew();
    await expect(page.locator("#competitor")).toBeVisible();
    expect(await optionTexts(page, "#competitor")).toEqual(wanted);
  });
});

test.describe("ADM - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-ADM-011", async ({ page }, testInfo) => {
    // The sidebar has no Administration entry (positive signal first: the sidebar rendered its Leads link).
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByText("Leads", { exact: true }).first()).toBeVisible();
    await expect(nav.getByText("Administration", { exact: true }), "Administration is hidden from the sidebar").toHaveCount(0);
    // Direct URL: spec = access denied. Current (D-129): the page opens with every tab and a misleading 'Manager - read-only' banner.
    const settings = page.waitForResponse((r) => r.request().method() === "GET" && /\/organizations\/me\/settings$/.test(r.url()));
    await page.goto("/administration");
    expect((await settings).status(), "the organization settings request is refused").toBe(403);
    await knownDefect(testInfo, "D-129", async () => {
      await expect(page.getByText("Organization settings & configuration"), "the Administration page is not shown").toBeHidden({ timeout: 2_000 });
    });
    await expect(page.getByText("Organization settings & configuration"), "current: the page shell is shown (remove with D-129)").toBeVisible();
    await expect(page.getByText("Forbidden resource").first()).toBeVisible();
    // API: every Administration read / write is refused with the exact message.
    const sales = await apiAs("salesExec1");
    for (const key of ["masters", "rolePermissions", "fieldPermissions", "businessCalendar", "holidays", "automationRules", "docTemplates", "approvalRules", "slaPolicies"]) {
      const r = await sales.get(`/modules/${key}?limit=1`);
      expect(r.status, `GET ${key}`).toBe(403);
      expect(ApiClient.message(r)).toBe(forbidden("read", key));
    }
    const write = await sales.patch("/modules/rolePermissions/00000000-0000-0000-0000-000000000000", { canCreate: true });
    expect(write.status, "PATCH rolePermissions").toBe(403);
    expect(ApiClient.message(write)).toBe(forbidden("update", "rolePermissions"));
    const org = await sales.get("/organizations/me/settings");
    expect(org.status, "GET organization settings").toBe(403);
    expect(ApiClient.message(org)).toBe("Forbidden resource");
    const orgWrite = await sales.patch("/organizations/me/settings", {});
    expect(orgWrite.status, "PATCH organization settings").toBe(403);
  });
});
