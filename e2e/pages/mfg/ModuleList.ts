import type { Locator, Page } from "@playwright/test";
import { listUrl } from "../../mfg/routes";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class ModuleList {
  readonly searchBox: Locator;
  readonly exportButton: Locator;
  readonly columnChooser: Locator;
  constructor(readonly page: Page, readonly key: string) {
    const main = page.getByRole("main");
    this.searchBox = main.getByPlaceholder(/^search /i); // "Search <title>..."
    this.exportButton = main.getByRole("button", { name: /export/i });
    this.columnChooser = main.getByRole("button", { name: "Choose columns" });
  }
  goto = async (): Promise<void> => { await this.page.goto(listUrl(this.key)); };
  search = async (text: string): Promise<void> => {
    await this.searchBox.fill(text);
    await this.page.waitForTimeout(450); // 300ms debounce
  };
  row = (text: string): Locator => this.page.getByRole("row").filter({ hasText: text }).first();
  /** "New <singular>"; excludes the "New (n)" status pill. */
  clickNew = async (): Promise<void> => { await this.page.getByRole("button", { name: /^New [^(]/ }).click(); };
  openRow = async (text: string): Promise<void> => { await this.row(text).click(); };
  /** Status filter pill (value like "New"; the pill may carry a " (n)" count suffix). */
  statusFilter = async (value: string): Promise<void> => {
    await this.page.getByRole("button", { name: new RegExp(String.raw`^${escapeRegExp(value)}( \(\d+\))?$`) }).click();
  };
}
