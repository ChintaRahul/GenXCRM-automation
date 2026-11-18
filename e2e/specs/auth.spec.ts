import { test, expect } from "../fixtures/test";
import { E2E_PASSWORD, E2E_USERS } from "../fixtures/users";
import { LoginPage } from "../pages/LoginPage";
import { AppShell } from "../pages/AppShell";

test.describe("Auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("logs in with valid credentials and lands on the dashboard", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(E2E_USERS.salesRep.email, E2E_PASSWORD);

    await expect(page).toHaveURL("/");
  });

  test("shows an error for invalid credentials", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(E2E_USERS.salesRep.email, "wrong-password");

    await expect(page).toHaveURL("/login");
    await expect(loginPage.errorMessage).toBeVisible();
  });

  test("signs out and redirects to login", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(E2E_USERS.salesRep.email, E2E_PASSWORD);
    await expect(page).toHaveURL("/");

    const appShell = new AppShell(page);
    await appShell.signOut();

    await expect(page).toHaveURL("/login");
  });
});
