// Maps a registry.ts moduleKey to the URL path segment it's routed at in App.tsx.
// Needed because several keys don't match their path 1:1 (opps -> /opportunities,
// pos -> /purchase-orders, etc.) — this is the single source of truth both App.tsx's
// route definitions and cross-module navigation (RelatedTab clicks, "Open existing"
// on a duplicate match) build URLs from.
export const MODULE_ROUTE_PATHS: Record<string, string> = {
  leads: "leads",
  accounts: "accounts",
  contacts: "contacts",
  activities: "activities",
  opps: "opportunities",
  rfqs: "rfqs",
  visits: "site-visits",
  demos: "demos",
  products: "products",
  costing: "costing",
  quotes: "quotations",
  approvals: "approvals",
  pos: "purchase-orders",
  sorders: "sales-orders",
  dispatch: "dispatch",
  payments: "payments",
  assets: "installed-assets",
  amc: "amc",
  dealers: "dealers",
  tenders: "tenders",
  service: "service-tickets",
  reports: "reports",
};

export function pathForModuleKey(moduleKey: string): string {
  return MODULE_ROUTE_PATHS[moduleKey] ?? moduleKey;
}
