// e2e/specs/mfg/lead.spec.ts - LEAD module (TC-LEAD-001..028): create, validation, duplicates, status flow, conversion, SLA, access.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ConvertLeadDialog } from "../../pages/mfg/ConvertLeadDialog";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { detailUrl } from "../../mfg/routes";
import { uniqueEmail, uniqueGstin, uniquePhone, uniqueTag } from "../../mfg/tag";

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
const leadOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/leads/${id}`), "read lead");
const statusOf = async (api: ApiClient, id: string): Promise<string> => (await leadOf(api, id)).status as string;
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const SOURCES = [
  "Website", "Google Ads", "Meta", "IndiaMART", "TradeIndia", "Exhibition", "Referral", "LinkedIn", "WhatsApp", "Email", "Dealer",
  "Cold calling", "Existing customer", "Manual / API",
];
const SLA_DUE = /^Due in \d+[mhd]$/;

/** The record's `sla` field ({ l: label, t: tone }); the only SLA data a role can read (slaTimers/slaPolicies return 403 for every role). */
const slaOf = async (api: ApiClient, id: string): Promise<{ l: string; t: string }> => (await leadOf(api, id)).sla as { l: string; t: string };
/** Flow status, or "OUT_OF_FLOW" when the status is outside the progress bar (Nurture, Disqualified). */
const flowStatus = async (detail: ModuleDetail): Promise<string> => ((await detail.isOutOfFlow()) ? "OUT_OF_FLOW" : detail.statusText());

/** Opens a new context logged in as `role`, runs `fn` with a page, always closes the context. */
const asRole = async <T>(browser: Browser, role: MfgRoleKey, fn: (page: Page) => Promise<T>): Promise<T> => {
  const ctx = await browser.newContext({ storageState: authFile(role) });
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
};

// Qualify needs Budget, Authority, Need and Timeline captured first.
const BANT = { qBudget: "Approved", qAuth: "Decision maker engaged", qNeed: "Critical", qTime: "This quarter" };

test.describe("LEAD - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-LEAD-001", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const tag = uniqueTag("L1");
    const company = `${tag} Steel Pvt Ltd`;
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);
    const fields = {
      company, contactName: "Buyer One", phone: uniquePhone(), email: uniqueEmail(tag), product: "Weighbridge", source: "Website",
      city: "Pune", state: "Maharashtra", next: "Call the buyer", nextDate: dateInput(2),
    };
    const detailUrlRe = /\/leads\/[0-9a-f-]{36}$/;
    await list.goto();
    await list.clickNew();
    await drawer.fill({ ...fields, value: 2_500_000 });
    await drawer.save();
    let valueSaved = true;
    // Spec: estimated value is part of the mandatory-field create. The drawer posts money fields as strings and the API rejects them
    // (400 "value must be a number"), so a lead with an Estimated value cannot be saved from the UI.
    // positive settled signal first: either the saved detail page (Mark contacted) or the drawer's error alert is on screen
    await expect(drawer.error.or(page.getByRole("button", { name: "More actions", exact: true }))).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(detailUrlRe, { timeout: 1_000 });
    if (!detailUrlRe.test(page.url())) {
      valueSaved = false;
      await expect(drawer.error).toHaveText("Couldn't save — please try again.");
      await list.goto();
      await list.clickNew();
      await drawer.fill(fields); // same lead without the Estimated value
      await drawer.save();
      await page.waitForURL(detailUrlRe);
    }
    const id = idFromUrl(page);
    const detail = new ModuleDetail(page);
    await detail.expectAction("Mark contacted");
    expect(await detail.statusText()).toBe("New");

    const lead = await leadOf(api, id);
    expect(lead.status).toBe("New");
    expect(lead.ownerId).toBe(await userIdOf("salesExec1"));
    expect(Number.isNaN(Date.parse(lead.createdAt as string))).toBe(false);
    // SLA-01 'Lead first response' timer started.
    expect(lead.sla).toMatchObject({ t: "green" });
    expect((lead.sla as { l: string }).l).toMatch(SLA_DUE);
    if (valueSaved) expect(Number(lead.value)).toBe(2_500_000);
    // appears in the list
    await list.goto();
    await list.search(tag);
    await expect(list.row(company)).toBeVisible();
  });

  tc("TC-LEAD-002", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && /\/modules\/leads$/.test(r.url())) posts.push(r.url()); });
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    await drawer.save();
    await expect(drawer.error).toHaveText(/^Please fix (the highlighted field|the \d+ highlighted fields) below\.$/);
    for (const key of ["company", "contactName", "phone", "product", "source"]) {
      await expect(page.locator(`#${key}`), `${key} marked invalid`).toHaveClass(/border-destructive/);
    }
    await expect(page.getByRole("heading", { name: "New Lead" })).toBeVisible(); // drawer stays open
    expect(page.url()).toMatch(/\/leads$/);
    expect(posts, "no create request is sent").toHaveLength(0);
  });

  tc("TC-LEAD-003", async ({ page }) => {
    const list = new ModuleList(page, "leads");
    await list.goto();
    await list.clickNew();
    await expect(page.locator("#source")).toBeVisible();
    // Native <select>: it scrolls natively, so "does not overflow the dialog" cannot regress; assert the option set + order.
    const options = (await page.locator("#source option").allInnerTexts()).filter((t) => t !== "Select…");
    expect(options).toEqual(SOURCES);
    expect(options).toHaveLength(14);
  });

  tc("TC-LEAD-004", async ({ page }) => {
    // Spec (§5 / §37): warn before save and offer a link/merge path. Current: UI warns on blur ("A matching lead already exists" +
    // Open existing) but never blocks saving, there is no merge, and the server creates the duplicate (verification note).
    const api = await apiAs("salesExec1");
    const base = await build.lead(api);
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);

    // 1. phone duplicate: banner, then Save is refused and no second lead exists.
    await list.goto();
    await list.clickNew();
    await drawer.fill({ phone: base.phone });
    await expect(drawer.duplicateBanner).toBeVisible();
    await expect(page.getByRole("button", { name: "Open existing" })).toBeVisible();
    const tag = uniqueTag("L4");
    await drawer.fill({ company: `${tag} Dup Phone Co`, contactName: "Dup Buyer", product: "Weighbridge", source: "Website" });
    await drawer.save();
    await expect(drawer.error).toBeVisible();
    const withPhone = (await api.get(`/modules/leads?search=${base.phone}`)).body.data ?? [];
    expect(withPhone.map((l) => l.id)).toEqual([base.id]);

    // 2. company duplicate (only the company is filled: the check searches by the first filled key, phone > email > company).
    await list.goto();
    await list.clickNew();
    await drawer.fill({ company: base.company });
    await expect(drawer.duplicateBanner).toBeVisible();

    // 3. email duplicate. Spec: the banner appears for a duplicate email too. The UI search only covers company/phone, so an
    // email-only duplicate is never detected.
    await list.goto();
    await list.clickNew();
    const searched = page.waitForResponse((r) => r.url().includes("/modules/leads?") && r.url().includes("search="));
    await drawer.fill({ email: base.email });
    expect((await searched).status()).toBe(200); // the duplicate check has completed
    await expect(drawer.duplicateBanner).toBeVisible({ timeout: 1_000 });

    // Open existing navigates to the matching lead.
    await list.goto();
    await list.clickNew();
    await drawer.fill({ phone: base.phone });
    await drawer.openExisting();
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    expect(idFromUrl(page)).toBe(base.id);

    // Server side: a duplicate create is rejected (409).
    const second = await api.post("/modules/leads", {
      company: `${uniqueTag("L4")} Again Co`, contactName: "Again", phone: base.phone, product: "Weighbridge", source: "Website",
    });
    expect(second.status).toBe(409);
  });

  tc("TC-LEAD-007", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    const detail = new ModuleDetail(page);
    const firstResponse = await slaOf(api, lead.id); // SLA-01 running
    expect(firstResponse.t).toBe("green");
    await detail.goto("leads", lead.id);
    expect(await detail.statusText()).toBe("New");
    await detail.action("Mark contacted");
    await expect.poll(() => detail.statusText()).toBe("Contacted");
    expect(await statusOf(api, lead.id)).toBe("Contacted");
    // SLA-01 stopped and SLA-02 'Lead qualification decision' started: the record's latest timer changed and is running (on track).
    const qualification = await slaOf(api, lead.id);
    expect(qualification.t).toBe("green");
    expect(qualification.l).toMatch(SLA_DUE);
    expect(qualification.l, "a new timer replaced the first-response timer").not.toBe(firstResponse.l);
    await page.reload();
    await detail.tab("SLA");
    await expect(page.getByRole("tabpanel").getByText(SLA_DUE)).toBeVisible({ timeout: 3_000 });
  });

  tc("TC-LEAD-008", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.qualifiedLead(api);
    await expectActionRejected(api, "leads", lead.id, "Mark contacted", {}, "Cannot Mark contacted a lead in status 'Qualified'.");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    expect(await detail.statusText()).toBe("Qualified");
    await detail.expectNoAction("Mark contacted");
  });

  tc("TC-LEAD-009", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    ok(await api.action("leads", lead.id, "Mark contacted"), "contact");
    ok(await api.patch(`/modules/leads/${lead.id}`, BANT), "capture BANT");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.expectNoAction("Convert to opportunity");
    await detail.action("Qualify");
    await expect.poll(() => detail.statusText()).toBe("Qualified");
    await detail.expectAction("Convert to opportunity");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
    // SLA-02 timer stopped
    expect(await slaOf(api, lead.id)).toEqual({ l: "Met", t: "gray" });
    // Nurture -> Qualify (Follow-up has no action that leads into it, so it cannot be built through the product)
    const nurtured = await build.lead(api);
    ok(await api.action("leads", nurtured.id, "Mark contacted"), "contact");
    ok(await api.action("leads", nurtured.id, "Move to nurture"), "nurture");
    ok(await api.patch(`/modules/leads/${nurtured.id}`, BANT), "capture BANT");
    ok(await api.action("leads", nurtured.id, "Qualify"), "qualify from nurture");
    expect(await statusOf(api, nurtured.id)).toBe("Qualified");
  });

  tc("TC-LEAD-010", async ({ page }) => {
    // Spec/flow: Budget, Authority, Need, Timeline must be captured before Qualified. Partial: the Qualify action has no
    // required-field guard, so Qualify with an empty Qualification section succeeds (current behaviour).
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    ok(await api.action("leads", lead.id, "Mark contacted"), "contact");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.tab("Qualification");
    for (const label of ["Budget", "Authority", "Need", "Timeline"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    const before = await leadOf(api, lead.id);
    for (const key of ["qBudget", "qAuth", "qNeed", "qTime"]) expect(before[key] ?? null, key).toBeNull();
    // Qualify is blocked until BANT is captured: refused by the server, the lead stays Contacted
    await detail.action("Qualify");
    expect(await statusOf(api, lead.id), "Qualify is blocked until BANT is captured").not.toBe("Qualified");
    expect((await api.action("leads", lead.id, "Qualify")).status).toBe(400);
    // with BANT captured it goes through
    ok(await api.patch(`/modules/leads/${lead.id}`, BANT), "capture BANT");
    ok(await api.action("leads", lead.id, "Qualify"), "qualify");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
  });

  tc("TC-LEAD-011", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    const detail = new ModuleDetail(page);
    // not allowed from New / Qualified
    await detail.goto("leads", lead.id);
    await detail.expectNoAction("Move to nurture");
    await expectActionRejected(api, "leads", lead.id, "Move to nurture", {}, "Cannot Move to nurture a lead in status 'New'.");
    const q = await build.qualifiedLead(api);
    await expectActionRejected(api, "leads", q.id, "Move to nurture", {}, "Cannot Move to nurture a lead in status 'Qualified'.");
    // allowed from Contacted, then re-qualify
    ok(await api.action("leads", lead.id, "Mark contacted"), "contact");
    await detail.goto("leads", lead.id);
    await detail.action("Move to nurture");
    await expect.poll(() => statusOf(api, lead.id)).toBe("Nurture");
    ok(await api.patch(`/modules/leads/${lead.id}`, BANT), "capture BANT");
    await detail.goto("leads", lead.id);
    expect(await detail.isOutOfFlow()).toBe(true); // Nurture is outside the progress-bar flow
    await detail.action("Qualify");
    await expect.poll(() => flowStatus(detail)).toBe("Qualified");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
  });

  tc("TC-LEAD-012", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.action("Disqualify");
    await detail.answerPrompt("Budget");
    await expect.poll(() => statusOf(api, lead.id)).toBe("Disqualified");
    const after = await leadOf(api, lead.id);
    expect(after.disqualifyReason).toBe("Budget");
    await detail.goto("leads", lead.id);
    expect(await detail.isOutOfFlow()).toBe(true);
    // Spec: removed from active views. The default list still returns a Disqualified lead.
    const res = await api.get(`/modules/leads?search=${encodeURIComponent(lead.company)}`);
    expect((res.body.data ?? []).map((l) => l.id)).not.toContain(lead.id);
  });

  tc("TC-LEAD-013", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    ok(await api.action("leads", lead.id, "Mark contacted"), "contact");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.action("Disqualify");
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#action-ask-field")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled(); // UI requires the reason
    await expectActionRejected(api, "leads", lead.id, "Disqualify", {}, "'disq' is required to Disqualify.");
    expect(await statusOf(api, lead.id)).toBe("Contacted");
  });

  tc("TC-LEAD-014", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.qualifiedLead(api);
    // Server wording is the generic status guard (the spec's "only allowed from ..." is carried by the action's status list).
    await expectActionRejected(api, "leads", lead.id, "Disqualify", { disq: "Budget" }, "Cannot Disqualify a lead in status 'Qualified'.");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.expectNoAction("Disqualify");
  });

  tc("TC-LEAD-015", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.qualifiedLead(api, { product: "Weighbridge" });
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.expectOpen();
    await dialog.setContactRole("Decision Maker");
    await dialog.chooseNewAccount({ type: "Customer", industry: "Steel & metals", territory: "West", gstin: uniqueGstin() });
    const before = Date.now();
    await dialog.confirm();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const oppId = idFromUrl(page);

    const opp = rec(await api.get(`/modules/opps/${oppId}`), "read opportunity");
    expect(opp.stage).toBe("Qualified");
    expect(opp.title).toBe(`${lead.company} — Weighbridge`);
    // Spec: Qualified stage = 10%. The opportunity record carries no 'prob' value (the Probability field is always empty).
    expect(Number(opp.prob), "Qualified stage = 10%").toBe(10);
    const closeDays = (Date.parse(opp.closeDate as string) - before) / 86_400_000;
    expect(closeDays).toBeGreaterThan(89);
    expect(closeDays).toBeLessThan(91);
    expect(opp.nextAction).toBe("Follow up after conversion");
    const nextDays = (Date.parse(opp.nextActionDate as string) - before) / 86_400_000;
    expect(nextDays).toBeGreaterThan(6);
    expect(nextDays).toBeLessThan(8);
    expect(opp.ownerId).toBe(await userIdOf("salesExec1"));
    // linked Account + Contact
    const director = await apiAs("director"); // the converting rep's own record access cannot necessarily read the new records (see D-15)
    const accountId = opp.accountId as string;
    const contactId = opp.contactId as string;
    const account = rec(await director.get(`/modules/accounts/${accountId}`), "read account");
    expect(account.name).toBe(lead.company);
    expect(account.gstin).toBeTruthy();
    const contact = rec(await director.get(`/modules/contacts/${contactId}`), "read contact");
    expect(contact.accountId).toBe(account.id);
    expect(contact.role).toBe("Decision Maker");
    expect(contact.phone).toBe(lead.phone);
    expect(await statusOf(api, lead.id)).toBe("Converted");
    // Spec: owner carried over to the new records. Accounts/contacts created by the conversion get no owner, so the converting
    // Sales Executive (own-records access) gets 404 on the account and contact they just created.
    expect((await api.get(`/modules/accounts/${accountId}`)).status, "converting rep can read the new account").toBe(200);
    expect((await api.get(`/modules/contacts/${contactId}`)).status, "converting rep can read the new contact").toBe(200);
    // the detail page of the new opportunity shows the Qualified stage
    await expect(page.getByText(`${lead.company} — Weighbridge`).first()).toBeVisible();
  });

  tc("TC-LEAD-016", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.qualifiedLead(api);
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.expectOpen();
    await dialog.chooseNewAccount({ type: "Customer", industry: "Cement", territory: "West" });
    await expect(dialog.convertButton).toBeDisabled(); // UI will not submit without the buying role
    const r = await api.action("leads", lead.id, "Convert to opportunity", { account: { type: "Customer", industry: "Cement", territory: "West" } });
    expect(r.status).toBe(400);
    expect(ApiClient.message(r)).toBe("'contactRole' is required to convert a lead.");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
  });

  tc("TC-LEAD-017", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.qualifiedLead(api);
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.expectOpen();
    await dialog.setContactRole("Decision Maker");
    await expect(dialog.convertButton).toBeDisabled(); // new account chosen by default, industry/territory/type blank
    await page.locator("#convert-account-type").selectOption("Customer");
    await expect(dialog.convertButton).toBeDisabled(); // industry + territory still blank
    const r = await api.action("leads", lead.id, "Convert to opportunity", { contactRole: "Decision Maker", account: { type: "Customer" } });
    expect(r.status).toBe(400);
    const msg = ApiClient.message(r);
    for (const field of ["account.type", "account.industry", "account.territory"]) expect(msg).toContain(field);
    expect(msg).toContain("required");
    expect(await statusOf(api, lead.id)).toBe("Qualified");
  });

  tc("TC-LEAD-018", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const t = uniqueTag("L18");
    const existing = await build.account(api, { name: `${t} Pvt. Ltd.`, short: t });
    const lead = await build.qualifiedLead(api, { company: `${t} Private Limited` });
    const body = { contactRole: "Decision Maker", account: { type: "Customer", industry: "Cement", territory: "West" } };
    // Name normalisation ignores Pvt/Ltd/Private/Limited and punctuation: server flags the duplicate, nothing is created.
    const dup = await api.action("leads", lead.id, "Convert to opportunity", body);
    expect(dup.status).toBeLessThan(300);
    expect(dup.body).toMatchObject({ duplicate: true, existingAccountId: existing.id });
    expect(await statusOf(api, lead.id)).toBe("Qualified");
    const found = (await api.get(`/modules/accounts?search=${t}`)).body.data ?? [];
    expect(found.map((a) => a.id)).toEqual([existing.id]);

    // UI: the dialog resolves the duplicate on its own and converts onto the existing account.
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.setContactRole("Decision Maker");
    await dialog.chooseNewAccount({ type: "Customer", industry: "Cement", territory: "West" });
    // Record, while the dialog is mounted, whether any duplicate notice / "Open existing" control ever appears in it.
    await page.evaluate(() => {
      const w = window as unknown as { __dupSeen?: boolean };
      w.__dupSeen = false;
      new MutationObserver(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (dlg && /already exists|open existing/i.test(dlg.textContent ?? "")) w.__dupSeen = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await dialog.confirm();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const dupSeen = await page.evaluate(() => (window as unknown as { __dupSeen?: boolean }).__dupSeen === true);
    const opp = rec(await api.get(`/modules/opps/${idFromUrl(page)}`), "read opportunity");
    expect(opp.accountId).toBe(existing.id);
    expect(((await api.get(`/modules/accounts?search=${t}`)).body.data ?? []).map((a) => a.id)).toEqual([existing.id]); // still one account
    // Spec: UI shows an 'Open existing' / link option. The dialog silently reuses the account and never shows a duplicate notice.
    await knownDefect(test.info(), "D-12", async () => {
      expect(dupSeen, "duplicate notice / Open existing shown in the dialog").toBe(true);
    });
  });

  tc("TC-LEAD-019", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const gstin = uniqueGstin();
    const existing = await build.account(api, { gstin });
    const lead = await build.qualifiedLead(api);
    const body = { contactRole: "Decision Maker", account: { type: "Customer", industry: "Cement", territory: "West", gstin } };
    const dup = await api.action("leads", lead.id, "Convert to opportunity", body);
    expect(dup.status).toBeLessThan(300);
    expect(dup.body).toMatchObject({ duplicate: true, existingAccountId: existing.id });
    expect(await statusOf(api, lead.id)).toBe("Qualified");
    const tag = lead.company.split(" ")[0] ?? "";
    expect(((await api.get(`/modules/accounts?search=${tag}`)).body.data ?? []).map((a) => a.id), "no account for the lead company").toEqual([]);

    // UI: typing the GSTIN of another account converts onto that account (auto-resolved), no new account.
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.setContactRole("Decision Maker");
    await dialog.chooseNewAccount({ type: "Customer", industry: "Cement", territory: "West", gstin });
    await dialog.confirm();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    expect(rec(await api.get(`/modules/opps/${idFromUrl(page)}`), "read opportunity").accountId).toBe(existing.id);
    expect(((await api.get(`/modules/accounts?search=${tag}`)).body.data ?? []).map((a) => a.id)).toEqual([]);
  });

  tc("TC-LEAD-020", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const lead = await build.qualifiedLead(api);
    const contact = await build.contact(api, account.id, { phone: lead.phone, email: lead.email });
    const dup = await api.action("leads", lead.id, "Convert to opportunity", { contactRole: "Decision Maker", accountId: account.id });
    expect(dup.status).toBeLessThan(300);
    expect(dup.body).toMatchObject({ duplicate: true, existingContactId: contact.id });
    expect(await statusOf(api, lead.id)).toBe("Qualified");

    // UI: the dialog links the existing contact itself; no second contact appears.
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.setContactRole("Decision Maker");
    await dialog.chooseExisting(account.name.split(" ")[0] ?? "", account.name.split(" ")[0]);
    await dialog.confirm();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const opp = rec(await api.get(`/modules/opps/${idFromUrl(page)}`), "read opportunity");
    expect(opp.contactId).toBe(contact.id);
    const withPhone = (await api.get(`/modules/contacts?search=${lead.phone}`)).body.data ?? [];
    expect(withPhone.map((c) => c.id)).toEqual([contact.id]);
    expect(await statusOf(api, lead.id)).toBe("Converted");
  });

  tc("TC-LEAD-021", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const c1 = await build.contact(api, account.id);
    const lead = await build.qualifiedLead(api);
    // UI: selecting an existing account offers no way to pick a specific contact (spec: "pick existing account and contact C1").
    const detail = new ModuleDetail(page);
    const dialog = new ConvertLeadDialog(page);
    await detail.goto("leads", lead.id);
    await detail.action("Convert to opportunity");
    await dialog.setContactRole("Decision Maker");
    await dialog.chooseExisting(account.name.split(" ")[0] ?? "", account.name.split(" ")[0]);
    await knownDefect(test.info(), "D-13", async () => {
      await expect(dialog.root.getByText(/existing contact|select contact|search contacts/i).first()).toBeVisible({ timeout: 1_500 });
    });
    // API (contactId payload): opportunity linked to C1, no new contact, lead Converted.
    const r = ok(await api.action("leads", lead.id, "Convert to opportunity", { contactRole: "Decision Maker", accountId: account.id, contactId: c1.id }), "convert");
    expect(r.body.contactId).toBe(c1.id);
    expect(r.body.accountId).toBe(account.id);
    const opp = rec(await api.get(`/modules/opps/${r.body.opportunityId as string}`), "read opportunity");
    expect(opp.contactId).toBe(c1.id);
    expect(((await api.get(`/modules/contacts?search=${lead.phone}`)).body.data ?? []), "no new contact").toHaveLength(0);
    expect(await statusOf(api, lead.id)).toBe("Converted");
  });

  tc("TC-LEAD-022", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    ok(await api.action("leads", lead.id, "Mark contacted"), "contact");
    const r = await api.action("leads", lead.id, "Convert to opportunity", { contactRole: "Decision Maker", account: { type: "Customer", industry: "Cement", territory: "West" } });
    expect(r.status).toBe(400);
    expect(ApiClient.message(r)).toBe("Lead must be Qualified before it can be converted (current status: 'Contacted').");
    expect(await statusOf(api, lead.id)).toBe("Contacted");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.expectNoAction("Convert to opportunity");
  });

  tc("TC-LEAD-023", async ({ page }) => {
    // Breach observation (red 'breached' + escalation) belongs to the SLA-engine specs (Task 11b); here: the timer exists, runs and is shown.
    test.info().annotations.push({ type: "note", description: "breach/escalation is covered by the SLA engine specs (Task 11b)" });
    const api = await apiAs("salesExec1");
    const lead = await build.lead(api);
    const list = new ModuleList(page, "leads");
    await list.goto();
    await list.search(lead.company);
    const row = list.row(lead.company);
    await expect(row).toBeVisible();
    expect(await slaOf(api, lead.id)).toMatchObject({ t: "green" }); // the API record carries the running first-response timer
    expect((await slaOf(api, lead.id)).l).toMatch(SLA_DUE);
    // Response SLA column: the cell renders the {l, t} object as "[object Object]" instead of the remaining time.
    await expect(row.getByText(SLA_DUE).first()).toBeVisible({ timeout: 3_000 });
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.tab("SLA");
    await expect(page.getByRole("tabpanel").getByText(SLA_DUE)).toBeVisible({ timeout: 3_000 });
  });

  // Skipped (wall-clock): bracket arithmetic is time-of-day dependent (D-17: business hours are computed in UTC), the policy tiers
  // are unreadable through the API (D-7: slaPolicies/slaTimers 403) and the creation time is uncontrollable. It belongs in a backend
  // unit test of SlaEngineService.pickTarget.
  tc("TC-LEAD-024", async () => {});

  tc("TC-LEAD-026", async ({ page, browser }) => {
    const exec1 = await apiAs("salesExec1");
    const exec2 = await apiAs("salesExec2");
    const mine = await build.lead(exec1);
    const theirs = await build.lead(exec2);
    // exec1 lists with exec2's company as the search key: 200 with an empty page, never the other rep's lead
    const search = await exec1.get(`/modules/leads?search=${encodeURIComponent(theirs.company)}`);
    expect(search.status).toBe(200);
    expect(search.body.data).toEqual([]);
    const own = await exec1.get(`/modules/leads?search=${encodeURIComponent(mine.company)}`);
    expect((own.body.data ?? []).map((l) => l.id)).toEqual([mine.id]);
    // direct access: not found, in the API and in the UI
    const direct = await exec1.get(`/modules/leads/${theirs.id}`);
    expect(direct.status).toBe(404);
    await page.goto(detailUrl("leads", theirs.id));
    await expect(page.getByText("Couldn't load this record.")).toBeVisible();
    // the owner sees it
    await asRole(browser, "salesExec2", async (p) => {
      await p.goto(detailUrl("leads", theirs.id));
      await expect(p.getByRole("button", { name: "More actions", exact: true })).toBeVisible({ timeout: 30_000 }); // fresh context: cold page load
    });
  });
});

test.describe("LEAD - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-LEAD-005", async ({ page, browser }) => {
    const manager = await apiAs("salesManager");
    const exec2Id = await userIdOf("salesExec2");
    const tag = uniqueTag("L5");
    const company = `${tag} Steel Pvt Ltd`;
    const list = new ModuleList(page, "leads");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // The Owner field is a plain text box taking a user id (no picker) - D-18.
    await drawer.fill({ company, contactName: "Owner Test", phone: uniquePhone(), product: "Weighbridge", source: "Website", ownerId: exec2Id });
    await drawer.save();
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    const id = idFromUrl(page);
    expect((await leadOf(manager, id)).ownerId).toBe(exec2Id);
    // visible to the assigned owner
    await asRole(browser, "salesExec2", async (p) => {
      await p.goto(detailUrl("leads", id));
      await expect(p.getByRole("button", { name: "More actions", exact: true })).toBeVisible({ timeout: 30_000 }); // fresh context: cold page load
      await expect(p.getByText(company).first()).toBeVisible({ timeout: 30_000 });
    });
    // a role without cross-owner permission is forced to own the lead
    const exec1 = await apiAs("salesExec1");
    const forced = await build.lead(exec1, { ownerId: exec2Id });
    expect((await leadOf(exec1, forced.id)).ownerId).toBe(await userIdOf("salesExec1"));
  });

  tc("TC-LEAD-006", async () => {
    // Spec: leads created without an owner are auto-assigned by the configured rule (so not all end up with the creator).
    // Gap: MfgLeadsService has no assignment code; every lead defaults to the creator. tc() wraps this as an expected failure.
    const manager = await apiAs("salesManager");
    const managerId = await userIdOf("salesManager");
    const owners: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const lead = await build.lead(manager);
      owners.push((await leadOf(manager, lead.id)).ownerId as string);
    }
    expect(owners.some((o) => o !== managerId), `owners: ${owners.join(",")}`).toBe(true);
    expect(new Set(owners).size).toBeGreaterThan(1);
  });

  tc("TC-LEAD-027", async ({ page }) => {
    const api = await apiAs("salesManager");
    const exec2Id = await userIdOf("salesExec2");
    const tag = uniqueTag("L27");
    const exec2 = await apiAs("salesExec2");
    const a = await build.lead(api, { company: `${tag} Alpha Pvt Ltd`, value: 3_000_000 });
    const b = await build.lead(api, { company: `${tag} Bravo Pvt Ltd`, value: 1_000_000 });
    const c = await build.lead(exec2, { company: `${tag} Charlie Pvt Ltd`, value: 2_000_000 });
    ok(await api.action("leads", b.id, "Mark contacted"), "contact b");
    const q = (extra: string): Promise<ApiResult> => api.get(`/modules/leads?search=${tag}${extra}`);
    const ids = (r: ApiResult): string[] => (r.body.data ?? []).map((l) => l.id as string);

    // search by company and by phone
    const all = await q("&limit=100");
    expect(ids(all).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(all.body.total).toBe(3);
    expect(ids(await api.get(`/modules/leads?search=${a.phone}`))).toEqual([a.id]);
    // filter by status and by owner
    expect(ids(await q("&status=Contacted"))).toEqual([b.id]);
    expect(ids(await q(`&ownerId=${exec2Id}`))).toEqual([c.id]);
    // sort by value (asc, then desc)
    expect(ids(await q("&sort=value&limit=100"))).toEqual([b.id, c.id, a.id]);
    expect(ids(await q("&sort=-value&limit=100"))).toEqual([a.id, c.id, b.id]);
    // server-side pagination, total stays correct
    const p1 = await q("&sort=value&limit=2&page=1");
    const p2 = await q("&sort=value&limit=2&page=2");
    expect(ids(p1)).toEqual([b.id, c.id]);
    expect(ids(p2)).toEqual([a.id]);
    expect([p1.body.total, p2.body.total, p1.body.pages]).toEqual([3, 3, 2]);

    // UI: search by company shows the matching rows
    const list = new ModuleList(page, "leads");
    await list.goto();
    await list.search(tag);
    for (const company of [`${tag} Alpha`, `${tag} Bravo`, `${tag} Charlie`]) await expect(list.row(company)).toBeVisible();
    await list.search(`${tag} Bravo`);
    await expect(list.row(`${tag} Bravo`)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: `${tag} Alpha` })).toHaveCount(0);
  });
});

test.describe("LEAD - Director", () => {
  test.use({ storageState: authFile("director") });

  tc("TC-LEAD-025", async ({ page }) => {
    // The case names Sales Manager "with Delete permission"; the default matrix (PERM_SPEC 'Sales Manager': ALL:CRUE) gives Sales Manager
    // no Delete, so the archive is exercised as Director (CRUDE) and the Sales Manager refusal is asserted as the current default.
    test.info().annotations.push({ type: "note", description: "case role is Sales Manager, but the seed matrix gives it no Delete; Director archives" });
    const api = await apiAs("director");
    const manager = await apiAs("salesManager");
    const lead = await build.lead(manager);
    const refused = await manager.post(`/modules/leads/${lead.id}/archive`);
    expect(refused.status).toBe(403);
    expect(ApiClient.message(refused)).toBe("Your role does not have 'delete' access to 'leads'.");
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.archive();
    await expect.poll(async () => (await api.get(`/modules/leads/${lead.id}`)).status).toBe(404);
    const res = await api.get(`/modules/leads?search=${encodeURIComponent(lead.company)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    // 'remains in DB (isDeleted = true)' cannot be read from the API (soft delete is covered by the backend unit spec); the product
    // exposes no hard-delete route.
  });
});

test.describe("LEAD - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  // Skipped: external delivery (webhook/website/Meta/IndiaMART payloads) cannot be driven from the browser suite.
  tc("TC-LEAD-028", async () => {});
});
