// e2e/mfg/api.ts
import { MFG_PASSWORD, MFG_USERS, type MfgRoleKey } from "../fixtures/mfgUsers";
import { backdateActivity } from "./db";
import { uniqueEmail, uniqueGstin, uniquePhone, uniqueTag } from "./tag";

export const API = "http://localhost:3001/api/v1";
export interface ApiResult { status: number; body: Record<string, unknown> & { data?: Record<string, unknown>[] } }
type Json = Record<string, unknown>;

export class ApiClient {
  /** `role` is set by apiAs only: such a client re-logs in once and retries once on a 401 (expired token in a long run). Clients built without a role never retry. */
  constructor(public token: string, private readonly role?: MfgRoleKey) {}
  private async call(method: string, path: string, body?: Json, retried = false): Promise<ApiResult> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && this.role && !retried) {
      cache.delete(this.role);
      this.token = await login(this.role);
      return this.call(method, path, body, true);
    }
    const text = await res.text();
    const parsed = text.startsWith("{") || text.startsWith("[") ? (JSON.parse(text) as ApiResult["body"]) : { raw: text };
    return { status: res.status, body: parsed };
  }
  get = (path: string) => this.call("GET", path);
  post = (path: string, body?: Json) => this.call("POST", path, body ?? {});
  patch = (path: string, body: Json) => this.call("PATCH", path, body);
  /** Flat payload: { action, ...payload } — see modules.controller performAction. */
  action = (moduleKey: string, id: string, action: string, payload: Json = {}) =>
    this.call("POST", `/modules/${moduleKey}/${id}/actions`, { action, ...payload });
  /** Server message of a rejected call: body.message.message (Nest wraps it) or body.message. */
  static message = (r: ApiResult): string => {
    const m = r.body.message as unknown;
    return typeof m === "string" ? m : ((m as { message?: unknown } | undefined)?.message as string | undefined) ?? "";
  };
}

const cache = new Map<MfgRoleKey, ApiClient>();
const login = async (role: MfgRoleKey): Promise<string> => {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MFG_USERS[role].email, password: MFG_PASSWORD }),
  });
  const { token } = (await res.json()) as { token?: string };
  if (!token) throw new Error(`API login failed for ${role} (HTTP ${res.status})`);
  return token;
};
export const apiAs = async (role: MfgRoleKey): Promise<ApiClient> => {
  const hit = cache.get(role);
  if (hit) return hit;
  const client = new ApiClient(await login(role), role);
  cache.set(role, client);
  return client;
};

export const ok = (r: ApiResult, what: string): ApiResult => {
  if (r.status >= 400) throw new Error(`${what} failed: HTTP ${r.status} ${ApiClient.message(r)}`);
  return r;
};
export const idOf = (r: ApiResult, what: string): string => {
  const id = ok(r, what).body.id;
  if (typeof id !== "string") throw new Error(`${what}: no id in response`);
  return id;
};
export const isoDate = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

export const TERMS = "30% advance, 60% before dispatch, 10% after installation";

type QuoteOpts = { opportunityId: string; accountId: string; productId?: string; discountPct?: number; paymentTerms?: string; validDays?: number };
type PoOpts = { opportunityId: string; accountId: string; quotationId: string; value?: number; paymentTerms?: string };
export interface Lead { id: string; company: string; phone: string; email: string }

const approvedOpps = new Set<string>();

export const build = {
  lead: async (api: ApiClient, over: Json = {}) => {
    const t = uniqueTag("LEAD");
    const r = ok(await api.post("/modules/leads", {
      company: `${t} Steel Pvt Ltd`, contactName: "Buyer E2E", phone: uniquePhone(), email: uniqueEmail(t),
      product: "Weighbridge", source: "IndiaMART", value: 2_500_000, ...over,
    }), "create lead");
    return { id: r.body.id as string, company: r.body.company as string, phone: r.body.phone as string, email: r.body.email as string };
  },
  qualifiedLead: async (api: ApiClient, over: Json = {}): Promise<Lead> => {
    const lead = await build.lead(api, over);
    ok(await api.action("leads", lead.id, "Mark contacted"), "mark contacted");
    // Qualify needs Budget, Authority, Need and Timeline captured first.
    ok(await api.patch(`/modules/leads/${lead.id}`, { qBudget: "Approved", qAuth: "Decision maker engaged", qNeed: "Critical", qTime: "This quarter" }), "capture BANT");
    ok(await api.action("leads", lead.id, "Qualify"), "qualify");
    return lead;
  },
  account: async (api: ApiClient, over: Json = {}) => {
    const t = uniqueTag("ACC");
    const r = ok(await api.post("/modules/accounts", {
      name: `${t} Cement Ltd`, short: t, type: "Customer", industry: "Cement", city: "Pune", state: "Maharashtra",
      territory: "West", gstin: uniqueGstin(), ...over,
    }), "create account");
    return { id: r.body.id as string, name: r.body.name as string };
  },
  contact: async (api: ApiClient, accountId: string, over: Json = {}) => {
    const t = uniqueTag("CON");
    const r = ok(await api.post("/modules/contacts", {
      accountId, name: `${t} Contact`, phone: uniquePhone(), email: uniqueEmail(t), role: "Decision Maker", ...over,
    }), "create contact");
    return { id: r.body.id as string, name: r.body.name as string };
  },
  opportunity: async (api: ApiClient, accountId: string, over: Json = {}) => {
    const t = uniqueTag("OPP");
    const r = ok(await api.post("/modules/opps", {
      title: `${t} Weighbridge`, accountId, product: "Weighbridge", value: 1_000_000, stage: "Qualified",
      closeDate: isoDate(60), nextAction: "Call customer", nextActionDate: isoDate(3), ...over,
    }), "create opportunity");
    return { id: r.body.id as string, title: r.body.title as string };
  },
  /** RFQ (status Received); the caller becomes the technical owner unless `ownerId` is given. */
  rfq: async (api: ApiClient, o: { opportunityId: string; accountId: string }, over: Json = {}) => {
    const custNo = uniqueTag("RFQ");
    const r = ok(await api.post("/modules/rfqs", {
      custNo, opportunityId: o.opportunityId, accountId: o.accountId, receivedOn: isoDate(0),
      application: "Truck weighing at the plant gate", product: "Weighbridge", qty: 1, capacity: "60 T", ...over,
    }), "create RFQ");
    return { id: r.body.id as string, custNo };
  },
  /** An RFQ taken all the way to "Approved for costing" by `engineer` (default: the Application Engineer): costing is gated on it. */
  approvedRfq: async (o: { opportunityId: string; accountId: string }, engineer?: ApiClient) => {
    const api = engineer ?? (await apiAs("appEngineer"));
    const rfq = await build.rfq(api, o);
    ok(await api.action("rfqs", rfq.id, "Mark feasible"), "mark feasible");
    ok(await api.action("rfqs", rfq.id, "Approve for costing"), "approve for costing");
    return rfq;
  },
  /** Creates a costing sheet the way a user can: after the opportunity's RFQ is approved for costing (done here once per opportunity). */
  costing: async (api: ApiClient, body: Json, engineer?: ApiClient): Promise<ApiResult> => {
    const opportunityId = body.opportunityId as string | undefined;
    const accountId = body.accountId as string | undefined;
    if (opportunityId && accountId && !approvedOpps.has(opportunityId)) {
      await build.approvedRfq({ opportunityId, accountId }, engineer);
      approvedOpps.add(opportunityId);
    }
    return api.post("/modules/costing", body);
  },
  /** Activity; a due date in the past is created for today and then back-dated in the database (the API refuses past dates). */
  activity: async (api: ApiClient, body: Json): Promise<ApiResult> => {
    const due = typeof body.dueDate === "string" ? body.dueDate : undefined;
    if (!due || due.slice(0, 10) >= new Date().toISOString().slice(0, 10)) return api.post("/modules/activities", body);
    const r = await api.post("/modules/activities", { ...body, dueDate: isoDate(0) });
    if (r.status === 201 && typeof r.body.id === "string") await backdateActivity(r.body.id, due);
    return r;
  },
  /** A plant on an account (the contact / ticket forms only offer the chosen account's own plants). */
  plant: async (api: ApiClient, accountId: string, name: string): Promise<void> => {
    ok(await api.post(`/modules/accounts/${accountId}/table/plants`, { name, type: "Manufacturing", city: "Pune" }), `add plant ${name}`);
  },
  /** Site visit (status Planned). */
  visit: async (api: ApiClient, o: { accountId: string; opportunityId?: string }, over: Json = {}) => {
    const title = `${uniqueTag("VIS")} plant survey`;
    const r = ok(await api.post("/modules/visits", {
      title, accountId: o.accountId, opportunityId: o.opportunityId, visitDate: isoDate(2), objective: "Survey the weighbridge pit", ...over,
    }), "create site visit");
    return { id: r.body.id as string, title };
  },
  /** Demo / trial / sample evaluation (status Requested). */
  evaluation: async (api: ApiClient, o: { opportunityId: string; accountId: string }, over: Json = {}) => {
    const title = `${uniqueTag("DEM")} demo`;
    const r = ok(await api.post("/modules/demos", {
      title, type: "Demo", opportunityId: o.opportunityId, accountId: o.accountId, product: "Weighbridge", plannedDate: isoDate(3), ...over,
    }), "create evaluation");
    return { id: r.body.id as string, title };
  },
  product: async (api: ApiClient, over: Json = {}) => {
    const t = uniqueTag("PRD");
    const r = ok(await api.post("/modules/products", {
      category: "Weighbridges", family: "WB", model: `${t}-60T`, sku: t, price: 1_000_000, minPrice: 900_000, ...over,
    }), "create product");
    return { id: r.body.id as string, sku: r.body.sku as string };
  },
  /** Draft quotation; pass discountPct + productId to add one line. */
  quotation: async (api: ApiClient, o: QuoteOpts) => {
    const r = ok(await api.post("/modules/quotes", {
      opportunityId: o.opportunityId, accountId: o.accountId, quotationDate: isoDate(0), validUntil: isoDate(o.validDays ?? 30),
      paymentTerms: o.paymentTerms ?? TERMS,
    }), "create quotation");
    const id = r.body.id as string;
    if (o.productId) {
      ok(await api.patch(`/modules/quotes/${id}`, { lines: [{ productId: o.productId, qty: 1, unitPrice: 1_000_000, discountPct: o.discountPct ?? 0 }] }), "add quotation line");
    }
    return { id };
  },
  submittedQuotation: async (api: ApiClient, o: QuoteOpts): Promise<{ id: string; status: string; warnings: string[] }> => {
    const q = await build.quotation(api, o);
    const r = ok(await api.action("quotes", q.id, "Submit for approval"), "submit quotation");
    return { id: q.id, status: r.body.status as string, warnings: (r.body.warnings as string[] | undefined) ?? [] };
  },
  /** Quotation that is Approved (uses the quotation's own Approve action if it went to Approval pending). */
  approvedQuotation: async (api: ApiClient, o: QuoteOpts): Promise<{ id: string }> => {
    const q = await build.submittedQuotation(api, o);
    if (q.status !== "Approved") ok(await api.action("quotes", q.id, "Approve"), "approve quotation");
    return { id: q.id };
  },
  sentQuotation: async (api: ApiClient, o: QuoteOpts): Promise<{ id: string }> => {
    const q = await build.approvedQuotation(api, o);
    ok(await api.action("quotes", q.id, "Mark sent"), "mark sent");
    return q;
  },
  po: async (api: ApiClient, o: PoOpts) => {
    const r = ok(await api.post("/modules/pos", {
      poNo: uniqueTag("PO"), poDate: isoDate(0), opportunityId: o.opportunityId, quotationId: o.quotationId,
      accountId: o.accountId, value: o.value ?? 1_000_000, paymentTerms: o.paymentTerms ?? TERMS,
    }), "create PO");
    return { id: r.body.id as string };
  },
  acceptedPo: async (api: ApiClient, o: PoOpts): Promise<{ id: string }> => {
    const po = await build.po(api, o);
    ok(await api.action("pos", po.id, "Accept PO"), "accept PO");
    return po;
  },
  /** Sales order created by Accept PO (looked up through the list, newest first). */
  salesOrderFor: async (api: ApiClient, poId: string) => {
    const list = ok(await api.get("/modules/sorders?limit=100"), "list sales orders").body.data ?? [];
    const so = list.find((x) => x.purchaseOrderId === poId);
    if (!so) throw new Error(`no sales order for PO ${poId}`);
    return { id: so.id as string };
  },
  /** Advances a sales order to Commissioned with `serial`; returns the installed asset id. */
  commissionedOrder: async (api: ApiClient, salesOrderId: string, serial: string) => {
    for (let i = 0; i < 9; i += 1) ok(await api.action("sorders", salesOrderId, "Advance status", { serial }), "advance order");
    const list = ok(await api.get(`/modules/assets?search=${encodeURIComponent(serial)}`), "find asset").body.data ?? [];
    if (!list[0]) throw new Error(`no asset for serial ${serial}`);
    return { assetId: list[0].id as string };
  },
  /**
   * Whole after-sales chain: account (owned by salesExec1) -> opportunity -> product -> sent quotation -> PO accepted by Commercial -> sales order
   * -> Commissioned by Operations, which creates the installed asset (status 'Under warranty'). Returns the account, asset and serial.
   */
  asset: async (): Promise<{ account: { id: string; name: string }; assetId: string; serial: string; salesOrderId: string }> => {
    const sales = await apiAs("salesExec1");
    const commercial = await apiAs("commercial");
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id);
    const product = await build.product(commercial);
    const quote = await build.sentQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id });
    const po = await build.acceptedPo(commercial, { opportunityId: opp.id, accountId: account.id, quotationId: quote.id });
    const { id: salesOrderId } = await build.salesOrderFor(await apiAs("operations"), po.id);
    const serial = uniqueTag("SN");
    const { assetId } = await build.commissionedOrder(await apiAs("operations"), salesOrderId, serial);
    return { account, assetId, serial, salesOrderId };
  },
  coverage: async (api: ApiClient, o: { assetId: string; accountId: string; type?: string; endInDays?: number }) => {
    const r = ok(await api.post("/modules/amc", {
      assetId: o.assetId, accountId: o.accountId, type: o.type ?? "AMC", start: isoDate(-300),
      end: isoDate(o.endInDays ?? 60), value: 120_000, visitsIncluded: 4, visitsUsed: 0,
    }), "create coverage");
    return { id: r.body.id as string };
  },
  ticket: async (api: ApiClient, o: { accountId: string; assetId?: string; priority?: string }) => {
    const r = ok(await api.post("/modules/service", {
      accountId: o.accountId, assetId: o.assetId, complaintType: "Breakdown", priority: o.priority ?? "High", description: `E2E ${uniqueTag("TKT")}`,
    }), "create ticket");
    return { id: r.body.id as string };
  },
};
