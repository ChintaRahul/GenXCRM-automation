// e2e/mfg/routes.ts — mirrors frontend/src/modules/modulePaths.ts
export const MODULE_PATH: Record<string, string> = {
  leads: "leads", accounts: "accounts", contacts: "contacts", activities: "activities", opps: "opportunities",
  rfqs: "rfqs", visits: "site-visits", demos: "demos", products: "products", costing: "costing", quotes: "quotations",
  approvals: "approvals", pos: "purchase-orders", sorders: "sales-orders", dispatch: "dispatch", payments: "payments",
  assets: "installed-assets", amc: "amc", service: "service-tickets", reports: "reports",
};
export const listUrl = (key: string): string => `/${MODULE_PATH[key] ?? key}`;
export const detailUrl = (key: string, id: string): string => `${listUrl(key)}/${id}`;
