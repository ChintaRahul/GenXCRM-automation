import type { Page, Locator } from "@playwright/test";

// Shared chrome present on every authenticated page: account menu, sign-out,
// and top-level navigation. Handles the desktop-sidebar vs. mobile-menu split
// so specs don't need viewport-specific logic.
export class AppShell {
  readonly page: Page;
  readonly accountMenuButton: Locator;
  readonly signOutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.accountMenuButton = page.getByRole("button", { name: "Account menu" });
    this.signOutButton = page.getByRole("menuitem", { name: "Sign Out" });
  }

  async signOut() {
    await this.accountMenuButton.click();
    await this.signOutButton.click();
  }

  async gotoLeads() {
    await this.page.goto("/leads");
  }
}
