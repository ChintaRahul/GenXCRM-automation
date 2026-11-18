import type { Page, Locator } from "@playwright/test";

// Matches backend/.env.e2e.local (PORT=3001) — fixed for this suite, not read from the
// bundled frontend env at runtime.
const E2E_API_BASE = "http://localhost:3001/api/v1";

export class LeadsPage {
  readonly page: Page;
  readonly addLeadButton: Locator;
  readonly searchInput: Locator;
  readonly createDialog: Locator;
  readonly nameInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly sourceSelect: Locator;
  readonly createSubmitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // NOTE: the Leads page renders both a desktop table and a mobile card list in the
    // DOM simultaneously (toggled via CSS breakpoints, not conditional rendering), so
    // per-row controls exist twice with identical accessible names. `.and(page.locator
    // (':visible'))` intersects to whichever copy the current viewport actually shows
    // (`filter({ visible })` isn't a real Playwright option — TS catches that; don't
    // reintroduce it. `.locator(':visible')` alone searches descendants, not itself —
    // `.and()` is the combinator for "this same element also matches").
    this.addLeadButton = page
      .getByRole("button", { name: "Add Lead" })
      .and(page.locator(":visible"))
      .first();
    this.searchInput = page.getByPlaceholder("Search leads…");
    this.createDialog = page.getByRole("dialog").filter({ hasText: "Add New Lead" });
    this.nameInput = this.createDialog.getByPlaceholder("Rahul Sharma");
    this.phoneInput = this.createDialog.getByPlaceholder("98765 43210");
    this.emailInput = this.createDialog.getByPlaceholder("rahul@example.com");
    this.sourceSelect = this.createDialog.getByRole("combobox");
    this.createSubmitButton = this.createDialog.getByRole("button", { name: "Create Lead" });
  }

  async goto() {
    await this.page.goto("/leads");
  }

  async openCreateDialog() {
    // Org-wide WebSocket "new lead" toasts can pop up over this button at any moment
    // (unrelated to this test's own actions) — real browser hit-testing routes the
    // click to whatever's visually on top, so `force: true` alone doesn't help here.
    await this.waitForToastsClear();
    await this.addLeadButton.click();
  }

  // Wait for any active Sonner toasts to auto-dismiss (default duration ~4s) instead of
  // ripping them out of the DOM directly — removing a node React still owns crashes the
  // app with a React reconciliation error ("insertBefore ... not a child of this node").
  async waitForToastsClear() {
    await this.page
      .waitForFunction(() => document.querySelectorAll("[data-sonner-toast]").length === 0, undefined, {
        timeout: 6_000,
      })
      .catch(() => {});
  }

  async createLead(opts: { name: string; phone: string; email?: string; source: string }): Promise<string> {
    await this.openCreateDialog();
    await this.nameInput.fill(opts.name);
    await this.phoneInput.fill(opts.phone);
    if (opts.email) await this.emailInput.fill(opts.email);
    await this.sourceSelect.click();
    await this.page.getByRole("option", { name: opts.source, exact: false }).click();
    await this.waitForToastsClear();
    // The click resolves as soon as the DOM event dispatches, not once the component's
    // async submit finishes — wait for the actual POST to complete so a caller that
    // immediately navigates/reloads (e.g. waitForLeadAssigned) can't abort it in flight.
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().endsWith("/leads") && res.request().method() === "POST",
      ),
      this.createSubmitButton.click(),
    ]);
    if (!response.ok()) {
      throw new Error(`Create lead failed: ${response.status()} ${await response.text()}`);
    }
    const body = await response.json();
    return body.id as string;
  }

  viewLeadLink(leadName: string): Locator {
    return this.page.getByRole("link", { name: `View ${leadName}` }).and(this.page.locator(":visible"));
  }

  async openLead(leadName: string) {
    await this.waitForToastsClear();
    await this.viewLeadLink(leadName).click();
  }

  async search(query: string) {
    await this.searchInput.fill(query);
  }

  // Round-robin assignment runs async (BullMQ) after a lead is created, and the Leads
  // list doesn't live-refresh once assignment settles. Repeatedly reloading the whole
  // page to detect that is slow and flaky (each reload re-triggers the full SPA boot,
  // API waterfall and WS reconnect) — instead poll the API directly in-page (cheap,
  // shares the authenticated session) and only reload the UI once, at the end.
  async waitForLeadAssigned(leadId: string, timeoutMs = 20_000) {
    const assigned = await this.page
      .waitForFunction(
        async ({ id, base }) => {
          const token = localStorage.getItem("token");
          const res = await fetch(`${base}/leads/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return false;
          const lead = await res.json();
          return Boolean(lead.assignedToId);
        },
        { id: leadId, base: E2E_API_BASE },
        { timeout: timeoutMs, polling: 500 },
      )
      .catch(() => null);
    if (!assigned) throw new Error(`Lead ${leadId} was never assigned within ${timeoutMs}ms`);
    await this.page.reload();
  }
}
