// e2e/specs/mfg/sec.spec.ts - SEC module: tenant isolation, API authorization, field security, input handling, hierarchy (TC-SEC-001..008).
// 006 (rate limiting) and 007 (signed URLs) are skip cases with empty bodies. Org B (one Director-level admin, full seeded permissions) supplies the foreign records.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, API, ApiClient, build, isoDate, ok, TERMS, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { pdfText } from "../../mfg/pdf";
import { uniqueEmail, uniquePhone, uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
const rows = (r: ApiResult): Rec[] => (r.body.data ?? []) as Rec[];
const idsOf = (r: ApiResult): string[] => rows(r).map((x) => String(x.id));
const FAKE_ID = "00000000-0000-0000-0000-000000000000";

// ---- records created for the run, archived in afterAll (Org A and Org B) ----
const created: { api: () => Promise<ApiClient>; key: string; id: string }[] = [];
const track = (api: () => Promise<ApiClient>, key: string, id: string): string => {
  created.push({ api, key, id });
  return id;
};
const asDirector = (): Promise<ApiClient> => apiAs("director");
const asOrgB = (): Promise<ApiClient> => apiAs("orgBAdmin");
test.afterAll(async () => {
  for (const { api, key, id } of [...created].reverse()) {
    try {
      await (await api()).post(`/modules/${key}/${id}/archive`);
    } catch {
      // cleanup only
    }
  }
});

// ---- Org B data: one record per module, built once per run through Org B's own admin ----
interface OrgBData {
  ids: Record<string, string>;
  /** text that finds the record through the module's `search` (undefined: the module has no searchable text we control) */
  tags: Record<string, string | undefined>;
  accountId: string; contactId: string; opportunityId: string; quotationId: string; poId: string; salesOrderId: string; assetId: string; productId: string; leadId: string;
}
let orgBPromise: Promise<OrgBData> | undefined;
const orgBData = (): Promise<OrgBData> => {
  orgBPromise ??= (async (): Promise<OrgBData> => {
    const b = await asOrgB();
    const t = (key: string, id: string): string => track(asOrgB, key, id);
    const lead = await build.lead(b);
    t("leads", lead.id);
    const account = await build.account(b);
    t("accounts", account.id);
    const contact = await build.contact(b, account.id);
    t("contacts", contact.id);
    const opp = await build.opportunity(b, account.id);
    t("opps", opp.id);
    const rfq = await build.rfq(b, { opportunityId: opp.id, accountId: account.id });
    t("rfqs", rfq.id);
    const visit = await build.visit(b, { accountId: account.id, opportunityId: opp.id });
    t("visits", visit.id);
    const demo = await build.evaluation(b, { opportunityId: opp.id, accountId: account.id });
    t("demos", demo.id);
    const activitySubject = `${uniqueTag("BACT")} call back`;
    const activity = ok(await b.post("/modules/activities", { type: "Call", subject: activitySubject, priority: "Low", dueDate: isoDate(5), accountId: account.id }), "Org B activity");
    t("activities", String(activity.body.id));
    const product = await build.product(b);
    t("products", product.id);
    const costing = ok(await build.costing(b, { opportunityId: opp.id, accountId: account.id, material: 400_000, sellingPrice: 1_000_000 }, b), "Org B costing");
    t("costing", String(costing.body.id));
    const quote = await build.sentQuotation(b, { opportunityId: opp.id, accountId: account.id, productId: product.id });
    t("quotes", quote.id);
    const po = await build.acceptedPo(b, { opportunityId: opp.id, accountId: account.id, quotationId: quote.id });
    t("pos", po.id);
    const order = await build.salesOrderFor(b, po.id);
    t("sorders", order.id);
    const serial = uniqueTag("BSN");
    const { assetId } = await build.commissionedOrder(b, order.id, serial);
    t("assets", assetId);
    const coverage = await build.coverage(b, { assetId, accountId: account.id });
    t("amc", coverage.id);
    const ticket = await build.ticket(b, { accountId: account.id, assetId });
    t("service", ticket.id);
    const dispatch = ok(await b.post("/modules/dispatch", { salesOrderId: order.id, accountId: account.id, dispatchDate: isoDate(1) }), "Org B dispatch");
    t("dispatch", String(dispatch.body.id));
    const milestone = rows(ok(await b.get(`/modules/payments?salesOrderId=${order.id}&limit=10`), "Org B payment milestones"))[0];
    if (!milestone) throw new Error("Org B has no payment milestone for its sales order");
    t("payments", String(milestone.id));
    const approval = rows(ok(await b.get("/modules/approvals?limit=1"), "Org B approvals"))[0];
    if (!approval) throw new Error("Org B has no approval");
    const poNo = String(ok(await b.get(`/modules/pos/${po.id}`), "Org B PO").body.poNo);
    return {
      ids: {
        leads: lead.id, accounts: account.id, contacts: contact.id, activities: String(activity.body.id), opps: opp.id, rfqs: rfq.id, visits: visit.id, demos: demo.id,
        products: product.id, costing: String(costing.body.id), quotes: quote.id, approvals: String(approval.id), pos: po.id, sorders: order.id, dispatch: String(dispatch.body.id),
        payments: String(milestone.id), assets: assetId, amc: coverage.id, service: ticket.id,
      },
      tags: {
        leads: lead.company.split(" ")[0], accounts: account.name.split(" ")[0], contacts: contact.name.split(" ")[0], activities: activitySubject.split(" ")[0],
        opps: opp.title.split(" ")[0], rfqs: rfq.custNo, visits: visit.title.split(" ")[0], demos: demo.title.split(" ")[0], products: product.sku, pos: poNo, assets: serial,
      },
      accountId: account.id, contactId: contact.id, opportunityId: opp.id, quotationId: quote.id, poId: po.id, salesOrderId: order.id, assetId, productId: product.id, leadId: lead.id,
    };
  })();
  return orgBPromise;
};

// ---- Role matrix (a COPY of PERM_SPEC, same drift guard as env.spec.ts) ----
const PERM_SPEC: Record<string, string> = {
  "Sales Head": "ALL:CRUE",
  "Sales Manager": "ALL:CRUE",
  "Sales Executive":
    "leads,accounts,contacts,activities,opps,visits,demos,quotes:CRU;rfqs,products,approvals,pos,sorders,dispatch,payments,assets,amc,service,nurturing,templates:R;reports:RE",
  "Application Engineer": "rfqs,visits,demos,activities:CRU;opps,accounts,contacts,products,service,assets:R",
  "Commercial / Estimation": "costing,quotes,approvals,products:CRUDE;opps,rfqs,accounts:R;pos:CRU",
  Operations: "sorders,dispatch:RU;pos,accounts,products,assets:R",
  Accounts: "payments:RUE;sorders,pos,accounts,dispatch,billing:R;reports:RE",
  "Service Manager": "service,assets,amc:CRUDE;accounts,contacts,sorders:R",
  "Service Engineer": "service:RU;assets,amc,accounts:R",
};
const ROLE_LABEL: Partial<Record<MfgRoleKey, string>> = {
  salesExec1: "Sales Executive", appEngineer: "Application Engineer", commercial: "Commercial / Estimation", operations: "Operations", accounts: "Accounts",
  serviceManager: "Service Manager", serviceEngineer: "Service Engineer",
};
const MODULES = [
  "leads", "accounts", "contacts", "activities", "opps", "rfqs", "visits", "demos", "products", "costing", "quotes", "approvals",
  "pos", "sorders", "dispatch", "payments", "assets", "amc", "service",
];
const COSTING_UNRESTRICTED: MfgRoleKey[] = ["superAdmin", "director", "salesHead", "commercial"];
const opsFor = (role: MfgRoleKey, moduleKey: string): string => {
  const label = ROLE_LABEL[role];
  const spec = label === undefined ? undefined : PERM_SPEC[label];
  if (spec === undefined) throw new Error(`role ${role} has no entry in the SEC role matrix`);
  let ops = "";
  for (const part of spec.split(";")) {
    const [mods, o] = part.split(":");
    if (mods === "ALL" || mods?.split(",").includes(moduleKey)) ops = o ?? "";
  }
  return moduleKey === "costing" && !COSTING_UNRESTRICTED.includes(role) ? "" : ops;
};
const expectPermSpecInSync = (): void => {
  const src = readFileSync(join(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
  const body = /const PERM_SPEC[^=]*=\s*\{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
  const backend: Record<string, string> = {};
  for (const m of body.matchAll(/(?:'([^']+)'|(\w+))\s*:\s*'([^']*)'/g)) backend[m[1] ?? m[2] ?? ""] = m[3] ?? "";
  expect(Object.keys(backend).length, "could not parse backend PERM_SPEC").toBe(9);
  expect(PERM_SPEC, "role matrix drifted from backend PERM_SPEC - update sec.spec.ts").toEqual(backend);
};
const raw = (method: string, path: string, token?: string): Promise<Response> =>
  fetch(`${API}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });

// ---- SEC-001 / 002 / 003 (Super Admin and Sales Executive roles) ----
test.describe("SEC - Super Admin (tenant isolation)", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-SEC-001", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const admin = await apiAs("superAdmin");
    const director = await apiAs("director");
    const b = await orgBData();
    const orgB = await asOrgB();
    const weak: string[] = [];
    for (const key of MODULES) {
      const id = b.ids[key];
      if (!id) throw new Error(`no Org B record for ${key}`);
      // control: Org B reads its own record and finds it through the list
      expect((await orgB.get(`/modules/${key}/${id}`)).status, `Org B reads its own ${key}`).toBe(200);
      // Org A (Super Admin and Director) gets 404 for the foreign id on every module, with the module's own not-found wording
      for (const [who, client] of [["super admin", admin], ["director", director]] as [string, ApiClient][]) {
        const r = await client.get(`/modules/${key}/${id}`);
        expect(r.status, `${who}: foreign ${key} record`).toBe(404);
        expect(ApiClient.message(r), `${who}: foreign ${key} not-found message`).toMatch(/not found/i);
        // the related-records endpoint of a foreign id must not leak rows (it answers 404 or an empty page)
        const related = await client.get(`/modules/${key}/${id}/related/acts`);
        expect([200, 404], `${who}: related ${key} status`).toContain(related.status);
        if (related.status === 200) expect(rows(related), `${who}: related ${key} rows of a foreign record`).toEqual([]);
      }
      // lists never include Org B rows
      const tag = b.tags[key];
      if (tag !== undefined && idsOf(await orgB.get(`/modules/${key}?search=${encodeURIComponent(tag)}&limit=50`)).includes(id)) {
        expect(idsOf(await admin.get(`/modules/${key}?search=${encodeURIComponent(tag)}&limit=50`)), `Org A ${key} search for the Org B tag`).toEqual([]);
      } else {
        weak.push(key);
        expect(idsOf(await admin.get(`/modules/${key}?limit=100`)), `Org A ${key} list (first page) never includes the Org B row`).not.toContain(id);
      }
    }
    test.info().annotations.push({ type: "note", description: `supplementary list check limited to the first 100 rows (no search tag for: ${weak.join(", ")}); the by-id 404 for every module above is the proof of isolation` });

    // UI: an Org A user deep-linking to an Org B record and an Org B user deep-linking to an Org A record both get the not-found state
    const lead = await build.lead(admin);
    track(() => apiAs("superAdmin"), "leads", lead.id);
    const orgBCtx = await browser.newContext({ storageState: authFile("orgBAdmin"), baseURL: "http://localhost:5174" });
    try {
      const bPage = await orgBCtx.newPage();
      await bPage.goto(`/leads/${lead.id}`);
      await expect(bPage.getByText("Couldn't load this record."), "Org B user opening an Org A lead").toBeVisible({ timeout: 20_000 });
      await expect(bPage.getByText(lead.company)).toHaveCount(0);
    } finally {
      await orgBCtx.close();
    }
    await page.goto(`/leads/${b.leadId}`);
    await expect(page.getByText("Couldn't load this record."), "Org A user opening an Org B lead").toBeVisible({ timeout: 20_000 });
  });

  tc("TC-SEC-002", async () => {
    test.setTimeout(240_000);
    const admin = await apiAs("superAdmin");
    const b = await orgBData();
    // Org A records the foreign ids are mixed with
    const account = await build.account(admin);
    track(asDirector, "accounts", account.id);
    const opp = await build.opportunity(admin, account.id);
    track(asDirector, "opps", opp.id);
    const quote = await build.quotation(admin, { opportunityId: opp.id, accountId: account.id });
    track(asDirector, "quotes", quote.id);
    const lead = await build.qualifiedLead(admin);
    track(asDirector, "leads", lead.id);
    const notFound = (what: string, id: string): string => `${what} '${id}' not found in your organization.`;
    const cases: { module: string; field: string; body: Rec; message: string }[] = [
      { module: "contacts", field: "accountId", body: { name: uniqueTag("X"), phone: uniquePhone(), role: "Decision Maker", accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "opps", field: "accountId", body: { title: uniqueTag("X"), product: "Weighbridge", value: 1000, stage: "Qualified", closeDate: isoDate(30), nextAction: "c", nextActionDate: isoDate(2), accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "opps", field: "contactId", body: { title: uniqueTag("X"), product: "Weighbridge", value: 1000, stage: "Qualified", closeDate: isoDate(30), nextAction: "c", nextActionDate: isoDate(2), accountId: account.id, contactId: b.contactId }, message: notFound("Contact", b.contactId) },
      { module: "rfqs", field: "opportunityId", body: { custNo: uniqueTag("X"), receivedOn: isoDate(0), application: "x", product: "Weighbridge", qty: 1, capacity: "1 T", accountId: account.id, opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "rfqs", field: "accountId", body: { custNo: uniqueTag("X"), receivedOn: isoDate(0), application: "x", product: "Weighbridge", qty: 1, capacity: "1 T", opportunityId: opp.id, accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "visits", field: "accountId", body: { title: uniqueTag("X"), visitDate: isoDate(2), objective: "x", accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "visits", field: "opportunityId", body: { title: uniqueTag("X"), visitDate: isoDate(2), objective: "x", accountId: account.id, opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "demos", field: "opportunityId", body: { title: uniqueTag("X"), type: "Demo", product: "Weighbridge", plannedDate: isoDate(3), accountId: account.id, opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "demos", field: "accountId", body: { title: uniqueTag("X"), type: "Demo", product: "Weighbridge", plannedDate: isoDate(3), opportunityId: opp.id, accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "costing", field: "opportunityId", body: { material: 1000, sellingPrice: 2000, accountId: account.id, opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "costing", field: "accountId", body: { material: 1000, sellingPrice: 2000, opportunityId: opp.id, accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "quotes", field: "opportunityId", body: { quotationDate: isoDate(0), validUntil: isoDate(30), paymentTerms: TERMS, accountId: account.id, opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "quotes", field: "accountId", body: { quotationDate: isoDate(0), validUntil: isoDate(30), paymentTerms: TERMS, opportunityId: opp.id, accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "pos", field: "opportunityId", body: { poNo: uniqueTag("X"), poDate: isoDate(0), value: 1000, paymentTerms: TERMS, quotationId: quote.id, accountId: account.id, opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "pos", field: "quotationId", body: { poNo: uniqueTag("X"), poDate: isoDate(0), value: 1000, paymentTerms: TERMS, opportunityId: opp.id, accountId: account.id, quotationId: b.quotationId }, message: notFound("Quotation", b.quotationId) },
      { module: "pos", field: "accountId", body: { poNo: uniqueTag("X"), poDate: isoDate(0), value: 1000, paymentTerms: TERMS, opportunityId: opp.id, quotationId: quote.id, accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "sorders", field: "purchaseOrderId", body: { value: 1000, accountId: account.id, purchaseOrderId: b.poId }, message: notFound("Purchase order", b.poId) },
      { module: "sorders", field: "accountId", body: { value: 1000, accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "sorders", field: "custContactId", body: { value: 1000, accountId: account.id, custContactId: b.contactId }, message: notFound("Contact", b.contactId) },
      { module: "dispatch", field: "salesOrderId", body: { dispatchDate: isoDate(1), accountId: account.id, salesOrderId: b.salesOrderId }, message: notFound("Sales order", b.salesOrderId) },
      { module: "dispatch", field: "accountId", body: { dispatchDate: isoDate(1), salesOrderId: b.salesOrderId, accountId: b.accountId }, message: notFound("Sales order", b.salesOrderId) },
      { module: "payments", field: "salesOrderId", body: { milestone: "Advance", amount: 1000, dueDate: isoDate(5), accountId: account.id, salesOrderId: b.salesOrderId }, message: notFound("Sales order", b.salesOrderId) },
      { module: "assets", field: "accountId", body: { serial: uniqueTag("X"), model: "WB", accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "assets", field: "salesOrderId", body: { serial: uniqueTag("X"), model: "WB", accountId: account.id, salesOrderId: b.salesOrderId }, message: notFound("Sales order", b.salesOrderId) },
      { module: "amc", field: "assetId", body: { type: "AMC", start: isoDate(-10), end: isoDate(300), value: 1000, visitsIncluded: 1, visitsUsed: 0, accountId: account.id, assetId: b.assetId }, message: notFound("Installed asset", b.assetId) },
      { module: "amc", field: "accountId", body: { type: "AMC", start: isoDate(-10), end: isoDate(300), value: 1000, visitsIncluded: 1, visitsUsed: 0, assetId: b.assetId, accountId: b.accountId }, message: notFound("Installed asset", b.assetId) },
      { module: "service", field: "accountId", body: { complaintType: "Breakdown", priority: "High", description: "x", accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "service", field: "assetId", body: { complaintType: "Breakdown", priority: "High", description: "x", accountId: account.id, assetId: b.assetId }, message: notFound("Installed asset", b.assetId) },
      { module: "activities", field: "accountId", body: { type: "Call", subject: uniqueTag("X"), priority: "Low", dueDate: isoDate(3), accountId: b.accountId }, message: notFound("Account", b.accountId) },
      { module: "activities", field: "opportunityId", body: { type: "Call", subject: uniqueTag("X"), priority: "Low", dueDate: isoDate(3), opportunityId: b.opportunityId }, message: notFound("Opportunity", b.opportunityId) },
      { module: "activities", field: "contactId", body: { type: "Call", subject: uniqueTag("X"), priority: "Low", dueDate: isoDate(3), contactId: b.contactId }, message: notFound("Contact", b.contactId) },
      { module: "activities", field: "mfgLeadId", body: { type: "Call", subject: uniqueTag("X"), priority: "Low", dueDate: isoDate(3), mfgLeadId: b.leadId }, message: notFound("Lead", b.leadId) },
    ];
    for (const c of cases) {
      const r = await admin.post(`/modules/${c.module}`, c.body);
      expect(r.status, `${c.module} with a foreign ${c.field}`).toBe(400);
      expect(ApiClient.message(r), `${c.module} with a foreign ${c.field}: message`).toBe(c.message);
    }
    // a foreign product on a quotation line, and a foreign account on a lead conversion
    const line = await admin.patch(`/modules/quotes/${quote.id}`, { lines: [{ productId: b.productId, qty: 1, unitPrice: 1000, discountPct: 0 }] });
    expect(line.status, "quotation line with a foreign product").toBe(400);
    expect(ApiClient.message(line)).toBe(notFound("Product", b.productId));
    await expectActionRejected(admin, "leads", lead.id, "Convert to opportunity", { accountId: b.accountId, contactRole: "Decision Maker" }, notFound("Account", b.accountId));
    // updating one's own record to point at a foreign id is refused as well, and nothing changed
    const move = await admin.patch(`/modules/opps/${opp.id}`, { accountId: b.accountId });
    expect(move.status, "opportunity re-pointed to a foreign account").toBe(400);
    expect(ApiClient.message(move)).toBe(notFound("Account", b.accountId));
    expect((await admin.get(`/modules/opps/${opp.id}`)).body.accountId, "the opportunity still belongs to its own account").toBe(account.id);
  });
});

test.describe("SEC - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-SEC-003", async () => {
    test.setTimeout(240_000);
    expectPermSpecInSync();
    // 401 without a token (and with a bogus token) on endpoints of every kind
    const endpoints: [string, string][] = [
      ["GET", "/modules/leads"], ["GET", `/modules/leads/${FAKE_ID}`], ["POST", "/modules/leads"], ["PATCH", `/modules/leads/${FAKE_ID}`], ["POST", `/modules/leads/${FAKE_ID}/archive`],
      ["POST", `/modules/leads/${FAKE_ID}/actions`], ["GET", "/modules/leads/export"], ["GET", `/modules/quotes/${FAKE_ID}/pdf`], ["GET", `/modules/accounts/${FAKE_ID}/related/opps`],
      ["GET", "/modules/costing"], ["GET", "/modules/payments"], ["GET", "/modules/service"], ["GET", "/modules/products"], ["GET", "/modules/reports"],
      ["GET", "/notifications"], ["POST", "/notifications/read-all"], ["GET", "/mfg-dashboard/team"], ["GET", "/mfg-dashboard/my-day"], ["GET", "/auth/me"],
    ];
    for (const [method, path] of endpoints) {
      expect((await raw(method, path)).status, `${method} ${path} without a token`).toBe(401);
      expect((await raw(method, path, "not-a-real-token")).status, `${method} ${path} with a bogus token`).toBe(401);
    }
    // 403 for roles lacking the operation, on every module, with the exact message; an allowed operation passes the guard
    for (const role of ["salesExec1", "appEngineer", "commercial", "operations", "accounts", "serviceEngineer", "serviceManager"] as MfgRoleKey[]) {
      const api = await apiAs(role);
      for (const key of MODULES) {
        const ops = opsFor(role, key);
        const denied = (op: string): string => `Your role does not have '${op}' access to '${key}'.`;
        const check = (r: ApiResult, allowed: boolean, op: string, passStatus: number | number[], what: string): void => {
          if (allowed) expect([passStatus].flat(), `${role} ${what} ${key} passes the permission guard (HTTP ${r.status})`).toContain(r.status);
          else {
            expect(r.status, `${role} ${what} ${key}`).toBe(403);
            expect(ApiClient.message(r), `${role} ${what} ${key} message`).toBe(denied(op));
          }
        };
        check(await api.get(`/modules/${key}?page=1&limit=1`), ops.includes("R"), "read", 200, "list");
        check(await api.get(`/modules/${key}/${FAKE_ID}`), ops.includes("R"), "read", 404, "get");
        check(await api.post(`/modules/${key}`, {}), ops.includes("C"), "create", 400, "create");
        check(await api.patch(`/modules/${key}/${FAKE_ID}`, {}), ops.includes("U"), "update", 404, "update");
        check(await api.action(key, FAKE_ID, "Anything"), ops.includes("U"), "update", [400, 404], "action on");
        check(await api.post(`/modules/${key}/${FAKE_ID}/archive`), ops.includes("D"), "delete", 404, "archive");
      }
    }
  });

  tc("TC-SEC-004", async () => {
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const account = await build.account(sales);
    track(asDirector, "accounts", account.id);
    const opp = await build.opportunity(sales, account.id);
    track(asDirector, "opps", opp.id);
    const product = await build.product(commercial, { cost: 654_321, minPrice: 910_011 });
    track(asDirector, "products", product.id);
    const sheet = ok(await commercial.post("/modules/costing", { opportunityId: opp.id, accountId: account.id, material: 1_234_567, sellingPrice: 1_500_000 }), "create costing sheet");
    track(asDirector, "costing", String(sheet.body.id));
    ok(await commercial.action("costing", String(sheet.body.id), "Submit"), "submit costing");
    const quote = ok(await sales.post("/modules/quotes", { opportunityId: opp.id, accountId: account.id, quotationDate: isoDate(0), validUntil: isoDate(30), paymentTerms: "100% advance" }), "create quotation");
    const quoteId = String(quote.body.id);
    track(asDirector, "quotes", quoteId);
    ok(await sales.patch(`/modules/quotes/${quoteId}`, { lines: [{ productId: product.id, qty: 1, unitPrice: 1_500_000, discountPct: 0 }] }), "add quotation line");
    const SECRETS = ["654321", "910011", "1234567", "265433"];
    const costKey = /cost|margin|^gm/i;

    // controls: Commercial sees the restricted values (so the checks below are not vacuous)
    expect(ok(await commercial.get(`/modules/products/${product.id}`), "product as commercial").body).toMatchObject({ cost: 654_321, minPrice: 910_011 });

    // opportunity and quotation payloads (detail + list): no cost / margin keys with values
    const oppDetail = ok(await sales.get(`/modules/opps/${opp.id}`), "opportunity as sales").body;
    expect(oppDetail.id).toBe(opp.id);
    const quoteDetail = ok(await sales.get(`/modules/quotes/${quoteId}`), "quotation as sales").body;
    expect(quoteDetail.id).toBe(quoteId);
    const oppListed = rows(ok(await sales.get(`/modules/opps?search=${encodeURIComponent(opp.title.split(" ")[0] ?? "")}`), "opp list")).find((r) => r.id === opp.id);
    expect(oppListed, "the opportunity is listed for the sales executive").toBeDefined();
    for (const [what, body] of [["opportunity", oppDetail], ["opportunity list row", oppListed ?? {}], ["quotation", quoteDetail]] as [string, Rec][]) {
      expect(Object.keys(body).filter((k) => costKey.test(k)), `${what}: cost / margin keys`).toEqual([]);
      for (const secret of SECRETS) expect(JSON.stringify(body), `${what} contains ${secret}`).not.toContain(secret);
    }
    // product payloads: restricted values come back null (D-61: the keys themselves are still present)
    const productDetail = ok(await sales.get(`/modules/products/${product.id}`), "product as sales").body;
    const productRow = rows(ok(await sales.get(`/modules/products?search=${product.sku}`), "product list")).find((r) => r.id === product.id) ?? {};
    for (const [what, body] of [["product detail", productDetail], ["product list row", productRow]] as [string, Rec][]) {
      expect([body.cost ?? null, body.minPrice ?? null], `${what}: restricted values`).toEqual([null, null]);
      for (const secret of SECRETS) expect(JSON.stringify(body), `${what} contains ${secret}`).not.toContain(secret);
    }
    await knownDefect(test.info(), "D-61", async () => {
      expect(productDetail).not.toHaveProperty("cost");
      expect(productDetail).not.toHaveProperty("minPrice");
    });
    // costing endpoints are closed outright
    for (const path of ["/modules/costing", `/modules/costing/${String(sheet.body.id)}`, `/modules/costing/${String(sheet.body.id)}/table/breakdown`, "/modules/costing/export"]) {
      const r = await sales.get(path);
      expect(r.status, path).toBe(403);
      expect(ApiClient.message(r), path).toBe("Your role does not have 'read' access to 'costing'.");
    }
    // exports: products keeps the restricted column names but never a value (D-123); quotations / opportunities have no cost or margin column
    const exportOf = async (key: string): Promise<string> => {
      const res = await fetch(`${API}/modules/${key}/export`, { headers: { authorization: `Bearer ${sales.token}` } });
      expect(res.status, `${key} export`).toBe(200);
      return res.text();
    };
    const productsCsv = await exportOf("products");
    expect(productsCsv, "product export loaded with the product").toContain(product.sku);
    const productRowCsv = productsCsv.split("\n").find((l) => l.includes(product.sku)) ?? "";
    expect(productRowCsv, "product export row").not.toBe("");
    for (const secret of SECRETS) expect(productRowCsv, `product export row contains ${secret}`).not.toContain(secret);
    await knownDefect(test.info(), "D-123", async () => {
      expect((productsCsv.split("\n")[0] ?? "").split(","), "restricted columns absent from the export header").not.toEqual(expect.arrayContaining(["cost"]));
    });
    for (const key of ["quotes", "opps"]) {
      const csv = await exportOf(key);
      const ownRow = csv.split("\n").find((l) => l.includes(key === "quotes" ? quoteId : opp.id));
      expect(ownRow, `${key} export contains the record`).toBeDefined();
      expect(csv.split("\n")[0] ?? "", `${key} export header`).not.toMatch(costKey);
      for (const secret of SECRETS) expect(ownRow, `${key} export row contains ${secret}`).not.toContain(secret);
    }
    // quotation PDF: customer pricing only
    const res = await fetch(`${API}/modules/quotes/${quoteId}/pdf`, { headers: { authorization: `Bearer ${sales.token}` } });
    expect(res.status).toBe(200);
    const text = pdfText(Buffer.from(await res.arrayBuffer()));
    expect(text, "positive control: the PDF text was read").toContain("Grand total");
    expect(text).toContain("15,00,000");
    for (const secret of [...SECRETS, "6,54,321", "9,10,011", "12,34,567", "2,65,433"]) expect(text, `PDF contains ${secret}`).not.toContain(secret);
    expect(text).not.toMatch(/cost|margin|gross|costing/i);
  });

  tc("TC-SEC-005", async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
    const sales = await apiAs("salesExec1");
    const tag = uniqueTag("XSS");
    const PAYLOADS = [`<script>alert(1)</script>`, `"><img src=x onerror="window.__xss=1;alert(2)">`, `<svg/onload=alert(3)>`];
    const [scriptP, imgP, svgP] = PAYLOADS as [string, string, string];

    // lead company through the UI drawer, account name and activity subject through the API
    const leadCompany = `${tag} ${scriptP}`;
    const drawer = new ModuleDrawer(page);
    const leads = new ModuleList(page, "leads");
    await leads.goto();
    await expect(leads.searchBox).toBeVisible();
    await leads.clickNew();
    await drawer.fill({ company: leadCompany, contactName: imgP, phone: uniquePhone(), email: uniqueEmail(uniqueTag("XSS")), product: "Weighbridge", source: "IndiaMART" });
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && /\/modules\/leads$/.test(r.url()));
    await drawer.save();
    expect((await saved).status(), "lead with markup in its fields is accepted").toBe(201);
    const leadId = track(asDirector, "leads", String((await (await saved).json() as { id: string }).id));
    const account = ok(await sales.post("/modules/accounts", { name: `${tag} ${imgP}`, short: `${tag} ${svgP}`, type: "Customer", industry: "Cement", city: "Pune", state: "Maharashtra", territory: "West" }), "account with markup");
    const accountId = track(asDirector, "accounts", String(account.body.id));
    const activity = ok(await sales.post("/modules/activities", { type: "Call", subject: `${tag} ${scriptP}`, priority: "Low", dueDate: isoDate(3), accountId }), "activity with markup");
    const activityId = track(asDirector, "activities", String(activity.body.id));

    // stored verbatim
    expect((await sales.get(`/modules/leads/${leadId}`)).body).toMatchObject({ company: leadCompany, contactName: imgP });
    expect((await sales.get(`/modules/accounts/${accountId}`)).body).toMatchObject({ name: `${tag} ${imgP}`, short: `${tag} ${svgP}` });
    expect((await sales.get(`/modules/activities/${activityId}`)).body).toMatchObject({ subject: `${tag} ${scriptP}` });

    // rendered as text on lists and detail pages: the literal markup is visible, nothing executes, no element is injected
    const visit = async (url: string, visibleText: string): Promise<void> => {
      await page.goto(url);
      await expect(page.getByText(visibleText).first(), `${url} shows the markup as text`).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), `${url}: no handler ran`).toBeUndefined();
      await expect(page.locator('img[src="x"]'), `${url}: no injected <img>`).toHaveCount(0);
      await expect(page.locator("main svg[onload], main script"), `${url}: no injected svg / script`).toHaveCount(0);
    };
    await visit(`/leads/${leadId}`, scriptP);
    await visit(`/accounts/${accountId}`, imgP);
    await visit(`/activities/${activityId}`, scriptP);
    for (const [key, search, text] of [["leads", leadCompany, scriptP], ["accounts", tag, svgP], ["activities", tag, scriptP]] as [string, string, string][]) {
      const list = new ModuleList(page, key);
      await list.goto();
      await expect(list.searchBox).toBeVisible();
      await list.search(search.split(" ")[0] ?? search);
      await expect(page.getByRole("main").getByText(text).first(), `${key} list shows the markup as text`).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    }
    expect(dialogs, "no alert / confirm / prompt dialog was ever opened").toEqual([]);
  });

  tc("TC-SEC-006", async () => {});
  tc("TC-SEC-007", async () => {});
});

// ---- Sales Manager: 008 hierarchy ----
test.describe("SEC - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-SEC-008", async ({ browser }) => {
    test.setTimeout(180_000);
    const [rep1, rep2, manager, director, head, commercial, orgB] = await Promise.all([
      apiAs("salesExec1"), apiAs("salesExec2"), apiAs("salesManager"), apiAs("director"), apiAs("salesHead"), apiAs("commercial"), asOrgB(),
    ]);
    const tag = uniqueTag("HIE");
    // one lead / account / opportunity / quotation per rep, plus a PO raised by Commercial, plus a same-tag lead in Org B
    interface Set { lead: string; account: string; opp: string; quote: string }
    const makeSet = async (api: ApiClient, label: string): Promise<Set> => {
      const lead = await build.lead(api, { company: `${tag} ${label} Lead Ltd` });
      track(asDirector, "leads", lead.id);
      const account = await build.account(api, { name: `${tag} ${label} Acct Ltd`, short: `${tag}-${label}` });
      track(asDirector, "accounts", account.id);
      const opp = await build.opportunity(api, account.id, { title: `${tag} ${label} Opp` });
      track(asDirector, "opps", opp.id);
      const quote = await build.quotation(api, { opportunityId: opp.id, accountId: account.id });
      track(asDirector, "quotes", quote.id);
      return { lead: lead.id, account: account.id, opp: opp.id, quote: quote.id };
    };
    const s1 = await makeSet(rep1, "R1");
    const s2 = await makeSet(rep2, "R2");
    const po = await build.po(commercial, { opportunityId: s1.opp, accountId: s1.account, quotationId: s1.quote });
    track(asDirector, "pos", po.id);
    const poNo = String(ok(await commercial.get(`/modules/pos/${po.id}`), "PO").body.poNo);
    const foreign = await build.lead(orgB, { company: `${tag} OrgB Lead Ltd` });
    track(asOrgB, "leads", foreign.id);

    const seen = async (api: ApiClient, key: string, search: string): Promise<string[]> => idsOf(ok(await api.get(`/modules/${key}?search=${encodeURIComponent(search)}&limit=50`), `${key} list`));
    const modules: [string, string, string, string][] = [["leads", tag, s1.lead, s2.lead], ["accounts", tag, s1.account, s2.account], ["opps", tag, s1.opp, s2.opp], ["quotes", "", s1.quote, s2.quote]];
    for (const [key, search, id1, id2] of modules) {
      if (key === "quotes") {
        // quotations have no searchable text: read each id directly
        expect((await manager.get(`/modules/quotes/${id1}`)).status, "manager reads rep1's quotation (team)").toBe(200);
        expect((await manager.get(`/modules/quotes/${id2}`)).status, "manager reads rep2's quotation (team)").toBe(200);
        expect((await director.get(`/modules/quotes/${id1}`)).status, "director reads rep1's quotation").toBe(200);
        expect((await director.get(`/modules/quotes/${id2}`)).status, "director reads rep2's quotation").toBe(200);
        expect((await rep1.get(`/modules/quotes/${id1}`)).status, "rep1 reads own quotation").toBe(200);
        expect((await rep1.get(`/modules/quotes/${id2}`)).status, "rep1 cannot read rep2's quotation").toBe(404);
        expect((await rep2.get(`/modules/quotes/${id1}`)).status, "rep2 cannot read rep1's quotation").toBe(404);
        continue;
      }
      for (const [who, api] of [["manager", manager], ["director", director], ["sales head", head]] as [string, ApiClient][]) {
        const ids = await seen(api, key, search);
        expect(ids, `${who} sees both reps' ${key}`).toEqual(expect.arrayContaining([id1, id2]));
      }
      expect(await seen(rep1, key, search), `rep1 sees only own ${key}`).toEqual([id1]);
      expect(await seen(rep2, key, search), `rep2 sees only own ${key}`).toEqual([id2]);
      expect((await rep1.get(`/modules/${key}/${id2}`)).status, `rep1 reading rep2's ${key} record`).toBe(404);
    }
    // tenant boundary: neither the manager nor the director sees the Org B lead, Org B sees none of Org A's
    for (const [who, api] of [["manager", manager], ["director", director]] as [string, ApiClient][]) {
      expect(await seen(api, "leads", tag), `${who} does not see the Org B lead`).not.toContain(foreign.id);
    }
    expect(await seen(orgB, "leads", tag), "Org B sees only its own lead").toEqual([foreign.id]);
    // PO created by Commercial (same team): visible to the manager and the director, not to a rep who does not own it
    expect(await seen(manager, "pos", poNo), "manager sees the team's PO").toEqual([po.id]);
    expect(await seen(director, "pos", poNo), "director sees the PO").toEqual([po.id]);
    expect((await rep2.get(`/modules/pos/${po.id}`)).status, "rep2 may read purchase orders by id only when scoped to them").toBe(404);

    // UI: the manager's lead list shows both reps' leads, the rep's list only their own
    const mgrPage = await (await browser.newContext({ storageState: authFile("salesManager"), baseURL: "http://localhost:5174" })).newPage();
    try {
      const list = new ModuleList(mgrPage, "leads");
      await list.goto();
      await expect(list.searchBox).toBeVisible();
      await list.search(tag);
      await expect(list.row(`${tag} R1 Lead`)).toBeVisible();
      await expect(list.row(`${tag} R2 Lead`)).toBeVisible();
      await expect(mgrPage.getByText(`${tag} OrgB Lead`)).toHaveCount(0);
    } finally {
      await mgrPage.context().close();
    }
  });
});
