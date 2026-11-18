import type { Page, Locator } from "@playwright/test";

export class LeadDetailPage {
  readonly page: Page;
  readonly markEnrolledButton: Locator;
  readonly noteTextarea: Locator;
  readonly saveNoteButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.markEnrolledButton = page.getByRole("button", { name: "Mark enrolled" });
    this.noteTextarea = page.getByPlaceholder("Add a note…");
    this.saveNoteButton = page.getByRole("button", { name: "Save" });
  }

  // Org-wide WebSocket toasts can pop up over any control at any moment — wait for them
  // to auto-dismiss (default duration ~4s) before clicking, rather than removing them
  // from the DOM directly (that fights React's own reconciliation of the same subtree
  // and crashes the app with an "insertBefore ... not a child of this node" error).
  async waitForToastsClear() {
    await this.page
      .waitForFunction(() => document.querySelectorAll("[data-sonner-toast]").length === 0, undefined, {
        timeout: 6_000,
      })
      .catch(() => {});
  }

  async markEnrolled() {
    await this.waitForToastsClear();
    await this.markEnrolledButton.click();
  }

  async addNote(text: string) {
    await this.noteTextarea.fill(text);
    await this.waitForToastsClear();
    await this.saveNoteButton.click();
  }
}
