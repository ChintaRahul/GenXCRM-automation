// e2e/specs/mfg/env.spec.ts - ENV module: access, login, navigation, role matrix.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { authFile, MFG_PASSWORD, MFG_USERS, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { LoginPage } from "../../pages/LoginPage";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { listUrl } from "../../mfg/routes";
import { uniqueTag } from "../../mfg/tag";

// ---- Role matrix, a COPY of PERM_SPEC in backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts
// (ops: C R U D E per module). It is a copy because e2e is a separate project and importing that backend file would drag in
// the Prisma client enums; expectPermSpecInSync() (called by TC-ENV-005) fails if the copy drifts from the backend. ----
const PERM_SPEC: Record<string, string> = {
  "Sales Head": "ALL:CRUE",
  "Sales Manager": "ALL:CRUE",
  "Sales Executive":
    "leads,accounts,contacts,activities,opps,visits,demos,quotes:CRU;rfqs,products,approvals,pos,sorders,dispatch,payments,assets,amc,service,nurturing,templates:R;reports:RE",
  "Application Engineer": "rfqs,visits,demos,activities:CRU;opps,accounts,contacts,products,service,assets:R",
  "Commercial / Estimation": "costing,quotes,approvals,products:CRUDE;opps,rfqs,accounts:R;pos:CRU",
  Operations: "sorders,dispatch:RU;pos,accounts,products,assets:R",
  Accounts: "payments:RUE;sorders,pos,accounts,dispatch,billing:R;reports:RE",
  "Service Manager": "service,assets,amc:CRUDE;accounts,contacts,sorders:R",
  "Service Engineer": "service:RU;assets,amc,accounts:R",
};
const ROLE_LABEL: Partial<Record<MfgRoleKey, string>> = {
  salesHead: "Sales Head", salesManager: "Sales Manager", salesExec1: "Sales Executive", appEngineer: "Application Engineer",
  commercial: "Commercial / Estimation", operations: "Operations", accounts: "Accounts", serviceManager: "Service Manager",
  serviceEngineer: "Service Engineer",
};
// Modules that have a routed list page (reports is a dashboard page, not a module list).
const MODULES = [
  "leads", "accounts", "contacts", "activities", "opps", "rfqs", "visits", "demos", "products", "costing", "quotes", "approvals",
  "pos", "sorders", "dispatch", "payments", "assets", "amc", "service",
];
// "Costing & margin" field-security default: every role outside this list is whole-record blocked from costing,
// even where PERM_SPEC would grant read (Sales Manager: ALL:CRUE).
const COSTING_UNRESTRICTED: MfgRoleKey[] = ["superAdmin", "director", "salesHead", "commercial"];

const opsFor = (role: MfgRoleKey, moduleKey: string): string => {
  if (role === "superAdmin" || role === "director") return "CRUDE";
  const label = ROLE_LABEL[role];
  const spec = label === undefined ? undefined : PERM_SPEC[label];
  if (spec === undefined) throw new Error(`role ${role} has no entry in the ENV role matrix - add it to ROLE_LABEL / PERM_SPEC`);
  let ops = "";
  for (const part of spec.split(";")) {
    const [mods, o] = part.split(":");
    if (mods === "ALL" || mods?.split(",").includes(moduleKey)) ops = o ?? "";
  }
  if (moduleKey === "costing" && !COSTING_UNRESTRICTED.includes(role)) return "";
  return ops;
};

/** Fails when the PERM_SPEC copy above no longer equals the backend's PERM_SPEC string literals. */
const expectPermSpecInSync = (): void => {
  const src = readFileSync(join(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
  const body = /const PERM_SPEC[^=]*=\s*\{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
  const backend: Record<string, string> = {};
  for (const m of body.matchAll(/(?:'([^']+)'|(\w+))\s*:\s*'([^']*)'/g)) backend[m[1] ?? m[2] ?? ""] = m[3] ?? "";
  expect(Object.keys(backend).length, "could not parse backend PERM_SPEC").toBe(9);
  expect(PERM_SPEC, "role matrix drifted from backend PERM_SPEC — update env.spec.ts").toEqual(backend);
};

const FAKE_ID = "00000000-0000-0000-0000-000000000000";

/** Server-side matrix for one role: read / create / update / export per module (create+update probed with empty or unknown-id calls, which never write). */
const expectApiMatrix = async (role: MfgRoleKey): Promise<void> => {
  const api = await apiAs(role);
  for (const key of MODULES) {
    const ops = opsFor(role, key);
    const list = await api.get(`/modules/${key}?page=1&limit=1`);
    expect(list.status, `${role} read ${key}`).toBe(ops.includes("R") ? 200 : 403);
    const post = await api.post(`/modules/${key}`, {});
    if (ops.includes("C")) expect(post.status, `${role} create ${key} passes the permission guard (400 validation)`).toBe(400);
    else expect(post.status, `${role} create ${key}`).toBe(403);
    const patch = await api.patch(`/modules/${key}/${FAKE_ID}`, {});
    if (ops.includes("U")) expect(patch.status, `${role} update ${key} passes the guard, then 404 for the unknown id`).toBe(404);
    else expect(patch.status, `${role} update ${key}`).toBe(403);
    // Export denial (no E op) is NOT asserted here: the server does not enforce it (see TC-ENV-005 / report).
    if (ops.includes("E")) expect((await api.get(`/modules/${key}/export`)).status, `${role} export ${key}`).toBe(200);
  }
};

/**
 * UI matrix for the signed-in page: readable module -> list renders (search box + Export); no read -> the list shows
 * "Couldn't load ..." (generic fetch error for 403) or, for costing's field-security block, "Costing is restricted.".
 * Each module is a single goto + one assertion.
 */
const expectUiMatrix = async (page: Page, role: MfgRoleKey, modules: string[] = MODULES): Promise<void> => {
  for (const key of modules) {
    const ops = opsFor(role, key);
    await page.goto(listUrl(key));
    const main = page.getByRole("main");
    if (ops.includes("R")) {
      await expect(new ModuleList(page, key).searchBox, `${role} sees ${key} list`).toBeVisible({ timeout: 15_000 });
      // positive loaded signal first (rows table or the empty state), only then the absence check
      await expect(main.locator("table").or(main.getByText(/^No .+ match these filters\./)).first(), `${role} ${key} list loaded`).toBeVisible({ timeout: 15_000 });
      await expect(main.getByText(/is restricted|Couldn't load|don't have access/)).toHaveCount(0);
    } else if (key === "costing") {
      // The "Costing is restricted." banner only lasts while useModuleAccess loads; roles without read on fieldPermissions
      // (all but the managers) fall back to the generic load error (D-5, asserted in TC-ENV-012), so accept both here.
      await expect(main.getByText(/Costing is restricted\.|don't have access to this page/i), `${role} blocked from costing`).toBeVisible();
      await expect(main.getByRole("table"), `${role} sees no costing rows`).toHaveCount(0);
    } else {
      await expect(main.getByText(/don't have access/i), `${role} is told they have no access to ${key}`).toBeVisible();
    }
  }
};

/** Positive control check: roles with Create/Export see New / Export on a list they can read. */
const expectControls = async (page: Page, role: MfgRoleKey, key: string): Promise<void> => {
  const ops = opsFor(role, key);
  await page.goto(listUrl(key));
  const list = new ModuleList(page, key);
  await expect(list.searchBox).toBeVisible();
  if (ops.includes("E")) await expect(list.exportButton).toBeVisible();
  if (ops.includes("C")) await expect(page.getByRole("button", { name: /^New [^(]/ })).toBeVisible();
};

const newCtx = (browser: Browser, role: MfgRoleKey): Promise<BrowserContext> =>
  browser.newContext({ storageState: authFile(role), baseURL: "http://localhost:5174" });

const SIDEBAR_LINKS = [
  "Dashboard", "Leads", "Reports", "Accounts", "Contacts", "Activities", "Opportunities", "RFQs", "Site visits", "Demos & trials",
  "Products", "Costing", "Quotations", "Approvals", "Purchase orders", "Sales orders", "Dispatch", "Payments",
  "Installed assets", "AMC & warranty", "Service tickets", "Nurturing",
];
const NON_RELATED_TABS = ["Overview", "Plants", "Stage history"];
const EDTECH_ONLY = ["Courses", "Register", "Invoices"];

test.describe("ENV - Super Admin sidebar", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-ENV-001", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav:visible");
    for (const name of SIDEBAR_LINKS) await expect(nav.getByRole("link", { name: new RegExp(`^${name}( |$)`) }), `sidebar link ${name}`).toBeVisible();
    for (const name of EDTECH_ONLY) await expect(nav.getByRole("link", { name: new RegExp(`^${name}( |$)`) }), `no EdTech link ${name}`).toHaveCount(0);
  });
});

test.describe("ENV - login", () => {
  tc("TC-ENV-002", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://localhost:5174" });
    const page = await ctx.newPage();
    const login = new LoginPage(page);
    await login.goto();
    await login.login(MFG_USERS.salesExec1.email, MFG_PASSWORD);
    await expect(page).toHaveURL("/");
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeTruthy();
    await page.getByRole("button", { name: "Account menu" }).click(); // logout is available
    await expect(page.getByRole("menuitem", { name: "Sign Out" })).toBeVisible();
    await ctx.close();
  });

  tc("TC-ENV-003", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://localhost:5174" });
    const page = await ctx.newPage();
    const login = new LoginPage(page);
    await login.goto();
    await login.login(MFG_USERS.salesExec1.email, "Wrong-Password-1");
    await expect(login.errorMessage).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // generic message: does not say which field was wrong
    await expect(login.errorMessage).not.toHaveText(/wrong password|incorrect password|no (such )?user|not found|email.*(wrong|invalid)/i);
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
    await ctx.close();
  });

  tc("TC-ENV-004", async () => {});
});

test.describe("ENV - Sales Executive access", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-ENV-005", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    expectPermSpecInSync();
    await expectApiMatrix("salesExec1");
    await expectUiMatrix(page, "salesExec1");
    await expectControls(page, "salesExec1", "leads");
    // Spec: the server enforces the Export op and read-only modules show no Export control (Sales Executive has no
    // Export on payments). Current product enforces neither (report, D-1 / D-2).
    const api = await apiAs("salesExec1");
    await knownDefect(testInfo, "D-1", async () => {
      expect((await api.get("/modules/payments/export")).status, "export on payments without E op").toBe(403);
    });
    await page.goto(listUrl("payments"));
    await expect(new ModuleList(page, "payments").searchBox).toBeVisible();
    await knownDefect(testInfo, "D-2", async () => {
      await expect(page.getByRole("main").getByRole("button", { name: /export/i })).toHaveCount(0, { timeout: 2000 });
    });
  });

  tc("TC-ENV-012", async ({ page }, testInfo) => {
    const access = page.waitForResponse((r) => r.url().includes("/modules/fieldPermissions"));
    await page.goto("/costing");
    await access;
    await page.waitForLoadState("networkidle");
    // No cost data in any case: the list settles to an error/banner, never a table.
    await expect(page.getByRole("main").getByText(/Costing is restricted\.|don't have access to this page/i)).toBeVisible();
    await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
    // Spec: a restricted banner. useModuleAccess shows it only until its fieldPermissions fetch returns; Sales Executive
    // has no read on fieldPermissions (403), so the hook fails open and the settled page is the generic load error (D-5).
    await knownDefect(testInfo, "D-5", async () => {
      await expect(page.getByRole("main").getByText("Costing is restricted."), "restricted banner persists").toBeVisible({ timeout: 2000 });
    });
    const api = await apiAs("salesExec1");
    const res = await api.get("/modules/costing");
    expect(res.status).toBe(403);
    // Sales Executive has no read row for costing, so the permission guard answers before the
    // service-level 'Costing is restricted.' (README 12) message; either way no cost data is returned.
    expect(ApiClient.message(res)).toMatch(/Costing is restricted\.|does not have 'read' access to 'costing'/);
    expect(res.body.data).toBeUndefined();
  });

  tc("TC-ENV-013", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const acc = await build.account(api);
    const opp = await build.opportunity(api, acc.id);
    const detail = new ModuleDetail(page);
    const check = async (key: string, id: string, tabs: string[]): Promise<void> => {
      await detail.goto(key, id);
      for (const label of tabs) {
        await expect(page.getByRole("tab", { name: label, exact: true }), `${key} tab ${label}`).toBeVisible();
        await detail.tab(label);
        await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("data-state", "active");
        // Sales Executive has no Costing access (TC-ENV-005), so the opportunity's Costing tab cannot load records: the app
        // shows a generic "Couldn't load costing." (not the restricted banner) and no cost data. Every other tab must load cleanly.
        const panel = page.getByRole("tabpanel");
        if (label === "Costing") await expect(panel.getByText(/don't have access/i)).toBeVisible();
        else {
          // positive loaded signal (related tabs: a row or the "No ... yet." empty state - the loading state renders only
          // the header; field/table/event tabs: rendered text), then the absence of an error
          if (NON_RELATED_TABS.includes(label)) await expect(panel, `${key} ${label} content rendered`).not.toHaveText("");
          else await expect(panel.locator("tbody tr").or(panel.getByText(/^No .+ yet\./)).first(), `${key} ${label} loaded`).toBeVisible();
          await expect(page.getByText(/Couldn't load|Something went wrong/)).toHaveCount(0);
        }
      }
    };
    await check("accounts", acc.id, [
      "Overview", "Plants", "Contacts", "Opportunities", "Quotations", "Orders", "Installed assets", "Service", "Payments", "Activities",
    ]);
    await check("opps", opp.id, [
      "Overview", "Stage history", "Contacts", "Activities", "Requirements", "Visits", "Demos & trials", "Costing", "Quotations", "PO / Orders",
    ]);
  });

  tc("TC-ENV-014", async ({ page }, testInfo) => {
    // Spec: logout invalidates the session and the old token is rejected (401). Current product: JWTs are
    // stateless with no server-side revocation, so the old token keeps working (see report, Defects found).
    await page.goto("/");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeTruthy();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign Out" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
    await page.goto("/leads"); // protected page redirects to login
    await expect(page).toHaveURL(/\/login/);
    await knownDefect(testInfo, "D-3", async () => {
      const stale = await new ApiClient(token ?? "").get("/modules/leads?page=1&limit=1");
      expect(stale.status).toBe(401);
    });
  });
});

test.describe("ENV - Application Engineer access", () => {
  test.use({ storageState: authFile("appEngineer") });
  tc("TC-ENV-006", async ({ page }) => {
    test.setTimeout(180_000);
    await expectApiMatrix("appEngineer");
    await expectUiMatrix(page, "appEngineer");
    await expectControls(page, "appEngineer", "rfqs");
  });
});

test.describe("ENV - Commercial access", () => {
  test.use({ storageState: authFile("commercial") });
  tc("TC-ENV-007", async ({ page }) => {
    test.setTimeout(180_000);
    await expectApiMatrix("commercial");
    await expectUiMatrix(page, "commercial");
    await expectControls(page, "commercial", "costing");
  });
});

test.describe("ENV - Operations access", () => {
  test.use({ storageState: authFile("operations") });
  tc("TC-ENV-008", async ({ page }) => {
    test.setTimeout(180_000);
    await expectApiMatrix("operations");
    await expectUiMatrix(page, "operations");
  });
});

test.describe("ENV - Accounts access", () => {
  test.use({ storageState: authFile("accounts") });
  tc("TC-ENV-009", async ({ page }) => {
    test.setTimeout(180_000);
    await expectApiMatrix("accounts");
    await expectUiMatrix(page, "accounts");
    await expectControls(page, "accounts", "payments");
  });
});

test.describe("ENV - Service roles access", () => {
  test.use({ storageState: authFile("serviceEngineer") });
  tc("TC-ENV-010", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await expectApiMatrix("serviceEngineer");
    await expectUiMatrix(page, "serviceEngineer");
    // Service Manager additionally has full CRUD+Export on Service / Assets / AMC.
    await expectApiMatrix("serviceManager");
    const ctx = await newCtx(browser, "serviceManager");
    const mgrPage = await ctx.newPage();
    await expectUiMatrix(mgrPage, "serviceManager");
    await expectControls(mgrPage, "serviceManager", "service");
    await ctx.close();
  });
});

test.describe("ENV - Own / Team / All record access", () => {
  tc("TC-ENV-011", async ({ browser }) => {
    const [api1, api2] = await Promise.all([apiAs("salesExec1"), apiAs("salesExec2")]);
    const mine = await build.lead(api1, { company: `${uniqueTag("OWN")} Rep1 Ltd` });
    const theirs = await build.lead(api2, { company: `${uniqueTag("OWN")} Rep2 Ltd` });
    const tagOf = (company: string): string => company.split(" ")[0] ?? company;
    const [tag1, tag2] = [tagOf(mine.company), tagOf(theirs.company)];

    // Server-side record access: rows returned for each tag, per role (OWN / OWN / TEAM / ALL).
    const apiSees = async (role: MfgRoleKey, tag: string): Promise<boolean> => {
      const r = await (await apiAs(role)).get(`/modules/leads?search=${encodeURIComponent(tag)}&limit=50`);
      expect(r.status, `${role} list leads`).toBe(200);
      return (r.body.data ?? []).some((row) => String(row.company).includes(tag));
    };
    const expected: [MfgRoleKey, boolean, boolean][] = [
      ["salesExec1", true, false], ["salesExec2", false, true], ["salesManager", true, true], ["director", true, true], ["superAdmin", true, true],
    ];
    for (const [role, sees1, sees2] of expected) {
      expect(await apiSees(role, tag1), `${role} sees rep1 lead (API)`).toBe(sees1);
      expect(await apiSees(role, tag2), `${role} sees rep2 lead (API)`).toBe(sees2);
    }

    // UI: wait for the search response and a positive signal before asserting absence.
    const uiSees = async (role: MfgRoleKey, tag: string, visible: boolean): Promise<void> => {
      const ctx = await newCtx(browser, role);
      const page = await ctx.newPage();
      const list = new ModuleList(page, "leads");
      await list.goto();
      await expect(list.searchBox).toBeVisible();
      const response = page.waitForResponse((r) => r.url().includes("/modules/leads") && r.url().includes(`search=${tag}`) && r.ok());
      await list.search(tag);
      await response;
      if (visible) await expect(list.row(tag), `${role} sees ${tag}`).toBeVisible();
      else {
        await expect(page.getByRole("main").getByText(/^No .+ match these filters\./), `${role} list settled empty for ${tag}`).toBeVisible();
        await expect(page.getByRole("row").filter({ hasText: tag })).toHaveCount(0);
      }
      await ctx.close();
    };
    await uiSees("salesExec1", tag1, true);
    await uiSees("salesExec1", tag2, false); // OWN
    await uiSees("salesExec2", tag1, false);
    await uiSees("salesManager", tag2, true); // TEAM (both reps are in the manager's team)
    await uiSees("director", tag1, true); // ALL
  });
});

test.describe("ENV - password reset", () => {
  tc("TC-ENV-015", async () => {});
});
