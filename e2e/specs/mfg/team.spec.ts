// e2e/specs/mfg/team.spec.ts - Team, integrations & billing (TC-TEAM-001..009). 001 / 003 / 004 / 005 / 006 / 008 are skip (external delivery) and 009 is skip
// (infra): empty bodies, the tc() wrapper skips them. Auto cases: 002 (deactivate a THROWAWAY user created by the test - never a seeded mfg user) and
// 007 (CSV import wizard, driven with a small generated CSV; no e-mail column, no course column, and the org has no nurturing sequence, so the import
// triggers no outbound message).
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authFile, MFG_PASSWORD, MFG_USERS } from "../../fixtures/mfgUsers";
import { LoginPage } from "../../pages/LoginPage";
import { API, apiAs, ApiClient, build, ok } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { readAdminExtras } from "../../mfg/db";
import { knownDefect } from "../../mfg/guards";
import { uniqueEmail, uniquePhone, uniqueTag } from "../../mfg/tag";

const ORG_USER = MFG_USERS.director.email;
const BASE = "http://localhost:5174";

const userIdOf = (api: ApiClient): string => {
  const payload = JSON.parse(Buffer.from(api.token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error("no user id in the JWT");
  return id;
};
const rawLogin = async (email: string, password: string): Promise<{ status: number; token?: string; message: string }> => {
  const res = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = (await res.json()) as { token?: string; message?: unknown };
  const m = body.message;
  return { status: res.status, token: body.token, message: typeof m === "string" ? m : ((m as { message?: string } | undefined)?.message ?? "") };
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

test.describe("TEAM - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-TEAM-001", async () => {});

  tc("TC-TEAM-002", async ({ page, browser }, testInfo) => {
    test.slow();
    const tag = uniqueTag("TEAM2");
    const email = uniqueEmail(tag);
    const name = `${tag} Throwaway Rep`;
    const admin = await apiAs("superAdmin");
    // The user is created with a password (no invite e-mail is sent) and owns a lead and an account.
    const userId = ok(await admin.post("/users", { name, email, password: MFG_PASSWORD, role: "SALES_REP", mfgRole: "SALES_EXECUTIVE" }), "create throwaway user").body.id as string;
    const owned: { leads: string[]; accounts: string[] } = { leads: [], accounts: [] };
    try {
      const login = await rawLogin(email, MFG_PASSWORD);
      if (login.status !== 201 || !login.token) throw new Error(`precondition: the throwaway user can log in (HTTP ${login.status} ${login.message})`);
      const rep = new ApiClient(login.token);
      owned.accounts.push((await build.account(rep)).id);
      owned.leads.push((await build.lead(rep)).id);
      expect((ok(await rep.get(`/modules/leads/${owned.leads[0]}`), "rep reads own lead").body as { ownerId?: string }).ownerId, "the lead is owned by the throwaway user").toBe(userId);

      // Deactivate through the Team page (Members tab -> row -> Deactivate member -> confirm).
      await page.goto("/users");
      await page.getByRole("button", { name: "members", exact: true }).click();
      await page.getByPlaceholder("Search by name or email…").fill(email);
      const row = page.getByRole("row").filter({ hasText: email });
      await expect(row).toBeVisible();
      await row.getByTitle("Deactivate member").click();
      const deactivated = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/users/${userId}`));
      await page.getByRole("dialog").getByRole("button", { name: "Deactivate", exact: true }).click();
      expect((await deactivated).status(), "DELETE /users/:id").toBe(200);
      await expect(page.getByText("No members found"), "the deactivated member left the list").toBeVisible();

      // Login is blocked (API and login form), and the old session no longer works.
      const blocked = await rawLogin(email, MFG_PASSWORD);
      expect(blocked.status, "login API").toBe(401);
      expect(blocked.message).toBe("Incorrect email or password.");
      const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } }); // logged out (the project default state would be inherited)
      try {
        const loginPage = new LoginPage(await ctx.newPage());
        await loginPage.goto();
        await loginPage.login(email, MFG_PASSWORD);
        await expect(loginPage.errorMessage).toHaveText("Incorrect email or password.");
        await expect(loginPage.page).toHaveURL(/\/login$/);
      } finally {
        await ctx.close();
      }
      expect((await rep.get("/modules/leads?limit=1")).status, "the old token is rejected").toBe(401);

      // Records remain (still owned by the inactive user) and can be reassigned.
      const director = await apiAs("director");
      expect((ok(await director.get(`/modules/leads/${owned.leads[0]}`), "director reads the lead").body as { ownerId?: string }).ownerId, "the lead stays with the deactivated user").toBe(userId);
      expect((ok(await director.get(`/modules/accounts/${owned.accounts[0]}`), "director reads the account").body as { ownerId?: string }).ownerId, "the account stays with the deactivated user").toBe(userId);
      const newOwner = userIdOf(await apiAs("salesExec1"));
      const moved = ok(await director.patch(`/modules/leads/${owned.leads[0]}`, { ownerId: newOwner }), "reassign the lead");
      expect((moved.body as { ownerId?: string }).ownerId, "reassigned").toBe(newOwner);
      expect((ok(await director.get(`/modules/leads/${owned.leads[0]}`), "re-read").body as { ownerId?: string }).ownerId).toBe(newOwner);
      testInfo.annotations.push({ type: "note", description: `throwaway user ${email} stays in the E2E org as a deactivated member (users are never hard-deleted)` });
    } finally {
      await archiveQuietly("leads", owned.leads);
      await archiveQuietly("accounts", owned.accounts);
      // Make sure the throwaway user cannot stay active if the test stopped early (idempotent; the seeded users are never touched).
      try {
        await fetch(`${API}/users/${userId}`, { method: "DELETE", headers: { authorization: `Bearer ${admin.token}` } });
      } catch {
        // cleanup only
      }
    }
  });

  tc("TC-TEAM-003", async () => {});
  tc("TC-TEAM-004", async () => {});
  tc("TC-TEAM-005", async () => {});
  tc("TC-TEAM-006", async () => {});

  tc("TC-TEAM-007", async ({ page }, testInfo) => {
    test.slow();
    // Safety: a lead import runs the org's 'lead created' nurturing sequences; the E2E org has none, so nothing can be sent.
    expect((await readAdminExtras(ORG_USER)).nurturingSequences, "the E2E org has no nurturing sequence (no outbound message possible)").toBe(0);
    const tag = uniqueTag("CSV");
    const [phone1, phone2] = [uniquePhone(), uniquePhone()];
    const names = { one: `${tag} One`, two: `${tag} Two` };
    const csvPath = testInfo.outputPath("leads.csv");
    writeFileSync(csvPath, [
      "Full Name,Mobile,Email Address,City,Lead Source",
      `${names.one},${phone1},,Pune,FACEBOOK`,
      `${names.two},${phone2},,Delhi,WEBSITE`,
      `${tag} Duplicate,${phone1},,Pune,FACEBOOK`, // same phone as row 1
      `${tag} No phone,,,Pune,FACEBOOK`, // required field missing
    ].join("\n"));

    const admin = await apiAs("superAdmin");
    const importedIds = async (): Promise<string[]> => (ok(await admin.get(`/leads?search=${encodeURIComponent(tag)}&limit=50`), "list imported leads").body.data ?? []).map((l) => l.id as string);
    try {
      await page.goto("/integrations");
      await page.getByRole("button", { name: /CSV \/ Excel import/ }).click();
      await page.getByRole("button", { name: "Start import wizard" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles(csvPath);
      await expect(dialog.getByText("Map your columns")).toBeVisible();
      await expect(dialog.getByText("5 columns detected")).toBeVisible();
      await dialog.getByRole("button", { name: "Import 4 leads" }).click();

      // Result: rows imported, the duplicate reported, the invalid row listed with its reason.
      await expect(dialog.getByText("Import complete!")).toBeVisible({ timeout: 30_000 });
      await expect(dialog.getByText("4 rows processed")).toBeVisible();
      await expect(dialog.getByText("Imported", { exact: true }).locator("..")).toHaveText(/^2\s*Imported$/);
      await expect(dialog.getByText("Skipped", { exact: true }).locator("..")).toHaveText(/^2\s*Skipped$/);
      await expect(dialog.getByText("Row 3").locator("..")).toContainText("A lead with this phone number or email already exists.");
      await expect(dialog.getByText("Row 4").locator("..")).toContainText("Missing required field: phone");
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click(); // the footer button (the header X has the same name)

      // The two valid rows exist - in the generic (EdTech) Lead table of the org ...
      const rows = (ok(await admin.get(`/leads?search=${encodeURIComponent(tag)}&limit=50`), "list imported leads").body.data ?? []) as { name: string; phone: string }[];
      expect(rows.map((l) => l.name).sort(), "generic Leads").toEqual([names.one, names.two]);
      // ... while Manufacturing leads (company / contact / product / source) are what the workspace works with. Spec: the import creates those (D-130).
      const mfgLeads = (ok(await admin.get(`/modules/leads?search=${encodeURIComponent(tag)}`), "list Manufacturing leads").body.data ?? []) as unknown[];
      await knownDefect(testInfo, "D-130", async () => {
        expect(mfgLeads, "the imported rows are Manufacturing leads").toHaveLength(2);
      });
      expect(mfgLeads, "current: nothing reaches the Manufacturing leads (remove with D-130)").toHaveLength(0);
    } finally {
      try {
        const ids = await importedIds();
        if (ids.length) await admin.post("/leads/archive", { leadIds: ids });
      } catch {
        // cleanup only
      }
    }
  });

  tc("TC-TEAM-008", async () => {});
  tc("TC-TEAM-009", async () => {});
});
