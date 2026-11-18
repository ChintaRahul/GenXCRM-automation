import { expect, type Locator, type Page } from "@playwright/test";
import { detailUrl } from "../../mfg/routes";

export class ModuleDetail {
  constructor(readonly page: Page) {}
  goto = async (key: string, id: string): Promise<void> => {
    await this.page.goto(detailUrl(key, id));
    // "Loading…" is absent before first render, so wait for the loaded header button instead
    await expect(this.moreMenu).toBeVisible({ timeout: 20_000 });
  };
  /** The "⋯" button: only the main + one secondary action are header buttons, the rest (and Archive) live in this menu. */
  get moreMenu(): Locator { return this.page.getByRole("button", { name: "More actions", exact: true }); }
  private button = (label: string): Locator => this.page.getByRole("button", { name: label, exact: true });
  /** Locator for an action: the header button, or (after opening the ⋯ menu) its menu item. */
  private reveal = async (label: string): Promise<Locator> => {
    if (await this.button(label).first().isVisible()) return this.button(label).first();
    if (await this.moreMenu.isVisible()) await this.moreMenu.click();
    return this.button(label).first();
  };
  /** Retries because the page can re-render (and close the ⋯ menu) between opening it and clicking the item. */
  action = async (label: string): Promise<void> => {
    await expect(async () => { await (await this.reveal(label)).click({ timeout: 4_000 }); }).toPass({ timeout: 20_000 });
  };
  /** True when the action is offered (as a header button or in the ⋯ menu). */
  hasAction = async (label: string): Promise<boolean> => {
    if (await this.button(label).first().isVisible()) return true;
    if (!(await this.moreMenu.isVisible())) return false;
    await this.moreMenu.click();
    const found = await this.button(label).first().isVisible();
    await this.page.keyboard.press("Escape");
    return found;
  };
  expectAction = async (label: string): Promise<void> => {
    await expect(async () => { expect(await this.hasAction(label)).toBe(true); }).toPass({ timeout: 10_000 });
  };
  /** Fill the ActionDialog (#action-ask-field: native select or textarea) and click Confirm. */
  answerPrompt = async (value: string): Promise<void> => {
    const field = this.page.locator("#action-ask-field");
    await field.waitFor();
    if ((await field.evaluate((n) => n.tagName.toLowerCase())) === "select") await field.selectOption(value);
    else await field.fill(value);
    await this.page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  };
  tab = async (label: string): Promise<void> => { await this.page.getByRole("tab", { name: label }).click(); };
  /** True when a flow module's status is outside its flow (e.g. a Disqualified lead): the bar shows no active step. */
  isOutOfFlow = async (): Promise<boolean> => {
    const bar = this.page.getByTestId("status-progress-bar");
    return (await bar.count()) > 0 && (await bar.locator('[data-testid="status-step"][data-current="true"]').count()) === 0;
  };
  /**
   * Current status text. Flow modules: label of the progress-bar step marked data-current. Flow-less modules: the
   * status badge text. Throws if a flow module is out of flow (no status text exists in the UI then) - use
   * isOutOfFlow() and assert the status through the API instead.
   */
  statusText = async (): Promise<string> => {
    // After an action the detail page can briefly re-render without any status element (refetch): wait for one to be visible, and keep the reads
    // short so a transient miss throws (expect.poll retries) instead of blocking on a badge that does not exist for a flow module.
    const bar = this.page.getByTestId("status-progress-bar");
    const badge = this.page.getByTestId("status-badge");
    await bar.or(badge).first().waitFor({ state: "visible", timeout: 10_000 });
    if (await bar.count()) {
      if (await this.isOutOfFlow()) throw new Error("statusText(): status is outside the module flow, no step is current; use isOutOfFlow()");
      // the step's label is the last span (after the connector lines and the numbered circle)
      return (await this.page.locator('[data-testid="status-step"][data-current="true"] span').last().innerText({ timeout: 3_000 })).trim();
    }
    return (await badge.innerText({ timeout: 3_000 })).trim();
  };
  expectNoAction = async (label: string): Promise<void> => {
    await expect(async () => { expect(await this.hasAction(label)).toBe(false); }).toPass({ timeout: 5_000 });
  };
  archive = async (): Promise<void> => {
    await this.moreMenu.click();
    await this.page.getByRole("button", { name: "Archive", exact: true }).click();
    await this.page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  };
}
