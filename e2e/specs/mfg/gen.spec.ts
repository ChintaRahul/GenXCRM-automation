// e2e/specs/mfg/gen.spec.ts - GEN module: cross-cutting list / search / audit / archive / owner / notification / drawer behaviour (TC-GEN-001..010).
// 001 (global search) and 003 (saved filters) are known GAPS: their bodies assert the SPECIFIED behaviour and tc() expects the failure.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { authFile, MFG_USERS } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { deleteNotification, insertNotification, isDeletedOf, type SoftDeleteTable } from "../../mfg/db";
import { knownDefect } from "../../mfg/guards";
import { listUrl } from "../../mfg/routes";
import { uniqueEmail, uniquePhone, uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
const rows = (r: ApiResult): Rec[] => (r.body.data ?? []) as Rec[];
const idsOf = (r: ApiResult): string[] => rows(r).map((x) => String(x.id));
const archiveQuietly = async (moduleKey: string, ids: string[]): Promise<void> => {
  const director = await apiAs("director");
  for (const id of ids) {
    try {
      await director.post(`/modules/${moduleKey}/${id}/archive`);
    } catch {
      // cleanup only
    }
  }
};
/** Minimal RFC-4180 reader (quoted cells, doubled quotes, newlines inside quotes) - enough for recordsToCsv output. */
const parseCsv = (text: string): string[][] => {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = ""; out.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out;
};
/** Waits for the list response of a module (positive loaded signal) triggered by `action`. */
const listResponse = async (page: Page, moduleKey: string, action: () => Promise<void>, urlPart = ""): Promise<void> => {
  const response = page.waitForResponse((r) => r.request().method() === "GET" && new RegExp(`/modules/${moduleKey}\\?`).test(r.url()) && r.url().includes(urlPart) && r.ok());
  await action();
  await response;
};

// ---- Sales Executive: 001 search, 008 notifications, 009 related tabs, 010 drawer errors ----
test.describe("GEN - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-GEN-001", async () => {
    const api = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const lead = await build.lead(api);
    const account = await build.account(api);
    const opp = await build.opportunity(api, account.id);
    const quote = await build.quotation(api, { opportunityId: opp.id, accountId: account.id });
    const po = await build.po(commercial, { opportunityId: opp.id, accountId: account.id, quotationId: quote.id });
    const poNo = String(ok(await commercial.get(`/modules/pos/${po.id}`), "read PO").body.poNo);
    const gstin = String(ok(await api.get(`/modules/accounts/${account.id}`), "read account").body.gstin);
    try {
      // preconditions are plain Errors; only the cross-module search itself is the expectation
      if (!gstin || !poNo) throw new Error("precondition: account GSTIN / PO number missing");
      const keys: [string, string, string][] = [
        ["company", lead.company, lead.id], ["phone", lead.phone, lead.id], ["email", lead.email, lead.id], ["lead id", lead.id, lead.id],
        ["GSTIN", gstin, account.id], ["account name", account.name, account.id], ["quotation id", quote.id, quote.id], ["PO number", poNo, po.id],
      ];
      const misses: string[] = [];
      for (const [what, q, expectedId] of keys) {
        const res = await api.get(`/search?q=${encodeURIComponent(q)}`);
        if (res.status !== 200 || !JSON.stringify(res.body).includes(expectedId)) misses.push(`${what} (HTTP ${res.status})`);
      }
      // the ONLY expectation: every key finds its record through the cross-module search
      expect(misses, "global search finds the record for every key").toEqual([]);
    } finally {
      await archiveQuietly("pos", [po.id]);
      await archiveQuietly("quotes", [quote.id]);
      await archiveQuietly("opps", [opp.id]);
      await archiveQuietly("accounts", [account.id]);
      await archiveQuietly("leads", [lead.id]);
    }
  });

  tc("TC-GEN-008", async ({ page, browser }) => {
    const mail = MFG_USERS.salesExec1.email;
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    const title = `${uniqueTag("NTF")} follow-up due`;
    const ids: string[] = [];
    const unread = async (client: ApiClient): Promise<number> => Number(ok(await client.get("/notifications"), "inbox").body.unreadCount);
    const flags = async (client: ApiClient): Promise<Map<string, boolean>> =>
      new Map((ok(await client.get("/notifications?limit=50"), "inbox").body.data as unknown as { title: string; isRead: boolean }[]).map((n) => [n.title, n.isRead]));
    try {
      // Shared-state note: the inboxes belong to seeded users that other specs also read (SLA specs); this test only touches its own NTF- rows,
      // except "Mark all read" on salesExec2's inbox, which marks that user's other unread rows read too (nothing else asserts on them).
      ids.push(await insertNotification(mail, { title: `${title} A`, body: "First e2e notification", link: `/leads/${lead.id}` }));
      ids.push(await insertNotification(mail, { title: `${title} B`, body: "Second e2e notification", link: "/leads" }));
      const before = await unread(api);
      expect(before, "both inserted notifications are unread").toBeGreaterThanOrEqual(2);
      expect((await flags(api)).get(`${title} A`), "newest notifications are listed first and unread").toBe(false);

      // Bell: unread badge, listed items, opening one marks it read and goes to its link.
      await page.goto("/");
      const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
      await expect(bell, "bell shows an unread badge").toBeVisible();
      await bell.click();
      const itemA = page.getByRole("button", { name: new RegExp(`${title} A`) });
      await expect(itemA, "notification A is listed in the bell").toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(`${title} B`) }), "notification B is listed in the bell").toBeVisible();
      await itemA.click();
      await expect(page).toHaveURL(new RegExp(`/leads/${lead.id}$`));
      await expect.poll(async () => (await flags(api)).get(`${title} A`), { message: "A is marked read after opening it" }).toBe(true);
      expect((await flags(api)).get(`${title} B`), "B stays unread").toBe(false);
      await expect.poll(async () => unread(api), { message: "unread count dropped (at least by the opened notification)" }).toBeLessThanOrEqual(before - 1);

      // Mark all read (own inbox of a second user so the Sales Executive inbox keeps its other unread rows).
      const mail2 = MFG_USERS.salesExec2.email;
      const mineId = await insertNotification(mail2, { title: `${title} C`, body: "Third e2e notification", link: "/leads" });
      ids.push(mineId);
      const ctx2 = await browser.newContext({ storageState: authFile("salesExec2"), baseURL: "http://localhost:5174" });
      try {
        const page2 = await ctx2.newPage();
        const api2 = await apiAs("salesExec2");
        await page2.goto("/");
        const bell2 = page2.getByRole("button", { name: /^Notifications, \d+ unread$/ });
        await expect(bell2).toBeVisible();
        await bell2.click();
        await expect(page2.getByRole("button", { name: new RegExp(`${title} C`) })).toBeVisible();
        await page2.getByRole("button", { name: "Mark all read" }).click();
        await expect.poll(async () => unread(api2), { message: "unread count is 0 after Mark all read" }).toBe(0);
        await expect(page2.getByRole("button", { name: "Notifications" }), "bell badge cleared").toBeVisible();
      } finally {
        await ctx2.close();
      }
    } finally {
      for (const id of ids) {
        try {
          await deleteNotification(id);
        } catch {
          // cleanup only: continue with the remaining rows
        }
      }
      await archiveQuietly("leads", [lead.id]);
    }
  });

  tc("TC-GEN-009", async ({ page }) => {
    const sales = await apiAs("salesExec1");
    const account = await build.account(sales);
    const control = await build.account(sales); // control account: its rows must not appear in this account's tabs
    const contact = await build.contact(sales, account.id);
    const controlContact = await build.contact(sales, control.id);
    const opp = await build.opportunity(sales, account.id);
    const controlOpp = await build.opportunity(sales, control.id);
    const quote = await build.quotation(sales, { opportunityId: opp.id, accountId: account.id });
    const activitySubject = `${uniqueTag("ACT")} call back`;
    const act = ok(await sales.post("/modules/activities", { type: "Call", subject: activitySubject, priority: "Low", dueDate: isoDate(2), accountId: account.id, opportunityId: opp.id }), "create activity");
    const detail = new ModuleDetail(page);
    const tabRow = async (tab: string, text: string): Promise<void> => {
      await detail.tab(tab);
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByRole("row").filter({ hasText: text }).first(), `${tab} tab lists ${text}`).toBeVisible();
    };
    try {
      const cases: [string, string, string, string][] = [
        ["Contacts", contact.name, "contacts", contact.id],
        ["Opportunities", opp.title, "opportunities", opp.id],
        ["Quotations", "", "quotations", quote.id],
        ["Activities", activitySubject, "activities", String(act.body.id)],
      ];
      for (const [tab, text, route, targetId] of cases) {
        await detail.goto("accounts", account.id);
        await detail.tab(tab);
        const panel = page.getByRole("tabpanel");
        // own rows present (first data row of a populated tab) and control rows absent after the positive signal
        const bodyRows = panel.locator("tbody tr");
        await expect(bodyRows.first(), `${tab} tab populated`).toBeVisible();
        if (text) await expect(panel.getByRole("row").filter({ hasText: text }).first()).toBeVisible();
        await expect(panel.getByText(controlOpp.title)).toHaveCount(0);
        await expect(panel.getByText(controlContact.name)).toHaveCount(0);
        await bodyRows.first().click();
        await expect(page, `${tab} row opens /${route}/<id>`).toHaveURL(new RegExp(`/${route}/${targetId}$`));
      }
      // Opportunity tabs: Quotations -> /quotations/<id>, Activities -> /activities/<id>
      await detail.goto("opps", opp.id);
      await tabRow("Quotations", "");
      await page.getByRole("tabpanel").locator("tbody tr").first().click();
      await expect(page).toHaveURL(new RegExp(`/quotations/${quote.id}$`));
      await detail.goto("opps", opp.id);
      await tabRow("Activities", activitySubject);
      await page.getByRole("tabpanel").getByRole("row").filter({ hasText: activitySubject }).first().click();
      await expect(page).toHaveURL(new RegExp(`/activities/${String(act.body.id)}$`));
    } finally {
      await archiveQuietly("activities", [String(act.body.id)]);
    }
  });

  tc("TC-GEN-010", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await expect(list.searchBox).toBeVisible();

    // (1) client-side validation: nothing sent, required fields flagged, message shown
    await list.clickNew();
    await expect(page.getByRole("heading", { name: "New Lead" })).toBeVisible();
    await drawer.save();
    await expect(drawer.error).toHaveText(/^Please fix (the highlighted field|the \d+ highlighted fields) below\.$/);
    await expect(page.locator("#company"), "required field is flagged").toHaveClass(/border-destructive/);

    // (2) a money value is accepted (D-6 fixed): the drawer saves and opens the new lead
    const company = `${uniqueTag("DRW")} Drawer Ltd`;
    const response = page.waitForResponse((r) => r.request().method() === "POST" && /\/modules\/leads$/.test(r.url()));
    await drawer.fill({ company, contactName: "Drawer Buyer", phone: uniquePhone(), email: uniqueEmail(uniqueTag("DRW")), product: "Weighbridge", source: "IndiaMART", value: 2_500_000 });
    await drawer.save();
    expect((await response).status()).toBe(201);
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    expect(idsOf(await api.get(`/modules/leads?search=${encodeURIComponent(company)}`))).toHaveLength(1);

    // (3) a fresh drawer without the money value saves (D-6 only affects the money field)
    await list.goto();
    await list.clickNew();
    const company2 = `${uniqueTag("DRW")} Drawer Two Ltd`;
    await drawer.fill({ company: company2, contactName: "Drawer Buyer", phone: uniquePhone(), product: "Weighbridge", source: "IndiaMART" });
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && /\/modules\/leads$/.test(r.url()));
    await drawer.save();
    expect((await saved).status()).toBe(201);
    const created = rows(await api.get(`/modules/leads?search=${encodeURIComponent(company2)}`));
    expect(created).toHaveLength(1);
    await archiveQuietly("leads", [String(created[0]?.id)]);
  });
});

// ---- Sales Manager: 002 lists, 003 saved filters / columns, 004 export, 007 owner ----
test.describe("GEN - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  const MODULES = [
    "leads", "accounts", "contacts", "activities", "opps", "rfqs", "visits", "demos", "products", "quotes", "approvals",
    "pos", "sorders", "dispatch", "payments", "assets", "amc", "service",
  ]; // costing is whole-record blocked for Sales Manager (field security default), reports is a dashboard page

  tc("TC-GEN-002", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const manager = await apiAs("salesManager");
    const tag = uniqueTag("LST");
    const created: string[] = [];
    try {
      // 22 leads under one tag: company "<tag> L00".."L21"; three of them are Contacted
      for (let i = 0; i < 22; i += 1) {
        const lead = await build.lead(manager, { company: `${tag} L${String(i).padStart(2, "0")}` });
        created.push(lead.id);
        if (i % 7 === 0) ok(await manager.action("leads", lead.id, "Mark contacted"), "mark contacted");
      }
      // API contract: total, pages, sort, status filter
      const p1 = await manager.get(`/modules/leads?search=${tag}&limit=20&page=1&sort=company`);
      const p2 = await manager.get(`/modules/leads?search=${tag}&limit=20&page=2&sort=company`);
      expect(p1.body.total).toBe(22);
      expect(rows(p1)).toHaveLength(20);
      expect(rows(p2)).toHaveLength(2);
      expect(new Set([...idsOf(p1), ...idsOf(p2)]).size, "pages do not overlap").toBe(22);
      expect(String(rows(p1)[0]?.company)).toBe(`${tag} L00`);
      expect(String(rows(p2)[1]?.company)).toBe(`${tag} L21`);
      const contacted = await manager.get(`/modules/leads?search=${tag}&status=Contacted`);
      expect(contacted.body.total).toBe(4);
      expect(rows(contacted).every((r) => r.status === "Contacted")).toBe(true);

      // UI: count + pagination, sort toggle (asc / desc), status pill, page 2
      const list = new ModuleList(page, "leads");
      await list.goto();
      await expect(list.searchBox).toBeVisible();
      await listResponse(page, "leads", () => list.search(tag), `search=${tag}`);
      const main = page.getByRole("main");
      // the page size fits the screen height, so read it from the first page
      const shown = main.getByText(/^\d+ of 22$/);
      await expect(shown, "page 1 shows a page of the 22 matches").toBeVisible();
      const pageSize = Number(((await shown.textContent()) ?? "").split(" of ")[0]);
      const pages = Math.ceil(22 / pageSize);
      expect(pages, "22 matches span more than one page").toBeGreaterThan(1);
      await expect(main.getByRole("button", { name: "2", exact: true }), "pagination offers page 2").toBeVisible();
      await expect(main.getByRole("button", { name: String(pages + 1), exact: true })).toHaveCount(0);
      await listResponse(page, "leads", () => main.locator("thead th").filter({ hasText: "Company" }).click(), "sort=company");
      await expect(main.locator("thead th").filter({ hasText: /Company ▲/ })).toBeVisible();
      await expect(main.getByRole("row").nth(1)).toContainText(`${tag} L00`);
      await listResponse(page, "leads", () => main.locator("thead th").filter({ hasText: /Company/ }).click(), "sort=-company");
      await expect(main.locator("thead th").filter({ hasText: /Company ▼/ })).toBeVisible();
      await expect(main.getByRole("row").nth(1)).toContainText(`${tag} L21`);
      await listResponse(page, "leads", () => main.getByRole("button", { name: "2", exact: true }).click(), "page=2");
      const onPage2 = Math.min(pageSize, 22 - pageSize);
      await expect(main.getByText(`${onPage2} of 22`), "page 2 shows the next rows").toBeVisible();
      await expect(main.getByRole("row")).toHaveCount(onPage2 + 1); // header + rows
      await listResponse(page, "leads", () => main.getByRole("button", { name: /^Contacted/ }).click(), "Contacted");
      await expect(main.getByText("4 of 4"), "status filter narrows to the 4 Contacted leads and resets to page 1").toBeVisible();
      await expect(main.getByRole("button", { name: "2", exact: true }), "one page only").toHaveCount(0);
    } finally {
      await archiveQuietly("leads", created);
    }

    // every other module list: one goto, controls render, no load error, no horizontal page overflow
    for (const key of MODULES) {
      await page.goto(listUrl(key));
      const list = new ModuleList(page, key);
      await expect(list.searchBox, `${key} list renders`).toBeVisible({ timeout: 15_000 });
      const settled = page.getByRole("main").locator("table").or(page.getByRole("main").getByText(/^No .+ match these filters\./)).first();
      await expect(settled, `${key} list loaded`).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("main").getByText(/Couldn't load/), `${key} list has no load error`).toHaveCount(0);
      if ((await page.getByRole("main").locator("table").count()) > 0) {
        await expect(page.getByRole("main").locator("thead th").first(), `${key} has sortable column headers`).toBeVisible();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${key} list has no horizontal page overflow`).toBeLessThanOrEqual(0);
    }

    // Column selection (D-132 for persistence): the chooser hides / shows a column in the current view (real), the choice is lost on reload.
    const colList = new ModuleList(page, "leads");
    await colList.goto();
    await expect(colList.searchBox).toBeVisible();
    const colMain = page.getByRole("main");
    await expect(colMain.locator("table").or(colMain.getByText(/^No .+ match these filters./)).first()).toBeVisible();
    const sourceHead = colMain.locator("thead th").filter({ hasText: "Source" });
    await expect(sourceHead, "Source column shown by default").toBeVisible();
    await colList.columnChooser.click();
    await page.getByRole("checkbox", { name: "Source" }).uncheck();
    await expect(sourceHead, "unticked column is hidden").toHaveCount(0);
    await page.getByRole("checkbox", { name: "Source" }).check();
    await expect(sourceHead, "re-ticked column is back").toBeVisible();
    await page.getByRole("checkbox", { name: "Source" }).uncheck();
    await page.reload();
    await expect(colList.searchBox).toBeVisible();
    await expect(colMain.locator("table").or(colMain.getByText(/^No .+ match these filters./)).first()).toBeVisible();
    await expect(sourceHead, "column choice persists after reload").toHaveCount(0, { timeout: 3_000 });
  });

  tc("TC-GEN-003", async ({ page }) => {
    // Gap body: saved-filter persistence is the ONLY expectation. The column-chooser half is a normal assertion in TC-GEN-002.
    const list = new ModuleList(page, "leads");
    const main = page.getByRole("main");
    await list.goto();
    await list.searchBox.waitFor({ timeout: 15_000 });
    await main.locator("table").or(main.getByText(/^No .+ match these filters./)).first().waitFor({ timeout: 15_000 });
    const pill = page.getByRole("button", { name: /^Contacted/ });
    const popover = page.getByRole("button", { name: "Saved filters" });
    await pill.waitFor({ timeout: 5_000 }); // plain-Error preconditions: the status pill and the Saved filters control exist
    await expect(popover, "Saved filters control").toBeVisible({ timeout: 2_000 });
    const name = `${uniqueTag("FLT")} contacted`;
    await pill.click();
    page.once("dialog", (d) => void d.accept(name));
    await popover.click();
    await page.getByRole("button", { name: "Save current filter…" }).click();
    await page.reload();
    await list.searchBox.waitFor({ timeout: 15_000 });
    await popover.click();
    await expect(page.getByRole("button", { name }), "saved filter is listed after reload").toBeVisible({ timeout: 3_000 });
  });

  tc("TC-GEN-004", async ({ page, browser }, testInfo) => {
    const manager = await apiAs("salesManager");
    const rep = await apiAs("salesExec1");
    const orgB = await apiAs("orgBAdmin");
    const tag = uniqueTag("EXP");
    const mine = await build.lead(manager, { company: `${tag} Mgr Ltd` });
    const reps = await build.lead(rep, { company: `${tag} Rep Ltd` }); // in the manager's team
    const foreign = await build.lead(orgB, { company: `${tag} OrgB Ltd` }); // other tenant: must not be exported
    try {
      const list = new ModuleList(page, "leads");
      await list.goto();
      await expect(list.searchBox).toBeVisible();
      await listResponse(page, "leads", () => list.search(tag), `search=${tag}`);
      await expect(page.getByRole("main").getByText("2 of 2")).toBeVisible();
      await expect(list.exportButton, "Sales Manager has the Export operation").toBeVisible();
      const downloadPromise = page.waitForEvent("download");
      await list.exportButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("leads.csv");
      const csv = parseCsv(readFileSync(await download.path(), "utf8"));
      const [header = [], ...body] = csv.filter((r) => r.length > 1);
      expect(header, "header row carries the lead columns").toEqual(expect.arrayContaining(["id", "company", "phone", "status", "ownerId"]));
      const col = header.indexOf("company");
      const companies = body.map((r) => r[col]);
      expect([...companies].sort(), "file holds exactly the filtered rows (search applied, team scope, no other tenant)").toEqual([`${tag} Mgr Ltd`, `${tag} Rep Ltd`]);
      expect(body.find((r) => r[col] === `${tag} Rep Ltd`)?.[header.indexOf("id")]).toBe(reps.id);
      expect(body.every((r) => r.length === header.length), "every row has one cell per header").toBe(true);
    } finally {
      await archiveQuietly("leads", [mine.id, reps.id]);
      try { await orgB.post(`/modules/leads/${foreign.id}/archive`); } catch { /* cleanup only */ }
    }

    // Export permission (E): a Sales Executive has no E on leads - spec: no Export control and the endpoint refuses (D-1 / D-2).
    const ctx = await browser.newContext({ storageState: authFile("salesExec1"), baseURL: "http://localhost:5174" });
    try {
      const repPage = await ctx.newPage();
      const repList = new ModuleList(repPage, "leads");
      await repList.goto();
      await expect(repList.searchBox).toBeVisible();
      await knownDefect(testInfo, "D-2", async () => {
        await expect(repList.exportButton).toHaveCount(0, { timeout: 1_500 });
      });
      await knownDefect(testInfo, "D-1", async () => {
        expect((await rep.get("/modules/leads/export")).status, "export without the E operation").toBe(403);
      });
    } finally {
      await ctx.close();
    }
  });

  tc("TC-GEN-007", async () => {
    const [manager, director, rep1, rep2] = await Promise.all([apiAs("salesManager"), apiAs("director"), apiAs("salesExec1"), apiAs("salesExec2")]);
    const idOfUser = async (c: ApiClient): Promise<string> => String(ok(await c.get("/auth/me"), "me").body.id);
    const [managerId, directorId, rep1Id, rep2Id] = await Promise.all([idOfUser(manager), idOfUser(director), idOfUser(rep1), idOfUser(rep2)]);
    const made: { moduleKey: string; id: string }[] = [];
    // each record is tracked as soon as it exists, so a failing later create does not leak the earlier ones
    const created = async (client: ApiClient, over: { owner?: string } = {}): Promise<{ lead: Rec; account: Rec; opp: Rec }> => {
      const o = over.owner === undefined ? {} : { ownerId: over.owner };
      const lead = ok(await client.post("/modules/leads", { company: `${uniqueTag("OWN")} Ltd`, contactName: "Owner Check", phone: uniquePhone(), product: "Weighbridge", source: "IndiaMART", ...o }), "create lead").body;
      made.push({ moduleKey: "leads", id: String(lead.id) });
      const accountTag = uniqueTag("OWA");
      const account = ok(await client.post("/modules/accounts", { name: `${accountTag} Ltd`, short: accountTag, type: "Customer", industry: "Cement", city: "Pune", state: "Maharashtra", territory: "West", ...o }), "create account").body;
      made.push({ moduleKey: "accounts", id: String(account.id) });
      const oppTag = uniqueTag("OWO");
      const opp = ok(await client.post("/modules/opps", {
        title: oppTag, accountId: account.id, product: "Weighbridge", value: 100_000, stage: "Qualified", closeDate: isoDate(30), nextAction: "Call", nextActionDate: isoDate(2), ...o,
      }), "create opportunity").body;
      made.push({ moduleKey: "opps", id: String(opp.id) });
      return { lead, account, opp };
    };
    try {
      // no owner given: the owner is the creator (lead, account, opportunity)
      for (const [client, id] of [[manager, managerId], [director, directorId], [rep1, rep1Id]] as [ApiClient, string][]) {
        const r = await created(client);
        expect([r.account.ownerId, r.opp.ownerId], "owner defaults to the creator").toEqual([id, id]);
        expect(r.lead.ownerId, "a lead without an owner is auto-assigned").toBeTruthy();
      }
      // a Sales Executive cannot assign others: the owner is forced to the creator
      const forced = await created(rep1, { owner: rep2Id });
      expect([forced.lead.ownerId, forced.account.ownerId, forced.opp.ownerId], "owner forced to the creating rep").toEqual([rep1Id, rep1Id, rep1Id]);
      // a manager may assign: the account keeps the chosen owner
      const assigned = await created(manager, { owner: rep2Id });
      expect(assigned.account.ownerId, "manager-chosen owner kept on the account").toBe(rep2Id);
      expect(typeof assigned.lead.ownerId === "string" && assigned.lead.ownerId.length > 0, "lead always has an owner").toBe(true);
      expect(typeof assigned.opp.ownerId === "string" && assigned.opp.ownerId.length > 0, "opportunity always has an owner").toBe(true);
    } finally {
      for (const m of [...made].reverse()) await archiveQuietly(m.moduleKey, [m.id]);
    }
  });
});

// ---- Director: 005 audit trail, 006 archive ----
test.describe("GEN - Director", () => {
  test.use({ storageState: authFile("director") });

  tc("TC-GEN-005", async ({ page }, testInfo) => {
    const director = await apiAs("director");
    const rep2 = String(ok(await (await apiAs("salesExec2")).get("/auth/me"), "me").body.id);
    const account = await build.account(director);
    const opp = await build.opportunity(director, account.id);
    const lead = await build.lead(director);
    const detail = new ModuleDetail(page);
    try {
      // critical changes: owner (account), stage (opportunity), status (lead)
      ok(await director.patch(`/modules/accounts/${account.id}`, { ownerId: rep2 }), "change owner");
      ok(await director.patch(`/modules/opps/${opp.id}`, { stage: "Requirement collected", nextAction: "Visit plant", nextActionDate: isoDate(2) }), "advance stage");
      ok(await director.action("leads", lead.id, "Mark contacted"), "mark contacted");

      // What exists: the opportunity's own Stage history tab records the stage change (stage history table + events endpoint).
      const events = ok(await director.get(`/modules/opps/${opp.id}/events/history`), "stage history").body as unknown as { label: string }[] | { data: { label: string }[] };
      const list = Array.isArray(events) ? events : events.data;
      expect(list.length, "stage change is recorded in the opportunity's stage history").toBeGreaterThanOrEqual(1);
      await detail.goto("opps", opp.id);
      await detail.tab("Stage history");
      await expect(page.getByRole("tabpanel").locator("li").first(), "Stage history tab lists the change").toBeVisible();

      // Spec: every critical field change is in the Audit trail with old value, new value, user, time. The backend has no
      // GET /modules/:key/:id/audit route (D-23): each Audit trail tab shows the settled load error.
      for (const [key, id] of [["accounts", account.id], ["opps", opp.id], ["leads", lead.id]] as [string, string][]) {
        expect((await director.get(`/modules/${key}/${id}/audit`)).status, `${key} audit endpoint`).toBe(200);
        await detail.goto(key, id);
        await page.getByRole("tab", { name: "Audit trail" }).click();
        await expect(page.getByRole("tabpanel").getByRole("row").filter({ hasText: /owner|stage|status/i }).first(), `${key} audit row for the change`).toBeVisible({ timeout: 3_000 });
      }
    } finally {
      await archiveQuietly("opps", [opp.id]);
      await archiveQuietly("accounts", [account.id]);
      await archiveQuietly("leads", [lead.id]);
    }
  });

  tc("TC-GEN-006", async ({ page }) => {
    test.setTimeout(150_000);
    const director = await apiAs("director");
    const lead = await build.lead(director);
    const account = await build.account(director);
    const contact = await build.contact(director, account.id);
    const opp = await build.opportunity(director, account.id);
    const quote = await build.quotation(director, { opportunityId: opp.id, accountId: account.id });
    const product = await build.product(director);
    const rfq = await build.rfq(director, { opportunityId: opp.id, accountId: account.id });
    const visit = await build.visit(director, { accountId: account.id, opportunityId: opp.id });
    const demo = await build.evaluation(director, { opportunityId: opp.id, accountId: account.id });
    const activityId = String(ok(await director.post("/modules/activities", { type: "Call", subject: `${uniqueTag("ARC")} call`, priority: "Low", dueDate: isoDate(5), accountId: account.id }), "create activity").body.id);
    const costingId = String(ok(await build.costing(director, { opportunityId: opp.id, accountId: account.id, material: 1000, sellingPrice: 2000 }), "create costing").body.id);
    const searchOf: Record<string, string> = { leads: lead.company, accounts: account.name, contacts: contact.name, opps: opp.title, products: product.sku, rfqs: rfq.custNo, visits: visit.title, demos: demo.title };
    const targets: { key: string; table: SoftDeleteTable; id: string }[] = [
      { key: "leads", table: "MfgLead", id: lead.id }, { key: "accounts", table: "Account", id: account.id }, { key: "contacts", table: "Contact", id: contact.id },
      { key: "opps", table: "Opportunity", id: opp.id }, { key: "quotes", table: "Quotation", id: quote.id }, { key: "products", table: "Product", id: product.id },
      { key: "rfqs", table: "Rfq", id: rfq.id }, { key: "visits", table: "SiteVisit", id: visit.id }, { key: "demos", table: "Evaluation", id: demo.id },
      { key: "activities", table: "MfgActivity", id: activityId }, { key: "costing", table: "CostingSheet", id: costingId },
    ];
    // Coverage: 11 of the ~20 modules with a delete permission (the Director holds D everywhere). Modules that need the long PO -> order -> asset chain
    // (pos, sorders, dispatch, payments, assets, amc, service, approvals) share the same soft-delete code path (isDeleted = true in each service's archive)
    // and are left out to keep the run short.
    try {
      // positive control: everything is listed / readable before the archive
      for (const t of targets) {
        expect((await director.get(`/modules/${t.key}/${t.id}`)).status, `${t.key} readable before archive`).toBe(200);
        expect(await isDeletedOf(t.table, t.id), `${t.key} not deleted yet`).toBe(false);
      }
      // Related history intact: archive the ACCOUNT first - its opportunity, contact, quotation, RFQ, visit, demo, activity and costing rows must stay live
      ok(await director.post(`/modules/accounts/${account.id}/archive`), "archive account");
      expect(await isDeletedOf("Account", account.id), "account row kept with isDeleted = true").toBe(true);
      for (const t of targets.filter((x) => x.key !== "leads" && x.key !== "accounts")) {
        if (t.key === "products") continue; // not related to the account
        expect(await isDeletedOf(t.table, t.id), `archiving the account does not delete its related ${t.key} row`).toBe(false);
      }
      for (const t of targets.filter((x) => x.key !== "leads" && x.key !== "accounts")) ok(await director.post(`/modules/${t.key}/${t.id}/archive`), `archive ${t.key}`);
      for (const t of targets.filter((x) => x.key !== "leads")) {
        const detail = await director.get(`/modules/${t.key}/${t.id}`);
        expect(detail.status, `${t.key} detail after archive`).toBe(404);
        const search = searchOf[t.key];
        if (search) expect(idsOf(await director.get(`/modules/${t.key}?search=${encodeURIComponent(search)}&limit=50`)), `${t.key} hidden from the list`).not.toContain(t.id);
        expect(await isDeletedOf(t.table, t.id), `${t.key} row kept with isDeleted = true`).toBe(true);
      }
      expect(await isDeletedOf("MfgLead", lead.id), "a record not archived yet is untouched").toBe(false);

      // UI: archive the lead from its detail page, then the list no longer shows it, the detail is gone, the row is kept
      const detailPage = new ModuleDetail(page);
      await detailPage.goto("leads", lead.id);
      await detailPage.archive();
      await expect.poll(async () => (await director.get(`/modules/leads/${lead.id}`)).status, { message: "lead detail gone after UI archive" }).toBe(404);
      const list = new ModuleList(page, "leads");
      await list.goto();
      await expect(list.searchBox).toBeVisible();
      const leadTag = lead.company.split(" ")[0] ?? lead.company;
      await listResponse(page, "leads", () => list.search(leadTag), `search=${leadTag}`);
      await expect(page.getByRole("main").getByText(/^No leads match these filters\./), "archived lead is not listed").toBeVisible();
      expect(await isDeletedOf("MfgLead", lead.id), "lead row kept with isDeleted = true").toBe(true);
      await page.goto(`/leads/${lead.id}`);
      await expect(page.getByText("Couldn't load this record."), "detail of an archived lead is not found").toBeVisible();
    } finally {
      for (const t of targets) await archiveQuietly(t.key, [t.id]);
    }
  });
});
