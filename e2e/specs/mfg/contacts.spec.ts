// e2e/specs/mfg/contacts.spec.ts (not con.spec.ts: CON is a reserved Windows device name that git cannot open) - CON module (TC-CON-001..005): contacts, buying roles, duplicates, plant linkage, deactivation.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { uniqueEmail, uniquePhone, uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const contactOf = async (api: Awaited<ReturnType<typeof apiAs>>, id: string): Promise<Rec> =>
  ok(await api.get(`/modules/contacts/${id}`), "read contact").body as Rec;
const idsOf = (r: ApiResult): string[] => (r.body.data ?? []).map((c) => c.id as string);
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const DETAIL_RE = /\/contacts\/[0-9a-f-]{36}$/;
const BUYING_ROLES = ["Decision Maker", "Technical Influencer", "User", "Procurement", "Finance", "Gatekeeper", "Management"];

test.describe("CON - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-CON-001", async ({ page }) => {
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    await build.plant(api, account.id, "Plant 1");
    const tag = uniqueTag("C1");
    const phone = uniquePhone();
    const email = uniqueEmail(tag);
    const list = new ModuleList(page, "contacts");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    await expect(page.locator("#accountId")).toBeVisible();
    await expect(page.locator("#accountId")).toHaveJSProperty("tagName", "SELECT", { timeout: 1_000 }); // spec: pick the account
    await drawer.fill({
      name: `${tag} Contact`, accountId: account.id, plant: "Plant 1", designation: "Purchase Manager", phone, whatsapp: phone, email,
      role: "Decision Maker", influence: "High",
    });
    await drawer.save();
    await page.waitForURL(DETAIL_RE);
    const id = idFromUrl(page);
    const contact = await contactOf(api, id);
    expect(contact).toMatchObject({
      name: `${tag} Contact`, accountId: account.id, plant: "Plant 1", designation: "Purchase Manager", phone, whatsapp: phone, email,
      role: "Decision Maker", influence: "High", status: "Active",
    });
    // visible on the account's Contacts tab
    const detail = new ModuleDetail(page);
    await detail.goto("accounts", account.id);
    await detail.tab("Contacts");
    await expect(page.getByRole("tabpanel").getByText(`${tag} Contact`)).toBeVisible();
    expect(idsOf(await api.get(`/modules/accounts/${account.id}/related/contacts`))).toEqual([id]);
  });

  tc("TC-CON-002", async ({ page }) => {
    const list = new ModuleList(page, "contacts");
    await list.goto();
    await list.clickNew();
    await expect(page.locator("#role")).toBeVisible();
    const options = (await page.locator("#role option").allInnerTexts()).filter((t) => t !== "Select…");
    expect(options).toEqual(BUYING_ROLES);
    expect(options).toHaveLength(7);
    // the server accepts exactly these roles
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    for (const role of BUYING_ROLES) await build.contact(api, account.id, { role });
    const bad = await api.post("/modules/contacts", { accountId: account.id, name: "Bad Role", phone: uniquePhone(), role: "Janitor" });
    expect(bad.status).toBe(400);
  });

  tc("TC-CON-003", async ({ page }) => {
    // Spec: duplicate flagged before save. Current (verification note): the form warns on blur by phone/email using the org-wide list
    // search (not scoped to the same account) and never blocks saving; the backend does not enforce uniqueness.
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const base = await build.contact(api, account.id);
    const baseRec = await contactOf(api, base.id);
    const phone = baseRec.phone as string;
    const list = new ModuleList(page, "contacts");
    const drawer = new ModuleDrawer(page);

    // 1. same phone: banner, Open existing lands on the existing contact
    await list.goto();
    await list.clickNew();
    await drawer.fill({ phone });
    await expect(drawer.duplicateBanner).toBeVisible();
    await drawer.openExisting();
    await page.waitForURL(DETAIL_RE);
    expect(idFromUrl(page)).toBe(base.id);

    // 2. same phone on the same account: Save is refused and no second contact is created
    await list.goto();
    await list.clickNew();
    const tag = uniqueTag("C3");
    await drawer.fill({ phone });
    await expect(drawer.duplicateBanner).toBeVisible();
    await drawer.fill({ name: `${tag} Dup Contact`, accountId: account.id, role: "User" });
    await drawer.save();
    await expect(drawer.error).toBeVisible();
    expect(idsOf(await api.get(`/modules/accounts/${account.id}/related/contacts`))).toEqual([base.id]);

    // 3. email-only duplicate. Spec: banner too. The check searches by the first filled key and the contact list search only matches
    // name/phone, so an email-only duplicate is never detected.
    await list.goto();
    await list.clickNew();
    const searched = page.waitForResponse((r) => r.url().includes("/modules/contacts?") && r.url().includes("search="));
    await drawer.fill({ email: baseRec.email as string });
    expect((await searched).status()).toBe(200); // the duplicate check has completed
    await expect(drawer.duplicateBanner).toBeVisible({ timeout: 1_000 });

    // Server side: a duplicate create on the same account is rejected (409).
    const second = await api.post("/modules/contacts", { accountId: account.id, name: `${uniqueTag("C3")} Again`, phone, role: "User" });
    expect(second.status, "duplicate contact is rejected").toBe(409);
  });

  tc("TC-CON-004", async ({ page }) => {
    // Pre (account with 2 plants) cannot be built: plants cannot be created (D-21). The plant is a free-text field on the contact.
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    await build.plant(api, account.id, "Plant 1");
    await build.plant(api, account.id, "Plant 2");
    const tag = uniqueTag("C4");
    const list = new ModuleList(page, "contacts");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    await expect(page.locator("#plant")).toBeVisible();
    // Spec: only plants of the chosen account are offered (a select). Current: free-text box, any value accepted.
    await expect(page.locator("#plant")).toHaveJSProperty("tagName", "SELECT", { timeout: 1_000 });
    await drawer.fill({ name: `${tag} Contact`, accountId: account.id, plant: "Plant 2", phone: uniquePhone(), role: "Technical Influencer" });
    await drawer.save();
    await page.waitForURL(DETAIL_RE);
    expect((await contactOf(api, idFromUrl(page))).plant).toBe("Plant 2");
    // the contact shows its plant
    await expect(page.getByText("Plant 2").first()).toBeVisible();
  });
});

test.describe("CON - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-CON-005", async ({ page }) => {
    // Spec: a contact can be set inactive; it stays in history but is not offered for new transactions. Partial: the only way to
    // change status is PATCH (the edit drawer hides the status field and the detail page has no action).
    const api = await apiAs("salesManager");
    const tag = uniqueTag("C5");
    const account = await build.account(api);
    const contact = await build.contact(api, account.id, { name: `${tag} Contact` });
    const detail = new ModuleDetail(page);
    await detail.goto("contacts", contact.id);
    expect(await detail.statusText()).toBe("Active");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit Contact" })).toBeVisible();
    await expect(page.locator("#name")).toBeVisible(); // drawer loaded
    await knownDefect(test.info(), "D-29", async () => {
      await expect(page.locator("#status")).toBeVisible({ timeout: 1_000 }); // UI control to set the contact inactive
    });

    ok(await api.patch(`/modules/contacts/${contact.id}`, { status: "Inactive" }), "deactivate contact");
    // remains in history: still readable, still on the account's Contacts tab (with status Inactive)
    expect((await contactOf(api, contact.id)).status).toBe("Inactive");
    const related = (await api.get(`/modules/accounts/${account.id}/related/contacts`)).body.data ?? [];
    expect(related.map((c) => [c.id, c.status])).toEqual([[contact.id, "Inactive"]]);
    await page.goto(`/contacts/${contact.id}`);
    await expect(page.getByTestId("status-badge")).toHaveText("Inactive");
    // not offered for new transactions: the default contact list still returns the inactive contact (it can only be excluded by
    // an explicit status filter).
    const listed = await api.get(`/modules/contacts?search=${encodeURIComponent(tag)}`);
    expect(listed.status).toBe(200); // settled response
    await knownDefect(test.info(), "D-30", async () => {
      expect(idsOf(listed), "inactive contact is not offered").not.toContain(contact.id);
    });
    expect(idsOf(await api.get(`/modules/contacts?search=${encodeURIComponent(tag)}&status=Active`))).toEqual([]); // explicit filter works
  });
});
