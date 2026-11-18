// e2e/specs/mfg/ast.spec.ts - Installed assets & warranty (TC-AST-001..007): asset record contents, account view, cross-module
// 'Raise service ticket' / 'Create AMC renewal' drawers, coverage statuses, and the installation-report / installation-workflow gaps.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const DAY_MS = 86_400_000;
const STATUSES = ["Under warranty", "Under AMC", "Out of coverage", "Decommissioned"];

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);
const assetOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/assets/${id}`), "read asset");
const archiveQuietly = async (key: string, ids: string[]): Promise<void> => {
  const director = await apiAs("director");
  for (const id of ids) {
    try {
      await director.post(`/modules/${key}/${id}/archive`);
    } catch {
      // cleanup only
    }
  }
};
const openAsset = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("assets", id);
  return detail;
};

test.describe("Installed assets - Service Manager", () => {
  test.use({ storageState: authFile("serviceManager") });

  tc("TC-AST-001", async ({ page }) => {
    const a = await build.asset();
    const sm = await apiAs("serviceManager");
    try {
      // the order commissioned by Operations created the asset: serial, model, account, parent order, warranty = commissioning + 1 year (D-86)
      const asset = await assetOf(sm, a.assetId);
      expect(asset).toMatchObject({ serial: a.serial, model: "Weighbridge", accountId: a.account.id, salesOrderId: a.salesOrderId, status: "Under warranty" });
      const [installed, commissioned, wStart, wEnd] = ["installedOn", "commissionedOn", "warrantyStart", "warrantyEnd"].map((k) => Date.parse(asset[k] as string));
      expect([installed, commissioned, wStart, wEnd].every((t) => !Number.isNaN(t)), "all four dates set").toBe(true);
      expect(Math.abs((wEnd as number) - (wStart as number) - 365 * DAY_MS), "warranty end = warranty start + 1 year").toBeLessThanOrEqual(DAY_MS);
      // list: the asset is found by its serial and shows serial, model, coverage status
      const list = new ModuleList(page, "assets");
      await list.goto();
      await list.search(a.serial);
      await expect(list.row(a.serial)).toBeVisible();
      await expect(list.row(a.serial)).toContainText("Weighbridge");
      await expect(list.row(a.serial)).toContainText("Under warranty");
      // detail: every spec'd field of the record
      await list.openRow(a.serial);
      await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
      const detail = new ModuleDetail(page);
      expect(await detail.statusText()).toBe("Under warranty");
      await expect(page.getByRole("heading", { name: a.serial })).toBeVisible();
      await expect(fieldValue(page, "Product / model")).toHaveText("Weighbridge");
      await expect(fieldValue(page, "Account")).toHaveText(a.account.id);
      await expect(fieldValue(page, "Parent order")).toHaveText(a.salesOrderId);
      const dateKeys: Record<string, string> = { "Installed on": "installedOn", "Commissioned on": "commissionedOn", "Warranty start": "warrantyStart", "Warranty end": "warrantyEnd" };
      for (const [label, key] of Object.entries(dateKeys)) {
        await expect(fieldValue(page, label), `${label} is filled`).toContainText(String(new Date(asset[key] as string).getUTCFullYear()));
      }
      // Spec: dates are shown as dates; the detail prints the raw ISO timestamp (D-49)
      await knownDefect(test.info(), "D-49", async () => {
        await expect(fieldValue(page, "Warranty end")).not.toHaveText(/T\d{2}:\d{2}/, { timeout: 1_000 });
      });
    } finally {
      await archiveQuietly("assets", [a.assetId]);
    }
  });

  tc("TC-AST-003", async ({ page }) => {
    const a = await build.asset();
    const description = `${uniqueTag("AST3")} scale not zeroing`;
    try {
      const detail = await openAsset(page, a.assetId);
      await detail.action("Raise service ticket");
      // the ticket drawer opens prefilled with the asset and the account
      const drawer = new ModuleDrawer(page);
      await expect(page.locator("#assetId")).toHaveValue(a.assetId);
      await expect(page.locator("#accountId")).toHaveValue(a.account.id);
      await drawer.fill({ description, complaintType: "Breakdown", priority: "High" });
      await drawer.save();
      // saved ticket links back: it is a ticket of this asset and account (read as Director, see D-102 for the Service Manager's own view)
      const director = await apiAs("director");
      await expect.poll(async () => {
        const rows = ok(await director.get(`/modules/service?assetId=${a.assetId}&limit=100`), "tickets of the asset").body.data ?? [];
        return rows.filter((t) => t.description === description).length;
      }, { message: "ticket saved from the asset action" }).toBe(1);
      const ticket = (ok(await director.get(`/modules/service?assetId=${a.assetId}&limit=100`), "tickets").body.data ?? []).find((t) => t.description === description) as Rec;
      expect(ticket).toMatchObject({ assetId: a.assetId, accountId: a.account.id, status: "Open", complaintType: "Breakdown", priority: "High" });
      await archiveQuietly("service", [ticket.id as string]);
    } finally {
      await archiveQuietly("assets", [a.assetId]);
    }
  });

  tc("TC-AST-004", async ({ page }) => {
    const a = await build.asset();
    const sm = await apiAs("serviceManager");
    try {
      const detail = await openAsset(page, a.assetId);
      await detail.action("Create AMC renewal");
      // the coverage drawer opens prefilled with the asset and the account
      const drawer = new ModuleDrawer(page);
      await expect(page.locator("#assetId")).toHaveValue(a.assetId);
      await expect(page.locator("#accountId")).toHaveValue(a.account.id);
      const day = (n: number): string => new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);
      await drawer.fill({ type: "AMC", start: day(0), end: day(365) });
      await drawer.save();
      const coverages = async (): Promise<Rec[]> => ok(await sm.get(`/modules/assets/${a.assetId}/related/coverage`), "coverages of the asset").body.data ?? [];
      await expect.poll(async () => (await coverages()).length, { message: "coverage saved from the asset action" }).toBe(1);
      const cov = (await coverages())[0] as Rec;
      expect(cov).toMatchObject({ assetId: a.assetId, accountId: a.account.id, type: "AMC", status: "Not due" });
      await archiveQuietly("amc", [cov.id as string]);
    } finally {
      await archiveQuietly("assets", [a.assetId]);
    }
  });

  tc("TC-AST-005", async ({ page }) => {
    const a = await build.asset();
    const sm = await apiAs("serviceManager");
    try {
      // Spec: Under warranty / Under AMC / Out of coverage / Decommissioned are selectable. UpdateInstalledAssetDto has no `status` property, so the
      // API refuses every status edit with 400 (D-103); the asset keeps the status it was created with.
      const refused = await sm.patch(`/modules/assets/${a.assetId}`, { status: "Out of coverage" });
      if (refused.status !== 200) expect([refused.status, JSON.stringify(refused.body.message)], "current: status edits are refused (remove with D-103)").toEqual([400, expect.stringContaining("property status should not exist")]);
      expect((await assetOf(sm, a.assetId)).status).toBe(refused.status === 200 ? "Out of coverage" : "Under warranty");
      await knownDefect(test.info(), "D-103", async () => {
        expect(refused.status, "PATCH status Out of coverage").toBe(200);
      });
      // UI: the edit drawer is open (positive signal: the serial field) and should offer the four statuses
      const detail = await openAsset(page, a.assetId);
      await detail.action("Edit");
      await expect(page.locator("#serial")).toBeVisible();
      await knownDefect(test.info(), "D-103", async () => {
        const field = page.locator("#status");
        await expect(field).toBeVisible({ timeout: 1_000 });
        const options = await field.evaluate((n) => (n instanceof HTMLSelectElement ? Array.from(n.options).map((o) => o.value) : []));
        expect(options.filter((o) => o !== "")).toEqual(STATUSES);
      });
      // Case note: no automatic transition when the warranty ends. An asset whose warranty ended yesterday keeps its status.
      const before = (await assetOf(sm, a.assetId)).status;
      ok(await sm.patch(`/modules/assets/${a.assetId}`, { warrantyEnd: new Date(Date.now() - DAY_MS).toISOString() }), "end the warranty yesterday");
      expect((await assetOf(sm, a.assetId)).status, "status is not derived from the warranty end (no automatic transition exists)").toBe(before);
    } finally {
      await archiveQuietly("assets", [a.assetId]);
    }
  });

  tc("TC-AST-006", async () => {
    // GAP (spec: generate an installation / commissioning report). Preconditions with plain errors: a commissioned order and its asset exist.
    const a = await build.asset();
    try {
      const sm = await apiAs("serviceManager");
      const asset = await assetOf(sm, a.assetId);
      if (asset.status !== "Under warranty") throw new Error(`precondition: asset of the commissioned order is '${String(asset.status)}'`);
      const installations = await sm.get("/modules/installations");
      // the spec-correct check: an installation module exists (it answers 404 'Module is not available')
      expect(installations.status, "GET /modules/installations").toBe(200);
    } finally {
      await archiveQuietly("assets", [a.assetId]);
    }
  });

  // TC-AST-002 and TC-AST-007 run under other roles (below)
});

test.describe("Installed assets - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-AST-002", async ({ page }) => {
    const own = await build.asset();
    const control = await build.asset();
    try {
      // the account detail's Installed assets tab lists this account's asset and not the other account's
      await page.goto(`/accounts/${own.account.id}`);
      const detail = new ModuleDetail(page);
      await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
      await detail.tab("Installed assets");
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByText(own.serial)).toBeVisible();
      await expect(panel.getByText(control.serial), "other account's asset is not listed").toHaveCount(0);
      // API mirror of the tab for both accounts
      const director = await apiAs("director");
      const ids = async (accountId: string): Promise<string[]> => (ok(await director.get(`/modules/accounts/${accountId}/related/assets`), "account assets").body.data ?? []).map((x) => x.id as string);
      expect(await ids(own.account.id)).toEqual([own.assetId]);
      expect(await ids(control.account.id)).toEqual([control.assetId]);
      // clicking the row opens the asset, which has a Service history tab
      await panel.getByText(own.serial).click();
      await expect(page).toHaveURL(new RegExp(`/installed-assets/${own.assetId}$`));
      await expect(page.getByRole("tab", { name: "Service history" })).toBeVisible();
      await page.getByRole("tab", { name: "Service history" }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
    } finally {
      await archiveQuietly("assets", [own.assetId, control.assetId]);
    }
  });
});

test.describe("Installed assets - Operations", () => {
  test.use({ storageState: authFile("operations") });

  tc("TC-AST-007", async () => {
    // GAP (spec: installation entity with Planned / In progress / Installed / Pending sign-off / Closed statuses and a sign-off reminder).
    // Preconditions with plain errors: an order in Installation exists (Operations commissions it).
    const a = await build.asset();
    try {
      const operations = await apiAs("operations");
      const asset = await assetOf(operations, a.assetId);
      if (asset.salesOrderId !== a.salesOrderId) throw new Error("precondition: asset is not linked to the commissioned order");
      const installations = await operations.get("/modules/installations");
      expect(installations.status, "GET /modules/installations").toBe(200);
    } finally {
      await archiveQuietly("assets", [a.assetId]);
    }
  });
});
