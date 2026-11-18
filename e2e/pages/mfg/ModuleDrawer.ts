import { expect, type Locator, type Page } from "@playwright/test";

export class ModuleDrawer {
  readonly error: Locator;
  readonly duplicateBanner: Locator;
  constructor(readonly page: Page) {
    // The form-level banner (message line only, not the list of field links beneath it)
    this.error = page.locator('[role=dialog] div[role=alert] > p.font-medium').first();
    this.duplicateBanner = page.getByText(/already exists/i);
  }
  /** Fields are `<Label htmlFor=key>` + `id=key`; selects are native `<select>`. */
  fill = async (values: Record<string, string | number | boolean>): Promise<void> => {
    // The account comes last: a role that cannot list accounts gets it filled in from the opportunity / asset / order picked before it.
    const rank = (k: string): number => (k === "accountId" ? 1 : /Id$/.test(k) ? 0 : 2);
    const entries = Object.entries(values).sort(([a], [b]) => rank(a) - rank(b));
    for (const [key, value] of entries) {
      const el = this.page.locator(`#${key}`);
      const tag = await el.evaluate((n) => n.tagName.toLowerCase());
      if ((await el.getAttribute("role")) === "switch") {
        // Boolean fields are switches: click only when the state differs
        if (((await el.getAttribute("aria-checked")) === "true") !== Boolean(value)) await el.click();
      } else if (tag === "select" && !(await this.hasOption(key, String(value))) && /Id$/.test(key) && key === "accountId") {
        // Roles that cannot list accounts do not get the account in the picker: the form fills it from the opportunity / asset / order picked.
        await expect(el, "account filled in from the record picked").toHaveValue(String(value), { timeout: 10_000 });
      } else if (tag === "select") {
        // Text fields with suggestions are selects ending in "Other — type your own…": a value outside the list is typed.
        const listed = await el.locator("option").evaluateAll((os, v) => os.some((o) => (o as HTMLOptionElement).value === v), String(value));
        if (!listed && (await el.locator('option[value="__other"]').count()) > 0) {
          await el.selectOption("__other");
          await this.page.locator(`#${key}`).fill(String(value));
        } else await el.selectOption(String(value));
      } else if ((await el.getAttribute("type")) === "checkbox") await el.setChecked(Boolean(value));
      else await el.fill(String(value));
      await this.page.locator(`#${key}`).blur(); // triggers the on-blur duplicate check
    }
  };
  private hasOption = async (key: string, value: string): Promise<boolean> =>
    this.page.locator(`#${key}`).locator("option").evaluateAll((os, v) => os.some((o) => (o as HTMLOptionElement).value === v), value);
  save = async (): Promise<void> => { await this.page.getByRole("button", { name: /^Save$/ }).click(); };
  openExisting = async (): Promise<void> => { await this.page.getByRole("button", { name: "Open existing" }).click(); };
}
