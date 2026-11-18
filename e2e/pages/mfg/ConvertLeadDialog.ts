import { expect, type Locator, type Page } from "@playwright/test";

/**
 * "Convert to opportunity" dialog (frontend/src/components/module/ConvertLeadDialog.tsx).
 * Native selects with ids `convert-contact-role`, `convert-account-type`, `convert-industry`, `convert-territory`;
 * GSTIN is `#convert-gstin`; existing accounts are found through `#convert-account-search` and picked from a result list.
 * Convert is disabled until the buying role and the account choice are complete, and the dialog resolves
 * duplicate-account / duplicate-contact bounces by itself (it never shows a duplicate message).
 */
export class ConvertLeadDialog {
  readonly root: Locator;
  readonly convertButton: Locator;
  /** Spec: a duplicate warning with an "Open existing" link. The shipped dialog renders none, so this never matches. */
  readonly duplicateMessage: Locator;
  constructor(readonly page: Page) {
    this.root = page.getByRole("dialog", { name: "Convert to opportunity" });
    this.convertButton = this.root.getByRole("button", { name: /^Convert$/ });
    this.duplicateMessage = page.getByText(/already exists|Open existing/i);
  }
  expectOpen = async (): Promise<void> => { await expect(this.root).toBeVisible(); };
  setContactRole = async (role: string): Promise<void> => { await this.root.locator("#convert-contact-role").selectOption(role); };
  chooseNewAccount = async (a: { type: string; industry: string; territory: string; gstin?: string }): Promise<void> => {
    await this.root.getByRole("button", { name: "New account", exact: true }).click();
    await this.root.locator("#convert-account-type").selectOption(a.type);
    await this.root.locator("#convert-industry").selectOption(a.industry);
    await this.root.locator("#convert-territory").selectOption(a.territory);
    if (a.gstin !== undefined) await this.root.locator("#convert-gstin").fill(a.gstin);
  };
  /** Searches accounts by `search` (>= 2 chars, matches name/short) and selects the result labelled `label` (default: search). */
  chooseExisting = async (search: string, label: string = search): Promise<void> => {
    await this.root.getByRole("button", { name: "Existing account", exact: true }).click();
    await this.root.locator("#convert-account-search").fill(search);
    await this.root.getByRole("button", { name: label }).first().click();
    await expect(this.root.getByText(`Selected: ${label}`)).toBeVisible();
  };
  confirm = async (): Promise<void> => { await this.convertButton.click(); };
}
