// e2e/specs/mfg/nfr.spec.ts - NFR module: responsive layout, dropdown containment, long text, INR / en-IN formatting (TC-NFR-002 / 003 / 004 / 006).
// 001 / 005 / 007 / 008 / 009 are skip cases with empty bodies. Only geometry and computed styles are asserted (no screenshots).
// The responsive describe carries "@responsive" so the mfg-mobile project (grep /@responsive/) runs it as well.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, API, build, ok } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { pdfText } from "../../mfg/pdf";
import { listUrl } from "../../mfg/routes";
import { uniqueGstin, uniqueTag } from "../../mfg/tag";

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
/** How far the page is wider than the viewport (> 0 means a horizontal page scrollbar). */
const horizontalOverflow = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Waits until the list or detail shows loaded content (rows table or empty state / the record's tab bar). */
const listLoaded = async (page: Page): Promise<void> => {
  const main = page.getByRole("main");
  await expect(main.locator("table").or(main.getByText(/^No .+ match these filters\./)).first()).toBeVisible({ timeout: 15_000 });
};

test.describe("NFR - Sales Executive layout @responsive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-NFR-002", async ({ page }) => {
    test.setTimeout(150_000);
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const lead = await build.lead(api);
    const opp = await build.opportunity(api, account.id);
    try {
      for (const [width, height] of [[768, 1024], [390, 844]] as [number, number][]) {
        await page.setViewportSize({ width, height });
        const at = `${width}px`;
        // lists: the table scrolls inside its own container, the page itself never overflows
        for (const key of ["leads", "accounts", "opps", "quotes", "activities"]) {
          await page.goto(listUrl(key));
          await expect(new ModuleList(page, key).searchBox, `${at}: ${key} list renders`).toBeVisible({ timeout: 15_000 });
          await listLoaded(page);
          expect(await horizontalOverflow(page), `${at}: ${key} list has no horizontal page overflow`).toBeLessThanOrEqual(0);
        }
        // detail pages (account: 10 tabs, opportunity: 10 tabs)
        const detail = new ModuleDetail(page);
        for (const [key, id] of [["leads", lead.id], ["accounts", account.id], ["opps", opp.id]] as [string, string][]) {
          await detail.goto(key, id);
          await expect(page.getByRole("tab").first(), `${at}: ${key} detail tabs render`).toBeVisible();
          expect(await horizontalOverflow(page), `${at}: ${key} detail has no horizontal page overflow`).toBeLessThanOrEqual(0);
        }
        // form drawer: fits the viewport width, its body scrolls and the footer stays reachable
        await page.goto(listUrl("leads"));
        await listLoaded(page);
        await new ModuleList(page, "leads").clickNew();
        const sheet = page.getByRole("dialog");
        await expect(sheet.getByRole("heading", { name: "New Lead" })).toBeVisible();
        await sheet.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished))); // the sheet slides in
        const box = await sheet.boundingBox();
        expect(box, `${at}: drawer is on screen`).not.toBeNull();
        expect(box?.x ?? -1, `${at}: drawer starts inside the viewport`).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), `${at}: drawer ends inside the viewport`).toBeLessThanOrEqual(width + 1);
        expect(box?.height ?? 0, `${at}: drawer is not taller than the viewport`).toBeLessThanOrEqual(height + 1);
        const body = sheet.locator("div.overflow-y-auto").first();
        const scroll = await body.evaluate((n) => ({ overflowY: getComputedStyle(n).overflowY, scrollable: n.scrollHeight > n.clientHeight, scrollWidthOver: n.scrollWidth - n.clientWidth }));
        expect(scroll.overflowY, `${at}: drawer body scrolls vertically`).toBe("auto");
        expect(scroll.scrollable, `${at}: the long lead form does not fit, so the body scrolls`).toBe(true);
        expect(scroll.scrollWidthOver, `${at}: drawer body does not scroll sideways`).toBeLessThanOrEqual(0);
        const save = sheet.getByRole("button", { name: /^Save$/ });
        await expect(save, `${at}: Save stays visible without scrolling the body`).toBeInViewport();
        // scrolled to the bottom, the last field is reachable (inside the drawer and the viewport)
        await body.evaluate((n) => { n.scrollTop = n.scrollHeight; });
        const lastField = sheet.locator("input, select, textarea").last();
        await expect(lastField).toBeInViewport();
        expect(await horizontalOverflow(page), `${at}: drawer open, page has no horizontal overflow`).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
      }
    } finally {
      await archiveQuietly("opps", [opp.id]);
      await archiveQuietly("accounts", [account.id]);
      await archiveQuietly("leads", [lead.id]);
    }
  });
});

test.describe("NFR - Sales Executive dropdowns", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-NFR-003", async ({ page, browser }) => {
    // A short viewport makes any overflow visible: the New lead drawer holds the long selects (industry, source, product ...).
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto(listUrl("leads"));
    await listLoaded(page);
    await new ModuleList(page, "leads").clickNew();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "New Lead" })).toBeVisible();
    await sheet.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished))); // the sheet slides in
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox?.height ?? 0, "drawer fits the short viewport").toBeLessThanOrEqual(501);
    const body = sheet.locator("div.overflow-y-auto").first();
    expect(await body.evaluate((n) => ({ y: getComputedStyle(n).overflowY, scrolls: n.scrollHeight > n.clientHeight })), "drawer body is the scroll region").toEqual({ y: "auto", scrolls: true });
    const selects = sheet.locator("select");
    expect(await selects.count(), "the lead form has several selects").toBeGreaterThanOrEqual(5);
    const longest = await selects.evaluateAll((els) => Math.max(...els.map((e) => (e as HTMLSelectElement).options.length)));
    expect(longest, "at least one select has a long option list (industry / source)").toBeGreaterThanOrEqual(8);
    for (let i = 0; i < (await selects.count()); i += 1) {
      const select = selects.nth(i);
      await select.scrollIntoViewIfNeeded();
      await expect(select, `select ${i} can be scrolled into view`).toBeInViewport();
      const [selBox, bodyBox] = [await select.boundingBox(), await body.boundingBox()];
      expect(selBox?.x ?? -1, `select ${i} stays inside the drawer (left)`).toBeGreaterThanOrEqual((bodyBox?.x ?? 0) - 1);
      expect((selBox?.x ?? 0) + (selBox?.width ?? 0), `select ${i} stays inside the drawer (right)`).toBeLessThanOrEqual((bodyBox?.x ?? 0) + (bodyBox?.width ?? 0) + 1);
    }
    expect(await horizontalOverflow(page), "no horizontal page overflow with the drawer open").toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");

    // Radix Select inside a dialog (Add member on the Users page, Director): the list is capped to the available height and scrolls inside the viewport.
    const ctx = await browser.newContext({ storageState: authFile("director"), baseURL: "http://localhost:5174", viewport: { width: 1280, height: 420 } });
    try {
      const dpage = await ctx.newPage();
      await dpage.goto("/users");
      await dpage.getByRole("button", { name: "Add member" }).click();
      const dialog = dpage.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const triggers = dialog.getByRole("combobox");
      expect(await triggers.count(), "the dialog has Radix selects (role / manufacturing role / team)").toBeGreaterThanOrEqual(2);
      for (let i = 0; i < Math.min(await triggers.count(), 3); i += 1) {
        await triggers.nth(i).scrollIntoViewIfNeeded();
        await triggers.nth(i).click();
        const list = dpage.getByRole("listbox");
        await expect(list, `select ${i} list opens`).toBeVisible();
        const box = await list.boundingBox();
        expect(box, `select ${i} list has a box`).not.toBeNull();
        expect(box?.y ?? -1, `select ${i} list starts inside the viewport`).toBeGreaterThanOrEqual(0);
        expect((box?.y ?? 0) + (box?.height ?? 0), `select ${i} list ends inside the viewport`).toBeLessThanOrEqual(421);
        expect((box?.x ?? 0) + (box?.width ?? 0), `select ${i} list ends inside the viewport width`).toBeLessThanOrEqual(1281);
        expect(box?.height ?? 0, `select ${i} list is capped (max-h 300px / available height)`).toBeLessThanOrEqual(321);
        expect(await horizontalOverflow(dpage), `select ${i} open: no horizontal page overflow`).toBeLessThanOrEqual(0);
        await dpage.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
      }
    } finally {
      await ctx.close();
    }
  });

  tc("TC-NFR-004", async ({ page }, testInfo) => {
    const api = await apiAs("salesExec1");
    const tag = uniqueTag("LNG");
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `Segment${i}`).join(" ");
    const longName = `${tag} ${words(24)}`; // ~230 chars with spaces
    const unbroken = `${tag}-${"X".repeat(200)}`; // one 200+ char token: cannot wrap
    const wrapped = await build.account(api, { name: longName, short: longName });
    const solid = await build.account(api, { name: unbroken, short: unbroken });
    try {
      for (const [label, account, full] of [["spaced", wrapped, longName], ["unbroken", solid, unbroken]] as [string, { id: string }, string][]) {
        const list = new ModuleList(page, "accounts");
        await list.goto();
        await expect(list.searchBox).toBeVisible();
        const response = page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes(`search=${tag}`) && r.ok());
        await list.search(tag);
        await response;
        const cell = page.getByRole("main").locator("tbody td").filter({ hasText: full.slice(0, 30) }).first();
        await expect(cell, `${label}: the long name is listed`).toBeVisible();
        // no layout break: the page itself never overflows (the table scrolls inside its own container)
        expect(await horizontalOverflow(page), `${label}: list has no horizontal page overflow`).toBeLessThanOrEqual(0);
        // Spec: ellipsis with the full text in a title tooltip (D-134). The text node is located by its exact text: a missing node is a plain Error.
        const textNode = cell.getByText(full, { exact: true });
        await textNode.waitFor({ timeout: 5_000 });
        const style = await textNode.evaluate((n) => { const s = getComputedStyle(n); return { overflow: s.overflow, textOverflow: s.textOverflow, whiteSpace: s.whiteSpace }; });
        expect(style.textOverflow, `${label}: current list cell text-overflow (remove this pin when D-134 is fixed)`).toBe("clip");
        await knownDefect(testInfo, "D-134", async () => {
          expect(style, `${label}: list cell truncates with an ellipsis`).toMatchObject({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
        });
        const cellTitle = await textNode.getAttribute("title");
        expect(cellTitle, `${label}: current list cell title (remove this pin when D-134 is fixed)`).toBeNull();
        await knownDefect(testInfo, "D-134", async () => {
          expect(cellTitle, `${label}: list cell carries the full text as a title`).toBe(full);
        });

        // detail: the page title truncates (real); the full text as a tooltip is the same gap (D-134)
        await new ModuleDetail(page).goto("accounts", account.id);
        const title = page.getByRole("heading", { level: 1 });
        await expect(title).toBeVisible();
        const titleStyle = await title.evaluate((n) => { const s = getComputedStyle(n); return { textOverflow: s.textOverflow, overflow: s.overflow, truncated: n.scrollWidth > n.clientWidth }; });
        expect(titleStyle, `${label}: detail title is truncated with an ellipsis`).toEqual({ textOverflow: "ellipsis", overflow: "hidden", truncated: true });
        expect(await horizontalOverflow(page), `${label}: detail has no horizontal page overflow`).toBeLessThanOrEqual(0);
        const titleAttr = await title.getAttribute("title");
        expect(titleAttr, `${label}: current detail title tooltip (remove this pin when D-134 is fixed)`).toBeNull();
        await knownDefect(testInfo, "D-134", async () => {
          expect(titleAttr, `${label}: detail title carries the full text as a tooltip`).toBe(full);
        });
      }
    } finally {
      await archiveQuietly("accounts", [wrapped.id, solid.id]);
    }
  });
});

// ---- INR / en-IN formatting and the GSTIN field ----
test.describe("NFR - Sales Executive localisation", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-NFR-006", async ({ page }, testInfo) => {
    const sales = await apiAs("salesExec1");
    const gstin = uniqueGstin();
    const account = await build.account(sales, { gstin, potential: 12_500_000 });
    const opp = await build.opportunity(sales, account.id, { value: 1_000_000 });
    const quote = await build.quotation(sales, { opportunityId: opp.id, accountId: account.id });
    const product = await build.product(await apiAs("commercial"));
    ok(await sales.patch(`/modules/quotes/${quote.id}`, { lines: [{ productId: product.id, qty: 1, unitPrice: 1_500_000, discountPct: 0 }] }), "add quotation line");
    try {
      // List: values of a lakh and more are shown in rupee short form (Rs 10.0 L / Rs 1.25 Cr), never as a bare number.
      const oppList = new ModuleList(page, "opps");
      await oppList.goto();
      await expect(oppList.searchBox).toBeVisible();
      await oppList.search(opp.title.split(" ")[0] ?? opp.title);
      await expect(oppList.row(opp.title)).toBeVisible();
      await expect(oppList.row(opp.title), "list shows the rupee sign and the lakh figure").toContainText("₹10.0 L");
      const accountList = new ModuleList(page, "accounts");
      await accountList.goto();
      await expect(accountList.searchBox).toBeVisible();
      await accountList.search(account.name.split(" ")[0] ?? account.name);
      await expect(accountList.row(account.name.split(" ")[0] ?? account.name)).toContainText("₹1.25 Cr");
      // Spec: full Indian grouping (Rs 10,00,000). Lists use the compact lakh / crore form and the detail prints the raw number (D-135).
      await knownDefect(testInfo, "D-135", async () => {
        await expect(oppList.page.getByText("₹10,00,000"), "full en-IN grouping anywhere on the opportunity list").toBeVisible({ timeout: 1_500 });
      });
      const detail = new ModuleDetail(page);
      await detail.goto("opps", opp.id);
      await knownDefect(testInfo, "D-135", async () => {
        await expect(page.getByRole("tabpanel").getByText("₹10,00,000"), "opportunity detail shows Estimated value as ₹10,00,000").toBeVisible({ timeout: 1_500 });
      });

      // GSTIN: a field on the account form and on the account detail
      await accountList.goto();
      await expect(accountList.searchBox).toBeVisible();
      await accountList.clickNew();
      await expect(page.getByRole("dialog").getByText("GSTIN", { exact: true })).toBeVisible();
      await expect(page.locator("#gstin"), "account form has a GSTIN input").toBeVisible();
      await page.keyboard.press("Escape");
      await detail.goto("accounts", account.id);
      await expect(page.getByRole("tabpanel").getByText("GSTIN", { exact: true })).toBeVisible();
      await expect(page.getByRole("tabpanel").getByText(gstin, { exact: true }), "the saved GSTIN is shown on the account").toBeVisible();

      // Quotation PDF: Indian digit grouping is used (15,00,000); the rupee glyph does not render (D-73)
      const res = await fetch(`${API}/modules/quotes/${quote.id}/pdf`, { headers: { authorization: `Bearer ${sales.token}` } });
      expect(res.status).toBe(200);
      const text = pdfText(Buffer.from(await res.arrayBuffer()));
      expect(text, "positive control: the PDF text was read").toContain("Grand total");
      expect(text, "PDF amounts use Indian grouping").toContain("15,00,000");
      await knownDefect(testInfo, "D-73", async () => {
        expect(text, "PDF shows the rupee sign before the amount").toContain("₹15,00,000");
      });
    } finally {
      await archiveQuietly("quotes", [quote.id]);
      await archiveQuietly("opps", [opp.id]);
      await archiveQuietly("accounts", [account.id]);
      await archiveQuietly("products", [product.id]);
    }
  });
});

test.describe("NFR - skipped cases", () => {
  tc("TC-NFR-001", async () => {});
  tc("TC-NFR-005", async () => {});
  tc("TC-NFR-007", async () => {});
  tc("TC-NFR-008", async () => {});
  tc("TC-NFR-009", async () => {});
});

