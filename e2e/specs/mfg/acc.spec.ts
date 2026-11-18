// e2e/specs/mfg/acc.spec.ts - ACC module (TC-ACC-001..008): accounts, duplicates, plants, status, owner, 360 tabs, search.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { detailUrl } from "../../mfg/routes";
import { uniqueGstin, uniqueTag } from "../../mfg/tag";

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
const accountOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/accounts/${id}`), "read account");
const idsOf = (r: ApiResult): string[] => (r.body.data ?? []).map((a) => a.id as string);
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const DETAIL_RE = /\/accounts\/[0-9a-f-]{36}$/;

const asRole = async <T>(browser: Browser, role: MfgRoleKey, fn: (page: Page) => Promise<T>): Promise<T> => {
  const ctx = await browser.newContext({ storageState: authFile(role) });
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
};

test.describe("ACC - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-ACC-001", async ({ page }) => {
    test.slow(); // first test of a cold stack: the app's first page load can take well over a minute
    const api = await apiAs("salesExec1");
    const tag = uniqueTag("A1");
    const name = `${tag} Steel Pvt Ltd`;
    const gstin = uniqueGstin();
    const list = new ModuleList(page, "accounts");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // Only the required fields + GSTIN: Annual potential (money, D-6) is left blank, and Sub-industry / Credit terms are not filled
    // (their registry keys do not match the DTO keys, see D-25).
    await drawer.fill({
      name, short: tag, type: "Customer", industry: "Steel & metals", gstin, city: "Pune", state: "Maharashtra", territory: "West",
    });
    await drawer.save();
    await page.waitForURL(DETAIL_RE);
    const id = idFromUrl(page);
    const detail = new ModuleDetail(page);
    await detail.expectAction("Mark dormant");
    expect(await detail.statusText()).toBe("Active");

    const account = await accountOf(api, id);
    expect(account).toMatchObject({ name, short: tag, type: "Customer", industry: "Steel & metals", gstin, city: "Pune", state: "Maharashtra", territory: "West", status: "Active" });
    expect(account.ownerId).toBe(await userIdOf("salesExec1"));
    // appears in the list
    await list.goto();
    await list.search(tag);
    await expect(list.row(tag)).toBeVisible();
    // Spec: the form's optional fields (Sub-industry, Credit terms, Tags) are saved. The drawer posts them under registry keys the
    // API rejects (sub_industry / credit are not DTO properties, tags is a string, not an array): 400 for any account that fills them.
    const withOptional = await api.post("/modules/accounts", {
      name: `${uniqueTag("A1")} Opt`, short: uniqueTag("A1"), type: "Customer", industry: "Cement", city: "Pune", state: "Maharashtra",
      territory: "West", sub_industry: "Ready mix", credit: "30 days", tags: "key-account",
    });
    await knownDefect(test.info(), "D-25", async () => {
      expect(withOptional.status, "the drawer's optional-field payload is accepted (if this passes, D-25 is fixed: remove the wrapper)").toBe(201);
    });
  });

  tc("TC-ACC-002", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && /\/modules\/accounts$/.test(r.url())) posts.push(r.url()); });
    const list = new ModuleList(page, "accounts");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    await drawer.save();
    await expect(drawer.error).toHaveText(/^Please fix (the highlighted field|the \d+ highlighted fields) below\.$/);
    for (const key of ["name", "short", "type", "industry", "city", "state", "territory"]) {
      await expect(page.locator(`#${key}`), `${key} marked invalid`).toHaveClass(/border-destructive/);
    }
    await expect(page.getByRole("heading", { name: "New Account" })).toBeVisible(); // drawer stays open
    expect(page.url()).toMatch(/\/accounts$/);
    expect(posts, "no create request is sent").toHaveLength(0);
    // server side: the same blank body is a 400 and creates nothing
    const api = await apiAs("salesExec1");
    expect((await api.post("/modules/accounts", {})).status).toBe(400);
  });

  tc("TC-ACC-003", async ({ page }) => {
    // Spec (Flow: 'Duplicate GSTIN / name -> Block + link existing'): flag the duplicate before save and link to the existing account.
    // Current (verification note): the form warns on blur by name ("A matching account already exists" + Open existing) but never
    // blocks saving, and the backend does not enforce uniqueness on manual create.
    const api = await apiAs("salesExec1");
    const gstin = uniqueGstin();
    const base = await build.account(api, { gstin });
    const list = new ModuleList(page, "accounts");
    const drawer = new ModuleDrawer(page);

    // 1. same name: banner, Open existing lands on the existing record
    await list.goto();
    await list.clickNew();
    await drawer.fill({ name: base.name });
    await expect(drawer.duplicateBanner).toBeVisible();
    await drawer.openExisting();
    await page.waitForURL(DETAIL_RE);
    expect(idFromUrl(page)).toBe(base.id);

    // 2. same name: Save is refused (duplicates are blocked) and no second account is created
    await list.goto();
    await list.clickNew();
    const dupTag = uniqueTag("A3");
    await drawer.fill({ name: base.name });
    await expect(drawer.duplicateBanner).toBeVisible();
    await drawer.fill({ short: dupTag, type: "Customer", industry: "Cement", city: "Pune", state: "Maharashtra", territory: "West" });
    await drawer.save();
    await expect(drawer.error).toBeVisible();
    await expect(page).toHaveURL(/\/accounts$/);
    const sameName = (await api.get(`/modules/accounts?search=${encodeURIComponent(base.name)}`)).body.data ?? [];
    expect(sameName.map((a) => a.id), "only the original account exists").toEqual([base.id]);

    // 3. same GSTIN with a different name. Spec: banner. The blur check searches by name/short only, so a GSTIN-only
    // duplicate is never detected.
    await list.goto();
    await list.clickNew();
    const searched = page.waitForResponse((r) => r.url().includes("/modules/accounts?") && r.url().includes("search="));
    await drawer.fill({ gstin });
    expect((await searched).status()).toBe(200); // the duplicate check has completed
    await expect(drawer.duplicateBanner).toBeVisible({ timeout: 1_000 });

    // Server side: a duplicate GSTIN is rejected (409 Conflict) and names the account it clashes with.
    const second = await api.post("/modules/accounts", {
      name: `${uniqueTag("A3")} Again`, short: uniqueTag("A3"), type: "Customer", industry: "Cement", city: "Pune", state: "Maharashtra",
      territory: "West", gstin,
    });
    expect(second.status, "duplicate account is rejected").toBe(409);
    expect(ApiClient.message(second)).toContain("GSTIN already exists");
  });

  tc("TC-ACC-004", async ({ page }) => {
    // Spec: add Plant 1 and Plant 2 from the account's Plants tab; each shows in the tab and is offered on contact forms.
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const detail = new ModuleDetail(page);
    await detail.goto("accounts", account.id);
    await detail.tab("Plants");
    await expect(page.getByText("No data yet.")).toBeVisible(); // settled empty state of the Plants table
    const empty = await api.get(`/modules/accounts/${account.id}/table/plants`);
    expect(empty.status).toBe(200);
    expect(empty.body.rows).toEqual([]);
    await expect(page.getByRole("button", { name: /add plant|new plant/i })).toBeVisible({ timeout: 1_000 });
    await build.plant(api, account.id, "Plant 1");
    await build.plant(api, account.id, "Plant 2");
    const table = await api.get(`/modules/accounts/${account.id}/table/plants`);
    expect((table.body.rows as { name?: string; cells?: unknown }[]).length, "both plants are listed").toBe(2);
    await detail.goto("accounts", account.id);
    await detail.tab("Plants");
    await expect(page.getByText("Plant 1")).toBeVisible();
    await expect(page.getByText("Plant 2")).toBeVisible();
  });

  tc("TC-ACC-007", async ({ page, browser }) => {
    const api = await apiAs("salesExec1");
    const director = await apiAs("director");
    const serviceManager = await apiAs("serviceManager");
    const a = await build.account(api);
    const b = await build.account(api); // control account: its records must never appear on A's tabs
    const contactA = await build.contact(api, a.id);
    const contactB = await build.contact(api, b.id);
    const oppA = await build.opportunity(api, a.id);
    const oppB = await build.opportunity(api, b.id);
    const actSubject = (t: string): string => `${t} follow-up call`;
    const actA = uniqueTag("ACTA");
    const actB = uniqueTag("ACTB");
    for (const [accountId, subject] of [[a.id, actSubject(actA)], [b.id, actSubject(actB)]]) {
      ok(await api.post("/modules/activities", { type: "Call", subject, accountId, priority: "Medium", dueDate: isoDate(2) }), "create activity");
    }
    // Full chain per account (as Director / Operations): sent quotation -> accepted PO (creates the sales order and payment milestones)
    // -> commissioned order (creates the installed asset). The quotation of the chain is the account's one quotation.
    const operations = await apiAs("operations");
    const product = await build.product(director);
    const chain = async (accountId: string, opportunityId: string, serial: string) => {
      // the quotation is created and submitted by the Sales Executive (so it is in their own-record scope), approved/sent by Director
      const quote = await build.quotation(api, { opportunityId, accountId, productId: product.id });
      const submitted = ok(await api.action("quotes", quote.id, "Submit for approval"), "submit quotation");
      if (submitted.body.status !== "Approved") ok(await director.action("quotes", quote.id, "Approve"), "approve quotation");
      ok(await director.action("quotes", quote.id, "Mark sent"), "mark sent");
      const po = await build.acceptedPo(director, { opportunityId, accountId, quotationId: quote.id });
      const order = await build.salesOrderFor(operations, po.id);
      const { assetId } = await build.commissionedOrder(operations, order.id, serial);
      return { quoteId: quote.id, orderId: order.id, assetId };
    };
    const chainA = await chain(a.id, oppA.id, uniqueTag("SNA"));
    const chainB = await chain(b.id, oppB.id, uniqueTag("SNB"));
    const quoteA = { id: chainA.quoteId };
    const quoteB = { id: chainB.quoteId };
    const ticketA = await build.ticket(serviceManager, { accountId: a.id });
    const ticketB = await build.ticket(serviceManager, { accountId: b.id });

    const detail = new ModuleDetail(page);
    await detail.goto("accounts", a.id);
    const panel = page.getByRole("tabpanel");
    const expectRows = async (tab: string, own: string | null, other: string | null, count: number): Promise<void> => {
      await detail.tab(tab);
      if (own) await expect(panel.getByText(own).first()).toBeVisible(); // positive loaded signal first
      await expect(panel.getByRole("row")).toHaveCount(count + 1); // header + own rows only
      if (other) await expect(panel.getByText(other)).toHaveCount(0);
    };
    await expectRows("Contacts", contactA.name, contactB.name, 1);
    await expectRows("Opportunities", oppA.title, oppB.title, 1);
    await expectRows("Activities", actSubject(actA), actSubject(actB), 1);
    await expectRows("Quotations", null, null, 1);
    // Orders / Installed assets / Payments: the case's viewer (Sales Executive) may lack record access to them, which would show as a
    // misleading "No ... yet" - so first compare what the executive's API returns with the Director's (source of truth).
    const related = (client: ApiClient, id: string, tab: string): Promise<ApiResult> => client.get(`/modules/accounts/${id}/related/${tab}`);
    const tabs = [["Orders", "orders", "sorders"], ["Installed assets", "assets", "assets"], ["Payments", "payments", "payments"]] as const;
    const truth: Record<string, string[]> = {};
    for (const [, key] of tabs) {
      const ids = idsOf(await related(director, a.id, key));
      truth[key] = ids;
      expect(ids.length, `${key} rows of account A (Director)`).toBeGreaterThan(0);
      expect(idsOf(await related(director, b.id, key)).filter((id) => ids.includes(id)), `${key}: no row shared with account B`).toEqual([]);
    }
    expect(truth.orders).toEqual([chainA.orderId]);
    expect(truth.assets).toEqual([chainA.assetId]);
    const sameAsModuleList = async (moduleKey: string, key: string): Promise<void> => {
      // tab consistent with the module list for the same account (list filtered client-side by accountId)
      const all = (await director.get(`/modules/${moduleKey}?limit=100`)).body.data ?? [];
      expect(all.filter((r) => r.accountId === a.id).map((r) => r.id as string).sort(), `${key}: tab vs module list`).toEqual([...(truth[key] ?? [])].sort());
    };
    const execSees = await Promise.all(tabs.map(async ([, key]) => idsOf(await related(api, a.id, key))));
    const execCanSee = tabs.every(([, key], i) => (execSees[i] ?? []).join() === (truth[key] ?? []).join());
    if (execCanSee) {
      for (const [tab, key, moduleKey] of tabs) {
        await expectRows(tab, null, null, truth[key]?.length ?? 0);
        await sameAsModuleList(moduleKey, key);
      }
    } else {
      // D-32: the Sales Executive's Orders / Installed assets / Payments tabs show "No ... yet" (empty page, no access error) although
      // rows exist; the tabs are then asserted as Director.
      test.info().annotations.push({ type: "note", description: "Sales Executive cannot see order/asset/payment rows on the account tabs; tabs asserted as Director (D-32)" });
      await knownDefect(test.info(), "D-32", async () => {
        expect(execSees.map((x) => x.length), "Sales Executive sees the account's orders / assets / payments").toEqual(tabs.map(([, key]) => truth[key]?.length ?? 0));
      });
      const ctx = await browser.newContext({ storageState: authFile("director") });
      try {
        const dp = await ctx.newPage();
        const dd = new ModuleDetail(dp);
        await dd.goto("accounts", a.id);
        const dpanel = dp.getByRole("tabpanel");
        for (const [tab, key, moduleKey] of tabs) {
          await dd.tab(tab);
          await expect(dpanel.getByRole("row")).toHaveCount((truth[key]?.length ?? 0) + 1);
          await sameAsModuleList(moduleKey, key);
        }
      } finally {
        await ctx.close();
      }
    }

    // API (source of truth for the tab data): each related tab lists exactly this account's rows.
    expect(idsOf(await api.get(`/modules/accounts/${a.id}/related/contacts`))).toEqual([contactA.id]);
    expect(idsOf(await api.get(`/modules/accounts/${a.id}/related/opps`))).toEqual([oppA.id]);
    expect(idsOf(await api.get(`/modules/accounts/${a.id}/related/quotes`))).toEqual([quoteA.id]);
    expect(idsOf(await api.get(`/modules/accounts/${b.id}/related/quotes`))).toEqual([quoteB.id]);
    // service tab (a rep only sees tickets assigned to them, so read it as Director)
    expect(idsOf(await director.get(`/modules/accounts/${a.id}/related/service`))).toEqual([ticketA.id]);
    expect(idsOf(await director.get(`/modules/accounts/${b.id}/related/service`))).toEqual([ticketB.id]);
  });

  tc("TC-ACC-008", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const tag = uniqueTag("A8");
    const gstin = uniqueGstin();
    const city = `Ranchi${tag.slice(-4)}`;
    const target = await build.account(api, { name: `${tag} Rolling Mills Pvt Ltd`, short: tag, gstin, city });
    const other = await build.account(api, { name: `${uniqueTag("A8")} Cement Ltd` });

    // partial name (case-insensitive) matches, API and UI
    const partial = `${tag} Rolling`.slice(0, -2).toLowerCase(); // partial, lower-case name
    const byName = await api.get(`/modules/accounts?search=${partial}`);
    expect(idsOf(byName)).toContain(target.id);
    expect(idsOf(byName)).not.toContain(other.id);
    const list = new ModuleList(page, "accounts");
    await list.goto();
    await list.search(partial);
    await expect(list.row(tag)).toBeVisible();
    await expect(list.row(other.name.split(" ")[0] ?? "")).toHaveCount(0);

    // Spec: GSTIN and city are searchable. The account list search only matches name / display name.
    const byGstin = await api.get(`/modules/accounts?search=${gstin}`);
    expect(byGstin.status).toBe(200); // settled response
    expect(idsOf(byGstin), "search by GSTIN finds the account").toContain(target.id);
    const byCity = await api.get(`/modules/accounts?search=${city}`);
    expect(byCity.status).toBe(200);
    expect(idsOf(byCity), "search by city finds the account").toContain(target.id);
    const gstinSearched = page.waitForResponse((r) => r.url().includes("/modules/accounts?") && r.url().includes(`search=${gstin}`));
    await list.search(gstin);
    expect((await gstinSearched).status()).toBe(200); // the GSTIN search has completed
    await expect(page.getByText(/no accounts/i).or(page.getByRole("row").filter({ hasText: tag }))).toBeVisible();
    await expect(list.row(tag)).toBeVisible({ timeout: 1_000 });
  });
});

test.describe("ACC - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-ACC-005", async ({ page }) => {
    const api = await apiAs("salesManager");
    const account = await build.account(api);
    const detail = new ModuleDetail(page);
    await detail.goto("accounts", account.id);
    expect(await detail.statusText()).toBe("Active");
    // Active: Mark dormant offered, Reactivate not (UI + server guard)
    await detail.expectNoAction("Reactivate");
    await expectActionRejected(api, "accounts", account.id, "Reactivate", {}, "Cannot Reactivate an account in status 'Active'.");
    await detail.action("Mark dormant");
    await expect.poll(() => detail.statusText()).toBe("Dormant");
    expect((await accountOf(api, account.id)).status).toBe("Dormant");
    // Dormant: Reactivate offered, Mark dormant not
    await detail.expectAction("Reactivate");
    await detail.expectNoAction("Mark dormant");
    await expectActionRejected(api, "accounts", account.id, "Mark dormant", {}, "Cannot Mark dormant an account in status 'Dormant'.");
    await detail.action("Reactivate");
    await expect.poll(() => detail.statusText()).toBe("Active");
    expect((await accountOf(api, account.id)).status).toBe("Active");

    // On hold (set through Edit/PATCH - no action leads there): both actions are allowed.
    const held = await build.account(api);
    ok(await api.patch(`/modules/accounts/${held.id}`, { status: "On hold" }), "put on hold");
    ok(await api.action("accounts", held.id, "Reactivate"), "reactivate from On hold");
    expect((await accountOf(api, held.id)).status).toBe("Active");
    ok(await api.patch(`/modules/accounts/${held.id}`, { status: "On hold" }), "put on hold again");
    ok(await api.action("accounts", held.id, "Mark dormant"), "mark dormant from On hold");
    expect((await accountOf(api, held.id)).status).toBe("Dormant");
  });

  tc("TC-ACC-006", async ({ page, browser }) => {
    const manager = await apiAs("salesManager");
    const exec1 = await apiAs("salesExec1");
    const exec2 = await apiAs("salesExec2");
    const [exec1Id, exec2Id] = await Promise.all([userIdOf("salesExec1"), userIdOf("salesExec2")]);
    const account = await build.account(manager, { ownerId: exec1Id });
    expect((await accountOf(exec1, account.id)).ownerId).toBe(exec1Id);
    expect((await exec2.get(`/modules/accounts/${account.id}`)).status).toBe(404);

    const detail = new ModuleDetail(page);
    await detail.goto("accounts", account.id);
    await detail.action("Reassign owner");
    const field = page.locator("#action-ask-field");
    await expect(field).toBeVisible();
    // Spec: pick rep B. The 'owner' prompt is a free-text box taking a raw user id (no user picker), same root cause as D-18.
    await expect(field).toHaveJSProperty("tagName", "SELECT", { timeout: 1_000 });
    await detail.answerPrompt(exec2Id);
    await expect.poll(async () => (await accountOf(manager, account.id)).ownerId).toBe(exec2Id);
    expect((await accountOf(exec2, account.id)).ownerId).toBe(exec2Id); // B now sees it
    expect((await exec1.get(`/modules/accounts/${account.id}`)).status).toBe(404); // A (own-only role) no longer does
    expect(idsOf(await exec1.get(`/modules/accounts?search=${encodeURIComponent(account.name)}`))).toEqual([]);
    await asRole(browser, "salesExec2", async (p) => {
      await p.goto(detailUrl("accounts", account.id));
      await expect(p.getByText(account.name).first()).toBeVisible({ timeout: 30_000 }); // fresh context: cold page load
    });

    // Spec (§4 Ownership audit): the change is recorded in the audit trail. The backend has no GET /modules/:key/:id/audit route.
    await detail.goto("accounts", account.id);
    await page.getByRole("tab", { name: "Audit trail" }).click();
    await expect(page.getByRole("tabpanel").getByRole("row").filter({ hasText: /owner/i })).toBeVisible({ timeout: 1_000 });
  });
});
