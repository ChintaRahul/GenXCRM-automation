import { test as setup, expect } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS, Role } from "./fixtures/users";
import { LoginPage } from "./pages/LoginPage";
import { MFG_PASSWORD, MFG_ROLE_KEYS, MFG_USERS, authFile } from "./fixtures/mfgUsers";
import { assertNoProviderCredentials } from "./mfg/envGuard";
import { pruneStaleSlaTimers, restoreAdminConfigIfNeeded, restoreApprovalRulesIfNeeded, restoreMarginRulesIfNeeded, restoreSlaThrowawayIfNeeded } from "./mfg/db";

// Logs in once per role and saves the resulting session (localStorage JWT) to disk.
// Every other spec reuses these instead of going through the login form each time —
// see fixtures/test.ts and playwright.config.ts `projects[].dependencies`.
const roles: Role[] = ["director", "manager", "salesRep"];

for (const role of roles) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(E2E_USERS[role].email, E2E_PASSWORD);
    await expect(page).toHaveURL("/");
    await page.context().storageState({ path: `.auth/${role}.json` });
  });
}

for (const role of MFG_ROLE_KEYS) {
  setup(`authenticate mfg ${role}`, async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(MFG_USERS[role].email, MFG_PASSWORD);
    await expect(page, `login failed for ${MFG_USERS[role].email} — did you run \`npm run seed\`?`).toHaveURL("/");
    await page.context().storageState({ path: authFile(role) });
  });
}

setup("E2E env has no real provider credentials", () => {
  assertNoProviderCredentials();
});

// Heal a throwaway SLA policy left active by a crashed SLA spec (it would otherwise add timers / notifications to the leads that later specs create).
setup("no leftover throwaway SLA policy", async () => {
  await restoreSlaThrowawayIfNeeded();
});

// Heal margin / approval rules left deactivated or edited by a crashed spec (the persisted pre-state is re-applied).
setup("no leftover margin / approval rule change", async () => {
  await restoreMarginRulesIfNeeded();
  await restoreApprovalRulesIfNeeded();
});

// Heal Administration config (permission matrix, field security, calendar, stage master, E2E- rows) left changed by a crashed ADM spec: every other spec depends on it.
setup("no leftover administration config change", async () => {
  await restoreAdminConfigIfNeeded();
});

// Thousands of stale open SLA timers slow the SLA tick to ~35 s; with an idle backend ~3,700 open timers keep it at ~85% CPU and PATCHes stall for 20 s+ (TC-OPP-004 failed in full runs 2 and 3 because of the backlog left by the previous run).
// Setup runs before any spec, so every timer of the E2E orgs is from an earlier run: drop them all (throwaway E2E-SLA- policies excepted).
setup("prune stale SLA timers", async ({}, testInfo) => {
  const pruned = await pruneStaleSlaTimers(0);
  testInfo.annotations.push({ type: "pruned-sla-timers", description: String(pruned) });
  console.log(`pruned ${pruned} stale SLA timers`);
});
