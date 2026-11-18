// e2e/specs/mfg/prd.spec.ts - Product / SKU master (TC-PRD-001..006): create, hierarchy, specification attributes, restricted fields, inactive, archive.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { pdfText } from "../../mfg/pdf";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
type Attr = { name: string; value: string };

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const productOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/products/${id}`), "read product");
const DETAIL_RE = /\/products\/[0-9a-f-]{36}$/;
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const listIds = async (api: ApiClient, query: string): Promise<string[]> =>
  (ok(await api.get(`/modules/products?limit=100&${query}`), "list products").body.data ?? []).map((p) => p.id as string);

/** A draft quotation (by Commercial, on an opportunity of the sales executive) with one line for `productId`. */
const quoteWithLine = async (productId: string) => {
  const sales = await apiAs("salesExec1");
  const commercial = await apiAs("commercial");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const quote = await build.quotation(commercial, { opportunityId: opp.id, accountId: account.id, productId });
  return { commercial, sales, account, opp, quoteId: quote.id };
};
const quotePdf = async (api: ApiClient, quoteId: string): Promise<string> => {
  const res = await fetch(`http://localhost:3001/api/v1/modules/quotes/${quoteId}/pdf`, { headers: { authorization: `Bearer ${api.token}` } });
  expect(res.status, "quotation PDF").toBe(200);
  const text = pdfText(Buffer.from(await res.arrayBuffer()));
  expect(text, "the PDF text was extracted").toContain("Grand total");
  return text;
};

test.describe("Products - Commercial", () => {
  test.use({ storageState: authFile("commercial") });

  tc("TC-PRD-001", async ({ page }) => {
    test.slow(); // cold stack
    const commercial = await apiAs("commercial");
    const t = uniqueTag("PRD1");
    const fields = {
      category: "Weighbridges", family: "Pitless WB", model: `${t}-80T`, sku: t, uom: "Nos", hsn: "84231000", gstRate: "18", price: 1_250_000,
      leadTime: "6 weeks", warrantyMonths: 24,
    };
    const list = new ModuleList(page, "products");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    await drawer.fill(fields);
    await drawer.save();
    await expect(drawer.error.or(page.getByRole("button", { name: "More actions", exact: true }))).toBeVisible({ timeout: 15_000 });
    // Spec: price and warranty are saved from the form. Money / number fields are posted as strings and the API rejects them (D-6).
    await expect(page).toHaveURL(DETAIL_RE, { timeout: 1_000 });
    let id: string;
    if (DETAIL_RE.test(page.url())) {
      id = idFromUrl(page);
    } else {
      await expect(drawer.error).toHaveText("Couldn't save — please try again.");
      id = rec(await commercial.post("/modules/products", fields), "create the same product through the API").id as string;
    }
    const product = await productOf(commercial, id);
    expect(product).toMatchObject({ ...fields, status: "Active" });
    // visible in the list
    await list.goto();
    await list.search(t);
    await expect(list.row(t)).toBeVisible();
    await expect(list.row(t)).toContainText("Weighbridges");
    await expect(list.row(t)).toContainText("6 weeks");
    // usable on a quotation: the line accepts the product and the customer document shows its model
    const { quoteId } = await quoteWithLine(id);
    expect(await quotePdf(commercial, quoteId)).toContain(fields.model);
    // Spec: the product is offered in the quotation product picker. The Line items tab has no picker: Product ID is a raw text box
    // (D-53; the same pattern as D-31).
    const detail = new ModuleDetail(page);
    await detail.goto("quotes", quoteId);
    await detail.tab("Line items");
    await page.getByRole("button", { name: "+ Add row" }).click();
    await expect(page.getByRole("tabpanel").getByRole("textbox").first()).toBeVisible(); // the new row's inputs are there
    await expect(page.getByRole("tabpanel").getByRole("combobox").first()).toBeVisible({ timeout: 1_000 });
  });

  tc("TC-PRD-002", async ({ page }) => {
    const commercial = await apiAs("commercial");
    const t = uniqueTag("PRD2");
    const hierarchy = [
      { category: "Weighbridges", family: "Pitless WB" },
      { category: "Belt weighers", family: "Belt scale" },
      { category: "Components", family: "Load cells" },
      { category: "Services", family: "Calibration" },
    ];
    const made: { id: string; category: string; family: string; model: string; sku: string }[] = [];
    for (const [i, h] of hierarchy.entries()) {
      const model = `${t}-M${i}`;
      const sku = `${t}-S${i}`;
      const r = rec(await commercial.post("/modules/products", { ...h, model, sku, price: 100_000 + i }), `create ${h.category} product`);
      made.push({ id: r.id as string, ...h, model, sku });
    }
    // list: every product carries its Category, Family (under the model) and SKU
    const list = new ModuleList(page, "products");
    await list.goto();
    await list.search(t);
    for (const m of made) {
      const row = list.row(m.sku);
      await expect(row).toBeVisible();
      await expect(row).toContainText(m.category);
      await expect(row).toContainText(m.family);
      await expect(row).toContainText(m.model);
    }
    // detail: the Hierarchy section shows Category -> Family -> Model -> SKU
    const detail = new ModuleDetail(page);
    const target = made[2]!;
    await detail.goto("products", target.id);
    const panel = page.getByRole("tabpanel");
    for (const value of [target.category, target.family, target.sku]) await expect(panel.getByText(value, { exact: true })).toBeVisible();
    await expect(page.getByText(target.model, { exact: true }).first()).toBeVisible(); // the model is the record's title
    // Spec: the hierarchy is reflected in list filters. Only search and Status filter the list (the API ignores ?category=, the UI has no category control).
    const all = await listIds(commercial, `search=${t}`);
    expect([...all].sort()).toEqual(made.map((m) => m.id).sort()); // loaded: all four products, search finds them
    await knownDefect(test.info(), "D-54", async () => {
      expect(await listIds(commercial, `search=${t}&category=Components`), "products of category Components").toEqual([target.id]);
    });
    // the filters that do exist work: status (control)
    ok(await commercial.action("products", made[0]!.id, "Deactivate"), "deactivate");
    expect((await listIds(commercial, `search=${t}&status=Inactive`))).toEqual([made[0]!.id]);
    expect([...(await listIds(commercial, `search=${t}&status=Active`))].sort()).toEqual(made.slice(1).map((m) => m.id).sort());
  });

  tc("TC-PRD-003", async ({ page }) => {
    const commercial = await apiAs("commercial");
    const product = await build.product(commercial);
    const control = await build.product(commercial); // another product whose attributes must stay untouched
    ok(await commercial.patch(`/modules/products/${control.id}`, { attrs: [{ name: "Capacity", value: "30 T" }] }), "control attribute");
    const detail = new ModuleDetail(page);
    await detail.goto("products", product.id);
    await detail.tab("Specification attributes");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("button", { name: "+ Add row" })).toBeVisible(); // tab loaded, no attribute yet
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    // add two attributes
    await panel.getByRole("button", { name: "+ Add row" }).click();
    await panel.getByRole("button", { name: "+ Add row" }).click();
    const boxes = panel.getByRole("textbox");
    await boxes.nth(0).fill("Capacity");
    await boxes.nth(1).fill("60 T");
    await boxes.nth(2).fill("Platform");
    await boxes.nth(3).fill("Steel deck 18 m");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await productOf(commercial, product.id)).attrs).toEqual([{ name: "Capacity", value: "60 T" }, { name: "Platform", value: "Steel deck 18 m" }]);
    // shown again after a reload
    await page.reload();
    await detail.tab("Specification attributes");
    await expect(panel.getByRole("textbox")).toHaveCount(4);
    await expect(panel.getByRole("textbox").nth(1)).toHaveValue("60 T");
    await expect(panel.getByRole("textbox").nth(3)).toHaveValue("Steel deck 18 m");
    // edit one value and remove the other row
    await panel.getByRole("textbox").nth(1).fill("80 T");
    await panel.getByRole("button", { name: "Remove row" }).nth(1).click();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await productOf(commercial, product.id)).attrs).toEqual([{ name: "Capacity", value: "80 T" }]);
    // attributes are per product
    expect((await productOf(commercial, control.id)).attrs).toEqual([{ name: "Capacity", value: "30 T" }] satisfies Attr[]);
  });

  tc("TC-PRD-005", async ({ page }) => {
    const commercial = await apiAs("commercial");
    const product = await build.product(commercial);
    const model = (await productOf(commercial, product.id)).model as string;
    // a historical quotation that already carries the product
    const old = await quoteWithLine(product.id);
    const detail = new ModuleDetail(page);
    await detail.goto("products", product.id);
    expect(await detail.statusText()).toBe("Active");
    await detail.action("Deactivate");
    await expect.poll(() => detail.statusText()).toBe("Inactive");
    expect((await productOf(commercial, product.id)).status).toBe("Inactive");
    await detail.expectAction("Activate");
    // status filter: the inactive product leaves the Active list but stays in the Inactive one (control: an active product stays)
    const active = await build.product(commercial);
    expect(await listIds(commercial, `search=${product.sku}&status=Inactive`)).toEqual([product.id]);
    expect(await listIds(commercial, `search=${product.sku}&status=Active`)).toEqual([]);
    expect(await listIds(commercial, `search=${active.sku}&status=Active`)).toEqual([active.id]);
    // historical record: the old quotation still lists the inactive product
    expect(await quotePdf(commercial, old.quoteId), "historical quotation").toContain(model);
    // Spec: an inactive product is not selectable on a new quotation. There is no picker (D-53) and the line API takes any product of the
    // org, active or not.
    const fresh = await quoteWithLine(active.id);
    const attempt = await commercial.patch(`/modules/quotes/${fresh.quoteId}`, { lines: [{ productId: product.id, qty: 1, unitPrice: 1_000_000, discountPct: 0 }] });
    if (attempt.status !== 400) expect(attempt.status, "inactive product on a new quotation line (current behaviour)").toBe(200);
    await knownDefect(test.info(), "D-55", async () => {
      expect(attempt.status, "inactive product on a new quotation line").toBe(400);
    });
    // reactivating makes it available again (control)
    await detail.action("Activate");
    await expect.poll(() => detail.statusText()).toBe("Active");
  });

  tc("TC-PRD-006", async ({ page }) => {
    const commercial = await apiAs("commercial");
    const product = await build.product(commercial);
    const control = await build.product(commercial);
    const model = (await productOf(commercial, product.id)).model as string;
    const old = await quoteWithLine(product.id);
    const list = new ModuleList(page, "products");
    await list.goto();
    await list.search(product.sku);
    await expect(list.row(product.sku)).toBeVisible();
    const detail = new ModuleDetail(page);
    await detail.goto("products", product.id);
    await detail.archive();
    // the page stays on the (now stale) detail: poll the API for the archive
    await expect.poll(async () => (await commercial.get(`/modules/products/${product.id}`)).status).toBe(404);
    // soft-deleted: gone from reads and lists, the control product is untouched
    expect(await listIds(commercial, `search=${product.sku}`)).toEqual([]);
    expect((await productOf(commercial, control.id)).id).toBe(control.id);
    expect(await listIds(commercial, `search=${control.sku}`)).toEqual([control.id]);
    await list.goto();
    await list.search(product.sku);
    await expect(page.getByText(/No products match/)).toBeVisible();
    // historical quotation unaffected: it still opens and its PDF still lists the product
    expect((await commercial.get(`/modules/quotes/${old.quoteId}`)).status).toBe(200);
    expect(await quotePdf(commercial, old.quoteId), "historical quotation").toContain(model);
  });
});

test.describe("Products - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-PRD-004", async ({ page }) => {
    const commercial = await apiAs("commercial");
    const sales = await apiAs("salesExec1");
    const product = await build.product(commercial, { cost: 543_217, minPrice: 910_011 });
    // control: Commercial sees both
    expect(await productOf(commercial, product.id)).toMatchObject({ cost: 543_217, minPrice: 910_011 });
    // API: the standard price is visible; standard cost and minimum price never carry a value (null today, spec: the keys are absent, D-61)
    const own = await productOf(sales, product.id);
    expect(own).toMatchObject({ id: product.id, price: 1_000_000 });
    expect([own.cost ?? null, own.minPrice ?? null], "restricted values on the detail").toEqual([null, null]);
    const listed = (ok(await sales.get(`/modules/products?search=${product.sku}`), "list products").body.data ?? []).find((p) => p.id === product.id);
    expect(listed, "the product is listed").toBeDefined();
    expect(listed).toMatchObject({ price: 1_000_000 });
    expect([listed?.cost ?? null, listed?.minPrice ?? null], "restricted values in the list").toEqual([null, null]);
    await knownDefect(test.info(), "D-61", async () => {
      for (const body of [own, listed ?? {}]) {
        expect(body).not.toHaveProperty("cost");
        expect(body).not.toHaveProperty("minPrice");
      }
    });
    // export: the row is there with price but without cost / minimum price
    const res = await fetch("http://localhost:3001/api/v1/modules/products/export", { headers: { authorization: `Bearer ${sales.token}` } });
    expect(res.status).toBe(200);
    const csv = (await res.text()).split("\n");
    const header = (csv[0] ?? "").split(",");
    const row = csv.find((l) => l.includes(product.sku));
    expect(row, "export contains the product").toBeDefined();
    expect(row).toContain("1000000");
    expect(row).not.toContain("543217");
    expect(row).not.toContain("910011");
    const cells = (row ?? "").split(",");
    expect([cells[header.indexOf("cost")], cells[header.indexOf("minPrice")]]).toEqual(["", ""]);
    // UI: list and detail show the price, never the restricted values
    const list = new ModuleList(page, "products");
    await list.goto();
    await list.search(product.sku);
    await expect(list.row(product.sku)).toBeVisible();
    await expect(list.row(product.sku)).toContainText("₹10.0 L");
    await expect(list.row(product.sku)).not.toContainText(/₹5\.4 L|₹9\.1 L|\b543,?217\b|\b910,?011\b/);
    const detail = new ModuleDetail(page);
    await detail.goto("products", product.id);
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Standard price")).toBeVisible();
    await expect(panel).toContainText("₹10.0 L");
    await expect(page.getByText(/₹5\.4 L|₹9\.1 L|\b543,?217\b|\b910,?011\b/)).toHaveCount(0);
    // Spec: the restricted fields are absent from the UI. The detail still renders their labels, with a "—" as if the value were unset (D-56).
    await knownDefect(test.info(), "D-56", async () => {
      await expect(panel.getByText("Standard cost")).toHaveCount(0, { timeout: 1_000 });
      await expect(panel.getByText("Minimum selling price")).toHaveCount(0, { timeout: 1_000 });
    });
  });
});
