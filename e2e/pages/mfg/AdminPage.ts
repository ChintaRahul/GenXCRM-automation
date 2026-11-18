import { expect, type Locator, type Page } from "@playwright/test";

/** Administration page (/administration): the tab bar plus the module-list request each Manufacturing tab makes. */
export class AdminPage {
  readonly main: Locator;
  constructor(readonly page: Page) {
    this.main = page.getByRole("main");
  }
  goto = async (): Promise<void> => {
    await this.page.goto("/administration");
    await expect(this.page.getByText("Organization settings & configuration")).toBeVisible();
  };
  tabButton = (label: string): Locator => this.page.getByRole("button", { name: label, exact: true });
  /**
   * Opens a tab. With `moduleKey` it also waits for that module's list request (GET /modules/<key>) and returns its HTTP status, which is the
   * positive "the tab finished loading" signal the absence assertions need.
   */
  openTab = async (label: string, moduleKey?: string): Promise<number | undefined> => {
    const response = moduleKey
      ? this.page.waitForResponse((r) => r.request().method() === "GET" && new RegExp(`/modules/${moduleKey}(\\?|$)`).test(r.url()))
      : undefined;
    await this.tabButton(label).click();
    return (await response)?.status();
  };
}
