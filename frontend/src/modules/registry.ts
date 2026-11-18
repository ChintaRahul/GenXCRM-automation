// frontend/src/modules/registry.ts
//
// Schema-driven module framework registry — a pure-data TypeScript port of the
// design-handoff prototype at design_handoff_manufacturing_workspace/mfg-schema.js.
//
// This file is transcribed, not authored: every field, action, and tab below
// must trace back to a line in mfg-schema.js. See task-1-brief.md for the exact
// shorthand-to-TypeScript mapping rules used during transcription.

/** Field data types used across module field definitions. */
export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "money"
  | "date"
  | "status"
  | "owner"
  | "ref"
  | "plant"
  | "number"
  | "pct"
  | "bool";

/** Column display types used across module list columns.
 * NOTE: "mono" is included here even though the Task 1 brief's mapping rules
 * claimed Batch A has no mono/num/suffix column types — mfg-schema.js line 67
 * (`c('phone','Phone','mono')` in M.contacts.cols) shows this claim is incorrect.
 * Kept as the source's exact string per the brief's own fallback instruction.
 */
export type ModuleColumnType =
  | "id"
  | "text"
  | "money"
  | "owner"
  | "sla"
  | "status"
  | "pill"
  | "ref"
  | "mono"
  | "date"
  | "num"
  | "marginpct";

export interface ModuleField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required?: boolean;
  readonly section?: string;
  readonly options?: readonly string[];
  readonly ref?: string;
  readonly full?: boolean;
  // Shown in an owner dropdown while nothing is chosen (default: "Me (default)").
  readonly ownerPlaceholder?: string;
  readonly readOnly?: boolean;
  readonly hidden?: boolean;
  readonly restricted?: boolean;
  // Only filled in after the record exists (e.g. a visit's observations): hidden on the create form.
  readonly editOnly?: boolean;
  // Set by a workflow action or derived by the system (e.g. assigned engineer, matched rule):
  // shown on the record, never typed into the create/edit form.
  readonly workflow?: boolean;
  // Date that cannot be set earlier than today when creating a record (e.g. a visit or task to schedule).
  readonly noPast?: boolean;
}

export interface ModuleColumn {
  readonly key: string;
  readonly label: string;
  readonly type: ModuleColumnType;
  readonly sub?: string;
  readonly tones?: Record<string, string>;
  readonly restricted?: boolean;
  readonly suffix?: string;
}

export interface ModuleActionAsk {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly options?: readonly string[];
  // For a "ref" question: the module whose records to pick from.
  readonly ref?: string;
  readonly required: boolean;
  // Further optional questions asked in the same dialog (text, number, money, date or textarea).
  readonly more?: readonly ModuleActionAsk[];
}

export interface ModuleAction {
  readonly label: string;
  readonly to?: string;
  readonly when?: readonly string[];
  readonly notWhen?: readonly string[];
  readonly primary?: boolean;
  readonly danger?: boolean;
  readonly special?: string;
  readonly ask?: ModuleActionAsk;
  // Asks "Are you sure?" before a plain action (no `ask`) runs.
  readonly confirm?: string;
}

export interface ModuleTab {
  readonly key: string;
  readonly label: string;
  readonly kind: "fields" | "related" | "table" | "events" | "lines";
  readonly sections?: readonly string[];
  readonly excludeSections?: readonly string[];
  readonly relatedModule?: string;
  readonly foreignKey?: string;
  readonly lineColumns?: readonly ModuleColumn[];
  // A "table" tab whose rows can be added/removed in place (e.g. an account's plants).
  readonly rowFields?: readonly ModuleField[];
  readonly rowLabel?: string;
  // A "related" tab that shows a "New …" button; the special action (see ModuleDetailRoute) opens the create form prefilled from this record.
  readonly createAction?: string;
}

export interface ModuleStatus {
  readonly value: string;
  readonly tone: string;
}

export interface ModuleDef {
  readonly title: string;
  readonly singular?: string;
  readonly icon?: string;
  readonly idPrefix: string;
  readonly label?: string;
  readonly desc?: string;
  readonly statusKey?: string;
  readonly statuses: readonly ModuleStatus[];
  readonly flow?: readonly string[];
  readonly dupKeys?: readonly string[];
  readonly kanban?: boolean;
  readonly hasDocs?: boolean;
  readonly restricted?: boolean;
  readonly noCreate?: boolean;
  // Shows an Import (CSV) button on the list.
  readonly importable?: boolean;
  readonly fields: readonly ModuleField[];
  readonly cols: readonly ModuleColumn[];
  readonly actions?: readonly ModuleAction[];
  readonly tabs: readonly ModuleTab[];
}

// ---------------------------------------------------------------------------
// Shared option-list constants (mfg-schema.js lines 17-25), transcribed
// verbatim. Not exported — internal to building the fields/actions below,
// exactly mirroring mfg-schema.js's own scoping.
// ---------------------------------------------------------------------------

const SOURCES = [
  "Website", "Google Ads", "Meta", "IndiaMART", "TradeIndia", "Exhibition",
  "Referral", "LinkedIn", "WhatsApp", "Email", "Dealer", "Cold calling",
  "Existing customer", "Manual / API",
];
// Exported for reuse by the lead-conversion dialog's "new account" sub-form, which needs the
// exact same option lists as the accounts module's own type/industry/territory fields.
export const ACCOUNT_TYPES = ["Customer", "Prospect", "Dealer"];
export const INDUSTRIES = [
  "Steel & metals", "Cement", "Food processing", "Pharmaceuticals",
  "Chemicals & polymers", "Warehousing & logistics", "Fertilisers",
  "Plantation & agri", "Sugar", "Paper & packaging", "Mining & minerals",
  "Dairy", "Textiles",
];
export const TERR = ["North", "South", "East", "West", "Central"];
const PRODUCTS = [
  "Weighbridge", "Belt weigher", "Checkweigher", "Bagging machine",
  "Conveyor", "Load cells", "Platform scale", "Filling scale", "AMC / Service",
];
const LOST = [
  "Price", "Competitor", "Technical mismatch", "Delivery time", "Budget",
  "Project cancelled", "No response", "Existing vendor", "Payment terms",
  "Internal approval", "Other",
];
const COMPETITORS = [
  "Avery Weigh-Tronix", "Essae Digitronics", "Mettler Toledo",
  "Local fabricator", "Other",
];
// ROLES, BUYING are shared constants from mfg-schema.js used by later batches
// (contacts uses BUYING in this batch; approvals uses ROLES in Batch B).
const ROLES = [
  "Super Admin", "Director", "Sales Head", "Sales Manager", "Sales Executive",
  "Application Engineer", "Commercial / Estimation", "Operations", "Accounts",
  "Service Manager", "Service Engineer",
];
export const BUYING = [
  "Decision Maker", "Technical Influencer", "User", "Procurement", "Finance",
  "Gatekeeper", "Management",
];

// STAGES: the 12 opportunity stage labels (from mfg-data.js's D.stages, in
// order — see mfg-data.js lines 19-32, each entry's `.l` field) plus "Won"
// and "Lost", per mfg-schema.js line 25: `D.stages.map(s => s.l).concat(['Won','Lost'])`.
const STAGES = [
  "Qualified",
  "Requirement collected",
  "Technical discussion",
  "Site visit",
  "Demo / trial",
  "Solution proposed",
  "Costing",
  "Quotation sent",
  "Negotiation",
  "Approval pending",
  "PO expected",
  "PO received",
  "Won",
  "Lost",
];

// mfg-schema.js line 26: stageTone(s) — used to compute each stage's status
// tone. Transcribed as the resulting tone assignments below (the function
// itself is a derivation helper, not registry data).
const stageTone = (s: string): string =>
  s === "Won"
    ? "green"
    : s === "Lost"
      ? "red"
      : ["Negotiation", "Approval pending", "PO expected", "PO received"].includes(s)
        ? "teal"
        : ["Solution proposed", "Costing", "Quotation sent"].includes(s)
          ? "blue"
          : "gray";

// A shared, reusable "owner" field every module with individual ownership uses.
// key is "ownerId" (not "owner") to match every backend Create/UpdateDto's real property
// name — see the Phase 6 field-key audit: the registry originally used mfg-schema.js's
// short prototype keys verbatim, which don't match the real DTOs, so the backend's
// whitelist ValidationPipe silently stripped this field (and many others) on every save.
const OWN: ModuleField = { key: "ownerId", label: "Owner", type: "owner", required: true, section: "Ownership" };

// costing's 13 programmatic cost-component fields (mfg-schema.js line 174):
// const COSTS = [['material','Material'], ...] — a [key, label][] concatenated
// into the field list as 13 money fields under section "Cost components".
const COST_COMPONENTS: readonly [string, string][] = [
  ["material", "Material"], ["boughtOut", "Bought-out items"], ["fabrication", "Fabrication"],
  ["electrical", "Electrical"], ["software", "Software"], ["labor", "Labour"],
  ["installation", "Installation"], ["freight", "Freight"], ["packing", "Packing"],
  ["travel", "Travel"], ["overhead", "Overhead"], ["contingency", "Contingency"], ["other", "Other"],
];

// sorders' 11-step execution flow (mfg-schema.js line 244), with statuses
// generated by tone-by-index-band (mfg-schema.js line 246):
//   i < 1 -> blue, i < 6 -> amber, i < 9 -> teal, else green.
const ORDER_FLOW = [
  "Order accepted", "Design", "Procurement", "Production", "Quality check",
  "Ready for dispatch", "Dispatched", "Delivered", "Installation", "Commissioned", "Closed",
];
function orderFlowTone(index: number): string {
  if (index < 1) return "blue";
  if (index < 6) return "amber";
  if (index < 9) return "teal";
  return "green";
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const REGISTRY: Record<string, ModuleDef> = {
  leads: {
    title: "Leads",
    singular: "Lead",
    icon: "target",
    idPrefix: "LD-",
    label: "company",
    desc: "Every enquiry, from first touch to qualified opportunity.",
    importable: true,
    statuses: [
      { value: "New", tone: "blue" },
      { value: "Assigned", tone: "teal" },
      { value: "Contacted", tone: "teal" },
      { value: "Follow-up", tone: "amber" },
      { value: "Qualified", tone: "green" },
      { value: "Nurture", tone: "violet" },
      { value: "Disqualified", tone: "gray" },
      { value: "Converted", tone: "green" },
    ],
    flow: ["New", "Assigned", "Contacted", "Follow-up", "Qualified"],
    dupKeys: ["phone", "email", "company"],
    fields: [
      { key: "company", label: "Company", type: "text", required: true, section: "Prospect" },
      { key: "contactName", label: "Contact person", type: "text", required: true, section: "Prospect" },
      { key: "designation", label: "Designation", type: "text", section: "Prospect" },
      { key: "phone", label: "Phone", type: "text", required: true, section: "Prospect" },
      { key: "email", label: "Email", type: "text", section: "Prospect" },
      { key: "city", label: "City", type: "text", section: "Prospect" },
      { key: "state", label: "State", type: "text", section: "Prospect" },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES, section: "Prospect" },
      { key: "product", label: "Product interest", type: "select", options: PRODUCTS, required: true, section: "Enquiry" },
      { key: "requirement", label: "Requirement summary", type: "textarea", section: "Enquiry", full: true },
      { key: "source", label: "Source", type: "select", options: SOURCES, required: true, section: "Enquiry" },
      { key: "campaign", label: "Campaign", type: "text", section: "Enquiry" },
      { key: "value", label: "Estimated value", type: "money", section: "Enquiry" },
      { key: "timeline", label: "Expected timeline", type: "select", options: ["< 1 month", "1–3 months", "3–6 months", "6+ months"], section: "Enquiry" },
      { key: "qReq", label: "Requirement", type: "text", section: "Qualification" },
      { key: "qApp", label: "Application", type: "text", section: "Qualification" },
      { key: "qQty", label: "Quantity / capacity", type: "text", section: "Qualification" },
      { key: "qBudget", label: "Budget", type: "select", options: ["Approved", "In process", "Not allocated", "Unknown"], section: "Qualification" },
      { key: "qAuth", label: "Authority", type: "select", options: ["Decision maker engaged", "Influencer only", "Unknown"], section: "Qualification" },
      { key: "qNeed", label: "Need", type: "select", options: ["Critical", "Important", "Nice to have"], section: "Qualification" },
      { key: "qTime", label: "Timeline", type: "select", options: ["This quarter", "Next quarter", "This year", "Unknown"], section: "Qualification" },
      { ...OWN, ownerPlaceholder: "Auto-assign to a sales executive" },
      { key: "status", label: "Status", type: "status", section: "Ownership" },
      { key: "next", label: "Next action", type: "text", section: "Ownership" },
      { key: "nextDate", label: "Next action date", type: "date", section: "Ownership" },
      { key: "created", label: "Created", type: "date", section: "Ownership", readOnly: true },
      { key: "disq", label: "Disqualification reason", type: "select", options: LOST, section: "Ownership", hidden: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "company", label: "Company", type: "text", sub: "contactName" },
      { key: "source", label: "Source", type: "text" },
      { key: "product", label: "Product", type: "text" },
      { key: "value", label: "Est. value", type: "money" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "sla", label: "Response SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Mark contacted", to: "Contacted", when: ["New", "Assigned"] },
      { label: "Qualify", to: "Qualified", when: ["Contacted", "Follow-up", "Nurture"], primary: true },
      { label: "Move to nurture", to: "Nurture", when: ["Contacted", "Follow-up"] },
      { label: "Convert to opportunity", special: "convert", when: ["Qualified"], primary: true },
      { label: "Merge into another lead", when: ["New", "Assigned", "Contacted", "Follow-up", "Nurture", "Qualified"], ask: { key: "into", label: "Keep this lead instead (the duplicate is merged into it)", type: "ref", ref: "leads", required: true } },
      {
        label: "Disqualify",
        to: "Disqualified",
        when: ["New", "Assigned", "Contacted", "Follow-up", "Nurture"],
        ask: { key: "disq", label: "Disqualification reason", type: "select", options: LOST, required: true },
        danger: true,
      },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields", excludeSections: ["Qualification"] },
      { key: "qual", label: "Qualification", kind: "fields", sections: ["Qualification"] },
      { key: "acts", label: "Activities", kind: "related", relatedModule: "activities", foreignKey: "lead" },
    ],
  },

  accounts: {
    title: "Accounts",
    singular: "Account",
    icon: "building-2",
    idPrefix: "A-",
    label: "short",
    desc: "Customer organisations with their plants and buying committee.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Dormant", tone: "gray" },
      { value: "On hold", tone: "amber" },
    ],
    dupKeys: ["name", "gstin"],
    hasDocs: true,
    fields: [
      { key: "name", label: "Legal name", type: "text", required: true, section: "Company", full: true },
      { key: "short", label: "Display name", type: "text", required: true, section: "Company" },
      { key: "type", label: "Customer type", type: "select", options: ACCOUNT_TYPES, required: true, section: "Company" },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES, required: true, section: "Company" },
      { key: "subIndustry", label: "Sub-industry", type: "text", section: "Company" },
      { key: "gstin", label: "GSTIN", type: "text", section: "Company" },
      { key: "pan", label: "PAN", type: "text", section: "Company" },
      { key: "website", label: "Website", type: "text", section: "Company" },
      { key: "billing", label: "Billing address", type: "textarea", section: "Location", full: true },
      { key: "city", label: "City", type: "text", required: true, section: "Location" },
      { key: "state", label: "State", type: "text", required: true, section: "Location" },
      { key: "country", label: "Country", type: "text", section: "Location" },
      { key: "territory", label: "Territory", type: "select", options: TERR, required: true, section: "Location" },
      { key: "potential", label: "Annual potential", type: "money", section: "Commercial" },
      { key: "creditTerms", label: "Credit terms", type: "select", options: ["100% advance", "30 days", "45 days", "60 days", "90 days"], section: "Commercial" },
      { key: "source", label: "Source", type: "select", options: SOURCES, section: "Commercial" },
      { key: "tags", label: "Tags", type: "text", section: "Commercial" },
      OWN,
      { key: "status", label: "Status", type: "status", section: "Ownership" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "short", label: "Account", type: "text", sub: "city" },
      { key: "industry", label: "Industry", type: "text" },
      { key: "type", label: "Type", type: "pill", tones: { Customer: "teal", Prospect: "blue", Dealer: "violet" } },
      { key: "territory", label: "Territory", type: "text" },
      { key: "potential", label: "Potential", type: "money" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Reassign owner", special: "reassign", ask: { key: "owner", label: "New owner", type: "owner", required: true } },
      { label: "Mark dormant", to: "Dormant", when: ["Active", "On hold"] },
      { label: "Reactivate", to: "Active", when: ["Dormant", "On hold"] },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields" },
      {
        key: "plants",
        label: "Plants",
        kind: "table",
        rowLabel: "plant",
        rowFields: [
          { key: "name", label: "Plant name", type: "text", required: true },
          { key: "type", label: "Type", type: "select", options: ["Manufacturing", "Warehouse", "Office", "Other"], required: true },
          { key: "city", label: "City", type: "text", required: true },
          { key: "address", label: "Address", type: "text" },
        ],
      },
      { key: "contacts", label: "Contacts", kind: "related", relatedModule: "contacts", foreignKey: "acc" },
      { key: "opps", label: "Opportunities", kind: "related", relatedModule: "opps", foreignKey: "acc" },
      { key: "quotes", label: "Quotations", kind: "related", relatedModule: "quotes", foreignKey: "acc" },
      { key: "orders", label: "Orders", kind: "related", relatedModule: "sorders", foreignKey: "acc" },
      { key: "assets", label: "Installed assets", kind: "related", relatedModule: "assets", foreignKey: "acc" },
      { key: "service", label: "Service", kind: "related", relatedModule: "service", foreignKey: "acc" },
      { key: "payments", label: "Payments", kind: "related", relatedModule: "payments", foreignKey: "acc" },
      { key: "acts", label: "Activities", kind: "related", relatedModule: "activities", foreignKey: "acc" },
    ],
  },

  contacts: {
    title: "Contacts",
    singular: "Contact",
    icon: "contact-round",
    idPrefix: "C-",
    label: "name",
    desc: "People at each account and plant, with their buying role.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Inactive", tone: "gray" },
    ],
    dupKeys: ["phone", "email"],
    fields: [
      { key: "name", label: "Full name", type: "text", required: true, section: "Contact" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Contact" },
      { key: "plant", label: "Plant", type: "plant", section: "Contact" },
      { key: "designation", label: "Designation", type: "text", section: "Contact" },
      { key: "department", label: "Department", type: "select", options: ["Management", "Projects", "Purchase", "Maintenance", "Production", "Quality", "Finance", "Stores"], section: "Contact" },
      { key: "phone", label: "Phone", type: "text", required: true, section: "Reach" },
      { key: "whatsapp", label: "WhatsApp", type: "text", section: "Reach" },
      { key: "email", label: "Email", type: "text", section: "Reach" },
      { key: "channel", label: "Preferred channel", type: "select", options: ["Phone", "WhatsApp", "Email", "In person"], section: "Reach" },
      { key: "role", label: "Buying role", type: "select", options: BUYING, required: true, section: "Influence" },
      { key: "influence", label: "Influence level", type: "select", options: ["High", "Medium", "Low"], section: "Influence" },
      { key: "status", label: "Status", type: "status", section: "Influence" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "name", label: "Name", type: "text", sub: "designation" },
      { key: "accountId", label: "Account", type: "ref" },
      { key: "role", label: "Buying role", type: "pill", tones: { "Decision Maker": "teal", "Technical Influencer": "blue", Procurement: "amber", Finance: "violet" } },
      { key: "influence", label: "Influence", type: "text" },
      { key: "phone", label: "Phone", type: "mono" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Mark inactive", to: "Inactive", when: ["Active"], danger: true, confirm: "It stays in history but won't be offered when picking a contact. You can reactivate it any time." },
      { label: "Reactivate", to: "Active", when: ["Inactive"] },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields" },
      { key: "acts", label: "Activities", kind: "related", relatedModule: "activities", foreignKey: "contact" },
      { key: "opps", label: "Opportunities", kind: "related", relatedModule: "opps", foreignKey: "contact" },
    ],
  },

  activities: {
    title: "Activities",
    singular: "Activity",
    icon: "calendar-check",
    idPrefix: "T-",
    label: "subject",
    desc: "Calls, meetings, visits and follow-ups — every next action in one place.",
    statuses: [
      { value: "Open", tone: "blue" },
      { value: "Completed", tone: "green" },
      { value: "Cancelled", tone: "gray" },
    ],
    fields: [
      { key: "type", label: "Type", type: "select", options: ["Call", "WhatsApp", "Email", "Meeting", "Site visit", "Demo", "Quotation follow-up", "PO follow-up", "Payment follow-up", "Service follow-up"], required: true, section: "Activity" },
      { key: "subject", label: "Subject", type: "text", required: true, section: "Activity", full: true },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", section: "Activity" },
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", section: "Activity" },
      { key: "contactId", label: "Contact", type: "ref", ref: "contacts", section: "Activity" },
      { key: "mfgLeadId", label: "Lead", type: "ref", ref: "leads", section: "Activity" },
      { key: "dueDate", label: "Scheduled for", type: "date", required: true, noPast: true, section: "Schedule" },
      { key: "dueTime", label: "Time", type: "text", section: "Schedule" },
      { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"], required: true, section: "Schedule" },
      OWN,
      { key: "status", label: "Status", type: "status", section: "Ownership" },
      { key: "notes", label: "Notes", type: "textarea", section: "Outcome", full: true },
      { key: "outcome", label: "Outcome", type: "textarea", section: "Outcome", full: true, editOnly: true },
      { key: "nextAction", label: "Next action", type: "text", section: "Outcome", editOnly: true },
      { key: "nextActionDate", label: "Next action date", type: "date", section: "Outcome", editOnly: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "subject", label: "Subject", type: "text", sub: "type" },
      { key: "accountId", label: "Account", type: "ref" },
      { key: "dueDate", label: "Due", type: "date" },
      { key: "priority", label: "Priority", type: "pill", tones: { High: "red", Medium: "amber", Low: "gray" } },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "sla", label: "Follow-up SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Add to calendar", special: "ics" },
      {
        label: "Complete",
        to: "Completed",
        when: ["Open"],
        primary: true,
        ask: { key: "outcome", label: "Outcome (required to complete)", type: "textarea", required: true },
      },
      { label: "Cancel", to: "Cancelled", when: ["Open"], danger: true },
    ],
    tabs: [
      { key: "overview", label: "Details", kind: "fields" },
    ],
  },

  opps: {
    title: "Opportunities",
    singular: "Opportunity",
    icon: "briefcase",
    idPrefix: "OP-",
    label: "title",
    statusKey: "stage",
    desc: "Qualified deals moving through technical and commercial stages.",
    statuses: STAGES.map((value) => ({ value, tone: stageTone(value) })),
    flow: STAGES.slice(0, STAGES.length - 2),
    kanban: true,
    hasDocs: true,
    fields: [
      { key: "title", label: "Opportunity", type: "text", required: true, section: "Deal", full: true },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Deal" },
      { key: "plant", label: "Plant", type: "text", section: "Deal" },
      { key: "contactId", label: "Primary contact", type: "ref", ref: "contacts", section: "Deal" },
      { key: "product", label: "Product / category", type: "select", options: PRODUCTS, required: true, section: "Deal" },
      { key: "qty", label: "Expected quantity", type: "number", section: "Deal" },
      { key: "summary", label: "Requirement summary", type: "textarea", section: "Deal", full: true },
      { key: "value", label: "Estimated value", type: "money", required: true, section: "Commercial" },
      { key: "currency", label: "Currency", type: "select", options: ["INR", "USD", "EUR"], section: "Commercial" },
      { key: "stage", label: "Stage", type: "select", options: STAGES, required: true, section: "Commercial" },
      { key: "prob", label: "Probability", type: "pct", section: "Commercial", readOnly: true },
      { key: "closeDate", label: "Expected close", type: "date", required: true, section: "Commercial" },
      { key: "competitor", label: "Competitor", type: "select", options: COMPETITORS, section: "Commercial" },
      { key: "source", label: "Source", type: "select", options: SOURCES, section: "Commercial" },
      OWN,
      { key: "technicalOwnerId", label: "Technical owner", type: "owner", section: "Ownership" },
      { key: "nextAction", label: "Next action", type: "text", required: true, section: "Ownership" },
      { key: "nextActionDate", label: "Next action date", type: "date", required: true, section: "Ownership" },
      { key: "age", label: "Opportunity age (days)", type: "number", section: "Ownership", readOnly: true },
      { key: "daysInStage", label: "Days in stage", type: "number", section: "Ownership", readOnly: true },
      { key: "lost", label: "Lost reason", type: "select", options: LOST, section: "Ownership", hidden: true },
      { key: "competitorProduct", label: "Competitor product", type: "text", section: "Lost deal", readOnly: true },
      { key: "competitorPrice", label: "Competitor price", type: "money", section: "Lost deal", readOnly: true },
      { key: "decisionDate", label: "Decision date", type: "date", section: "Lost deal", readOnly: true },
      { key: "lostFeedback", label: "Customer feedback", type: "textarea", section: "Lost deal", full: true, readOnly: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "title", label: "Opportunity", type: "text", sub: "accountId" },
      { key: "stage", label: "Stage", type: "status" },
      { key: "value", label: "Value", type: "money" },
      { key: "closeDate", label: "Close", type: "date" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "nextAction", label: "Next action", type: "text", sub: "nextActionDate" },
      { key: "sla", label: "Health", type: "sla" },
    ],
    actions: [
      { label: "Advance stage", special: "advance", primary: true, notWhen: ["Won", "Lost", "PO received"] },
      { label: "Log activity", special: "logActivity" },
      { label: "Mark won", to: "Won", when: ["PO received", "PO expected", "Negotiation"] },
      {
        label: "Mark lost",
        to: "Lost",
        notWhen: ["Won", "Lost"],
        danger: true,
        ask: {
          key: "lost",
          label: "Lost reason",
          type: "select",
          options: LOST,
          required: true,
          more: [
            { key: "competitorProduct", label: "Competitor product (optional)", type: "text", required: false },
            { key: "competitorPrice", label: "Competitor price (₹, optional)", type: "money", required: false },
            { key: "decisionDate", label: "Decision date (optional)", type: "date", required: false },
            { key: "lostFeedback", label: "Customer feedback (optional)", type: "textarea", required: false },
          ],
        },
      },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields" },
      { key: "history", label: "Stage history", kind: "events" },
      { key: "timeline", label: "Timeline", kind: "events" },
      { key: "contacts", label: "Contacts", kind: "related", relatedModule: "contacts", foreignKey: "acc" },
      { key: "acts", label: "Activities", kind: "related", relatedModule: "activities", foreignKey: "opp" },
      { key: "rfqs", label: "Requirements", kind: "related", relatedModule: "rfqs", foreignKey: "opp" },
      { key: "visits", label: "Visits", kind: "related", relatedModule: "visits", foreignKey: "opp" },
      { key: "demos", label: "Demos & trials", kind: "related", relatedModule: "demos", foreignKey: "opp" },
      { key: "costing", label: "Costing", kind: "related", relatedModule: "costing", foreignKey: "opp" },
      { key: "quotes", label: "Quotations", kind: "related", relatedModule: "quotes", foreignKey: "opp", createAction: "createQuotation" },
      { key: "pos", label: "PO / Orders", kind: "related", relatedModule: "pos", foreignKey: "opp" },
    ],
  },

  rfqs: {
    title: "RFQs",
    singular: "RFQ",
    icon: "file-spreadsheet",
    idPrefix: "RFQ-",
    label: "custNo",
    desc: "Technical requirements with revision history and feasibility sign-off.",
    statuses: [
      { value: "Received", tone: "blue" },
      { value: "Clarification required", tone: "amber" },
      { value: "Technically feasible", tone: "teal" },
      { value: "Not feasible", tone: "red" },
      { value: "Approved for costing", tone: "green" },
    ],
    hasDocs: true,
    fields: [
      { key: "custNo", label: "Customer RFQ no.", type: "text", required: true, section: "RFQ" },
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", required: true, section: "RFQ" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "RFQ" },
      { key: "receivedOn", label: "Received on", type: "date", required: true, section: "RFQ" },
      { key: "revision", label: "Revision", type: "number", section: "RFQ", readOnly: true },
      { key: "ownerId", label: "Technical owner", type: "owner", required: true, section: "RFQ" },
      { key: "status", label: "Status", type: "status", section: "RFQ" },
      { key: "application", label: "Application", type: "text", required: true, section: "Specification", full: true },
      { key: "product", label: "Product", type: "select", options: PRODUCTS, required: true, section: "Specification" },
      { key: "qty", label: "Quantity", type: "number", section: "Specification" },
      { key: "capacity", label: "Capacity", type: "text", section: "Specification" },
      { key: "dimensions", label: "Dimensions", type: "text", section: "Specification" },
      { key: "accuracy", label: "Accuracy / tolerance", type: "text", section: "Specification" },
      { key: "material", label: "Material", type: "text", section: "Specification" },
      { key: "environment", label: "Environment", type: "select", options: ["Indoor", "Outdoor", "Dusty", "Hazardous (ATEX)", "Cleanroom", "Washdown"], section: "Specification" },
      { key: "utilities", label: "Utilities", type: "text", section: "Specification" },
      { key: "protocol", label: "Communication protocol", type: "select", options: ["Modbus RTU", "Modbus TCP", "Profinet", "EtherNet/IP", "4–20 mA", "RS-232"], section: "Specification" },
      { key: "erp", label: "ERP / integration", type: "text", section: "Specification" },
      { key: "installRequired", label: "Installation required", type: "bool", section: "Scope" },
      { key: "calibRequired", label: "Calibration required", type: "bool", section: "Scope" },
      { key: "compliance", label: "Compliance", type: "text", section: "Scope" },
      { key: "delivery", label: "Delivery expectation", type: "text", section: "Scope" },
      { key: "specialConditions", label: "Special conditions", type: "textarea", section: "Scope", full: true },
      { key: "clarificationNote", label: "Clarification asked", type: "textarea", section: "Feasibility", full: true, readOnly: true },
      { key: "notFeasibleReason", label: "Not feasible because", type: "textarea", section: "Feasibility", full: true, readOnly: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "custNo", label: "Customer RFQ", type: "mono", sub: "accountId" },
      { key: "product", label: "Product", type: "text" },
      { key: "capacity", label: "Capacity", type: "text" },
      { key: "receivedOn", label: "Received", type: "date" },
      { key: "revision", label: "Rev", type: "num" },
      { key: "ownerId", label: "Tech owner", type: "owner" },
      { key: "sla", label: "Feasibility SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      {
        label: "Request clarification",
        to: "Clarification required",
        when: ["Received", "Technically feasible"],
        ask: { key: "clarification", label: "What needs clarifying?", type: "textarea", required: true },
      },
      { label: "Mark feasible", to: "Technically feasible", when: ["Received", "Clarification required"] },
      { label: "Approve for costing", to: "Approved for costing", when: ["Technically feasible"], primary: true },
      {
        label: "Not feasible",
        to: "Not feasible",
        when: ["Received", "Clarification required"],
        danger: true,
        ask: { key: "nf", label: "Reason", type: "textarea", required: true },
      },
      { label: "New revision", special: "revise" },
    ],
    tabs: [
      { key: "spec", label: "Specification", kind: "fields" },
      { key: "revs", label: "Revisions", kind: "events" },
    ],
  },

  visits: {
    title: "Site visits",
    singular: "Site visit",
    icon: "map-pin",
    idPrefix: "SV-",
    label: "title",
    desc: "Plan and report customer site visits with structured findings.",
    statuses: [
      { value: "Planned", tone: "blue" },
      { value: "Confirmed", tone: "teal" },
      { value: "Completed", tone: "green" },
      { value: "Rescheduled", tone: "amber" },
      { value: "Cancelled", tone: "gray" },
    ],
    hasDocs: true,
    fields: [
      { key: "title", label: "Visit title", type: "text", required: true, section: "Visit", full: true },
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", section: "Visit" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Visit" },
      { key: "plant", label: "Plant", type: "text", section: "Visit" },
      { key: "visitDate", label: "Visit date", type: "date", required: true, noPast: true, section: "Visit" },
      { key: "time", label: "Time", type: "text", section: "Visit" },
      { key: "ownerId", label: "Sales owner", type: "owner", required: true, section: "Visit" },
      { key: "engineers", label: "Engineers", type: "text", section: "Visit" },
      { key: "objective", label: "Objective", type: "textarea", required: true, section: "Visit", full: true },
      { key: "status", label: "Status", type: "status", section: "Visit" },
      { key: "existingSystem", label: "Existing system", type: "textarea", section: "Findings", full: true, editOnly: true },
      { key: "customerProblem", label: "Customer problem", type: "textarea", section: "Findings", full: true, editOnly: true },
      { key: "measurements", label: "Measurements", type: "textarea", section: "Findings", full: true, editOnly: true },
      { key: "observations", label: "Observations", type: "textarea", section: "Findings", full: true, editOnly: true },
      { key: "recommendation", label: "Recommended solution", type: "textarea", section: "Findings", full: true, editOnly: true },
      { key: "customerComments", label: "Customer comments", type: "textarea", section: "Findings", full: true, editOnly: true },
      { key: "nextAction", label: "Next action", type: "text", section: "Follow-up", editOnly: true },
      { key: "nextActionDate", label: "Next action date", type: "date", section: "Follow-up", editOnly: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "title", label: "Visit", type: "text", sub: "accountId" },
      { key: "visitDate", label: "Date", type: "date" },
      { key: "ownerId", label: "Sales owner", type: "owner" },
      { key: "engineers", label: "Engineers", type: "text" },
      { key: "sla", label: "Report SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Add to calendar", special: "ics" },
      { label: "Confirm", to: "Confirmed", when: ["Planned", "Rescheduled"] },
      {
        label: "Complete visit",
        to: "Completed",
        when: ["Planned", "Confirmed"],
        primary: true,
        ask: { key: "next", label: "Next action (required after a visit)", type: "text", required: true },
      },
      {
        label: "Reschedule",
        to: "Rescheduled",
        when: ["Planned", "Confirmed"],
        ask: { key: "date", label: "New date", type: "date", required: true },
      },
      { label: "Download report PDF", special: "pdf", when: ["Completed"] },
      { label: "Cancel", to: "Cancelled", when: ["Planned", "Confirmed", "Rescheduled"], danger: true },
    ],
    tabs: [
      { key: "overview", label: "Visit", kind: "fields", excludeSections: ["Findings"] },
      { key: "report", label: "Visit report", kind: "fields", sections: ["Findings"] },
    ],
  },

  demos: {
    title: "Demos & trials",
    singular: "Evaluation",
    icon: "flask-conical",
    idPrefix: "EV-",
    label: "title",
    desc: "Machine demos, plant trials and sample evaluations before purchase.",
    statuses: [
      { value: "Requested", tone: "blue" },
      { value: "Scheduled", tone: "teal" },
      { value: "In progress", tone: "amber" },
      { value: "Completed", tone: "gray" },
      { value: "Successful", tone: "green" },
      { value: "Failed", tone: "red" },
      { value: "Customer approved", tone: "green" },
      { value: "Customer rejected", tone: "red" },
    ],
    fields: [
      { key: "title", label: "Evaluation", type: "text", required: true, section: "Evaluation", full: true },
      { key: "type", label: "Type", type: "select", options: ["Demo", "Trial", "Sample"], required: true, section: "Evaluation" },
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", required: true, section: "Evaluation" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Evaluation" },
      { key: "product", label: "Product / sample", type: "text", section: "Evaluation" },
      { key: "serial", label: "Serial no.", type: "text", section: "Evaluation" },
      { key: "sampleQty", label: "Sample qty", type: "number", section: "Evaluation" },
      { key: "plannedDate", label: "Planned date", type: "date", required: true, noPast: true, section: "Evaluation" },
      { key: "actualDate", label: "Actual date", type: "date", section: "Evaluation", editOnly: true },
      OWN,
      { key: "status", label: "Status", type: "status", section: "Ownership" },
      { key: "parameters", label: "Test parameters", type: "textarea", section: "Result", full: true, editOnly: true },
      { key: "application", label: "Application", type: "text", section: "Result", editOnly: true },
      { key: "result", label: "Result", type: "textarea", section: "Result", full: true, editOnly: true },
      { key: "feedback", label: "Customer feedback", type: "textarea", section: "Result", full: true, editOnly: true },
      { key: "approvedByCustomer", label: "Approved by (customer)", type: "text", section: "Result", editOnly: true },
      { key: "sampleDispatched", label: "Sample dispatched", type: "date", section: "Sample logistics", editOnly: true },
      { key: "sampleDelivered", label: "Sample delivered", type: "date", section: "Sample logistics", editOnly: true },
      { key: "sampleTested", label: "Sample tested", type: "date", section: "Sample logistics", editOnly: true },
      { key: "nextAction", label: "Next action", type: "text", section: "Ownership", editOnly: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "title", label: "Evaluation", type: "text", sub: "accountId" },
      { key: "type", label: "Type", type: "pill", tones: { Demo: "blue", Trial: "teal", Sample: "violet" } },
      { key: "plannedDate", label: "Planned", type: "date" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "sla", label: "Result SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Add to calendar", special: "ics" },
      { label: "Schedule", to: "Scheduled", when: ["Requested"] },
      { label: "Start", to: "In progress", when: ["Scheduled"] },
      { label: "Mark successful", to: "Successful", when: ["In progress", "Completed"], primary: true },
      {
        label: "Mark failed",
        to: "Failed",
        when: ["In progress", "Completed"],
        danger: true,
        ask: { key: "result", label: "What failed?", type: "textarea", required: true },
      },
      { label: "Customer approved", to: "Customer approved", when: ["Successful"] },
      { label: "Customer rejected", to: "Customer rejected", when: ["Successful", "Completed"], danger: true },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields", excludeSections: ["Result", "Sample logistics"] },
      { key: "result", label: "Parameters & result", kind: "fields", sections: ["Result"] },
      { key: "logistics", label: "Sample logistics", kind: "fields", sections: ["Sample logistics"] },
    ],
  },

  products: {
    title: "Products",
    singular: "Product",
    icon: "package",
    idPrefix: "P-",
    label: "model",
    desc: "Category → Family → Model → SKU, with prices, tax and lead time.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Inactive", tone: "gray" },
    ],
    hasDocs: true,
    fields: [
      { key: "category", label: "Category", type: "select", options: ["Weighbridges", "Belt weighers", "Checkweighers", "Bagging & packing", "Conveyors", "Components", "Services"], required: true, section: "Hierarchy" },
      { key: "family", label: "Family", type: "text", required: true, section: "Hierarchy" },
      { key: "model", label: "Model", type: "text", required: true, section: "Hierarchy" },
      { key: "sku", label: "SKU", type: "text", required: true, section: "Hierarchy" },
      { key: "variant", label: "Variant", type: "text", section: "Hierarchy" },
      { key: "description", label: "Description", type: "textarea", section: "Hierarchy", full: true },
      { key: "uom", label: "UOM", type: "select", options: ["Nos", "Set", "Lot", "Metre", "Year"], section: "Commercial" },
      { key: "hsn", label: "HSN / SAC", type: "text", section: "Commercial" },
      { key: "gstRate", label: "GST rate %", type: "select", options: ["5", "12", "18", "28"], section: "Commercial" },
      { key: "price", label: "Standard price", type: "money", required: true, section: "Commercial" },
      { key: "minPrice", label: "Minimum selling price", type: "money", section: "Commercial", restricted: true },
      { key: "cost", label: "Standard cost", type: "money", section: "Commercial", restricted: true },
      { key: "leadTime", label: "Lead time", type: "text", section: "Commercial" },
      { key: "warrantyMonths", label: "Warranty (months)", type: "number", section: "Commercial" },
      { key: "status", label: "Status", type: "status", section: "Commercial" },
    ],
    cols: [
      { key: "sku", label: "SKU", type: "id" },
      { key: "model", label: "Model", type: "text", sub: "family" },
      { key: "category", label: "Category", type: "text" },
      { key: "price", label: "Std price", type: "money" },
      { key: "minPrice", label: "Min price", type: "money", restricted: true },
      { key: "leadTime", label: "Lead time", type: "text" },
      { key: "warrantyMonths", label: "Warranty", type: "num", suffix: " mo" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Deactivate", to: "Inactive", when: ["Active"], danger: true },
      { label: "Activate", to: "Active", when: ["Inactive"] },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields" },
      {
        key: "attrs",
        label: "Specification attributes",
        kind: "lines",
        lineColumns: [
          { key: "name", label: "Attribute", type: "text" },
          { key: "value", label: "Value", type: "text" },
        ],
      },
    ],
  },

  costing: {
    title: "Costing",
    singular: "Costing sheet",
    icon: "calculator",
    idPrefix: "CS-",
    label: "id",
    desc: "Internal cost build-up and margin check before quotation. Visible to Commercial, Sales Head and Director only.",
    statuses: [
      { value: "Draft", tone: "gray" },
      { value: "Submitted", tone: "blue" },
      { value: "Approval pending", tone: "amber" },
      { value: "Approved", tone: "green" },
      { value: "Rejected", tone: "red" },
    ],
    restricted: true,
    fields: [
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", required: true, section: "Sheet" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", section: "Sheet" },
      { key: "revision", label: "Revision", type: "number", section: "Sheet", readOnly: true },
      { key: "ownerId", label: "Prepared by", type: "owner", required: true, section: "Sheet" },
      { key: "approvedById", label: "Approved by", type: "owner", section: "Sheet", workflow: true },
      { key: "status", label: "Status", type: "status", section: "Sheet" },
      ...COST_COMPONENTS.map(([key, label]) => ({ key, label, type: "money" as const, section: "Cost components" })),
      { key: "sellingPrice", label: "Proposed selling price", type: "money", required: true, section: "Margin" },
      { key: "total", label: "Total cost", type: "money", section: "Margin", readOnly: true },
      { key: "gm", label: "Gross margin", type: "money", section: "Margin", readOnly: true },
      { key: "gmPct", label: "Margin %", type: "pct", section: "Margin", readOnly: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "opportunityId", label: "Opportunity", type: "ref", sub: "accountId" },
      { key: "revision", label: "Rev", type: "num" },
      { key: "total", label: "Total cost", type: "money" },
      { key: "sellingPrice", label: "Selling price", type: "money" },
      { key: "gmPct", label: "Margin", type: "marginpct" },
      { key: "ownerId", label: "Prepared by", type: "owner" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Submit", special: "submitCosting", when: ["Draft", "Rejected"], primary: true },
      { label: "Approve", to: "Approved", when: ["Approval pending", "Submitted"], primary: true },
      {
        label: "Reject",
        to: "Rejected",
        when: ["Approval pending", "Submitted"],
        danger: true,
        ask: { key: "rej", label: "Reason", type: "textarea", required: true },
      },
      { label: "New revision", special: "revise" },
    ],
    tabs: [
      { key: "breakdown", label: "Cost breakdown", kind: "table" },
      { key: "overview", label: "Sheet", kind: "fields", excludeSections: ["Cost components"] },
    ],
  },

  quotes: {
    title: "Quotations",
    singular: "Quotation",
    icon: "file-text",
    idPrefix: "QT-",
    label: "title",
    desc: "Versioned customer proposals. Issued versions are never overwritten.",
    statuses: [
      { value: "Draft", tone: "gray" },
      { value: "Approval pending", tone: "amber" },
      { value: "Approved", tone: "teal" },
      { value: "Sent", tone: "blue" },
      { value: "Revised", tone: "violet" },
      { value: "Accepted", tone: "green" },
      { value: "Rejected", tone: "red" },
      { value: "Expired", tone: "gray" },
    ],
    flow: ["Draft", "Approval pending", "Approved", "Sent", "Accepted"],
    hasDocs: true,
    fields: [
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", required: true, section: "Quotation" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Quotation" },
      { key: "documentNo", label: "Document no.", type: "text", section: "Quotation", readOnly: true },
      { key: "version", label: "Version", type: "number", section: "Quotation", readOnly: true },
      { key: "parent", label: "Revises", type: "ref", ref: "quotes", section: "Quotation", readOnly: true },
      { key: "quotationDate", label: "Quotation date", type: "date", required: true, section: "Quotation" },
      { key: "validUntil", label: "Valid until", type: "date", required: true, section: "Quotation" },
      { key: "currency", label: "Currency", type: "select", options: ["INR", "USD", "EUR"], section: "Quotation" },
      OWN,
      { key: "status", label: "Status", type: "status", section: "Ownership" },
      { key: "paymentTerms", label: "Payment terms", type: "select", options: ["30% advance, 60% before dispatch, 10% after installation", "100% advance", "50% advance, 50% before dispatch", "30 days credit", "60 days credit"], required: true, section: "Terms", full: true },
      { key: "deliveryTerms", label: "Delivery terms", type: "select", options: ["Ex-works", "FOR destination", "CIF"], section: "Terms" },
      { key: "deliveryTime", label: "Delivery time", type: "text", section: "Terms" },
      { key: "warranty", label: "Warranty", type: "text", section: "Terms" },
      { key: "freight", label: "Freight", type: "money", section: "Terms" },
      { key: "installation", label: "Installation & commissioning", type: "money", section: "Terms" },
      { key: "exclusions", label: "Exclusions", type: "textarea", section: "Terms", full: true },
      { key: "termsAndConditions", label: "Terms & conditions", type: "textarea", section: "Terms", full: true },
      { key: "total", label: "Grand total", type: "money", section: "Quotation", readOnly: true },
    ],
    cols: [
      { key: "id", label: "Quote", type: "id", sub: "version" },
      { key: "opportunityId", label: "Opportunity", type: "ref", sub: "accountId" },
      { key: "total", label: "Total", type: "money" },
      { key: "validUntil", label: "Valid until", type: "date" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "sla", label: "Follow-up SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Submit for approval", special: "submitQuote", when: ["Draft"], primary: true },
      { label: "Mark sent", to: "Sent", when: ["Approved"], primary: true },
      { label: "Revise → new version", special: "revise", when: ["Sent", "Approved", "Rejected", "Approval pending"] },
      { label: "Mark accepted", to: "Accepted", when: ["Sent"] },
      {
        label: "Mark rejected",
        to: "Rejected",
        when: ["Sent"],
        danger: true,
        ask: { key: "rej", label: "Rejection reason", type: "select", options: LOST, required: true },
      },
      { label: "Download PDF", special: "pdf" },
    ],
    tabs: [
      {
        key: "lines",
        label: "Line items",
        kind: "lines",
        lineColumns: [
          { key: "productId", label: "Product ID", type: "text" },
          { key: "description", label: "Description", type: "text" },
          { key: "qty", label: "Qty", type: "num" },
          { key: "unitPrice", label: "Unit price", type: "money" },
          { key: "discountPct", label: "Discount %", type: "num" },
          { key: "amount", label: "Amount", type: "money" },
        ],
      },
      { key: "terms", label: "Terms", kind: "fields", sections: ["Terms"] },
      { key: "overview", label: "Details", kind: "fields", excludeSections: ["Terms"] },
      { key: "versions", label: "Versions", kind: "events" },
      { key: "approvals", label: "Approvals", kind: "related", relatedModule: "approvals", foreignKey: "entity" },
      { key: "follow", label: "Follow-ups", kind: "related", relatedModule: "activities", foreignKey: "opp" },
    ],
  },

  approvals: {
    title: "Approvals",
    singular: "Approval",
    icon: "stamp",
    idPrefix: "AP-",
    label: "title",
    desc: "Discount, margin, payment-term and credit approvals, routed by the rules in Administration.",
    statuses: [
      { value: "Requested", tone: "blue" },
      { value: "Pending", tone: "amber" },
      { value: "Approved", tone: "green" },
      { value: "Rejected", tone: "red" },
      { value: "Returned for revision", tone: "violet" },
    ],
    fields: [
      { key: "title", label: "Request", type: "text", required: true, section: "Request", full: true },
      { key: "entityId", label: "Record", type: "text", required: true, section: "Request" },
      { key: "entityType", label: "Record type", type: "select", options: ["Quotation", "Costing", "PaymentTerms", "Credit"], required: true, section: "Request" },
      { key: "type", label: "Approval type", type: "select", options: ["Discount", "Margin", "PaymentTerms", "CreditTerms"], required: true, section: "Request" },
      { key: "requestedById", label: "Requested by", type: "owner", readOnly: true, section: "Request" },
      { key: "requested", label: "Requested on", type: "date", section: "Request", workflow: true },
      { key: "currentApprover", label: "Current approver", type: "select", options: ROLES, section: "Routing" },
      { key: "level", label: "Level", type: "number", section: "Routing", workflow: true },
      { key: "rule", label: "Matched rule", type: "text", section: "Routing", full: true, workflow: true },
      { key: "reason", label: "Reason for request", type: "textarea", section: "Request", full: true },
      { key: "approverComments", label: "Approver comments", type: "textarea", section: "Routing", full: true, editOnly: true },
      { key: "status", label: "Status", type: "status", section: "Routing" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "title", label: "Request", type: "text", sub: "entityId" },
      { key: "type", label: "Type", type: "pill", tones: { Discount: "amber", Margin: "red", PaymentTerms: "blue", CreditTerms: "violet" } },
      { key: "currentApprover", label: "Approver", type: "text", sub: "level" },
      { key: "requestedById", label: "Requested by", type: "owner" },
      { key: "sla", label: "Approval SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      {
        label: "Approve",
        to: "Approved",
        when: ["Pending", "Requested"],
        primary: true,
        ask: { key: "comments", label: "Comment (optional)", type: "textarea", required: false },
      },
      {
        label: "Return for revision",
        to: "Returned for revision",
        when: ["Pending", "Requested"],
        ask: { key: "comments", label: "What should change?", type: "textarea", required: true },
      },
      {
        label: "Reject",
        to: "Rejected",
        when: ["Pending", "Requested"],
        danger: true,
        ask: { key: "comments", label: "Reason", type: "textarea", required: true },
      },
    ],
    tabs: [
      { key: "overview", label: "Request", kind: "fields" },
      { key: "chain", label: "Approval chain", kind: "events" },
    ],
  },

  pos: {
    title: "Purchase orders",
    singular: "Purchase order",
    icon: "clipboard-check",
    idPrefix: "PO-",
    label: "poNo",
    desc: "Customer POs verified against the final quotation before acceptance.",
    statuses: [
      { value: "Received", tone: "blue" },
      { value: "Under verification", tone: "amber" },
      { value: "Clarification required", tone: "amber" },
      { value: "Accepted", tone: "green" },
      { value: "Rejected / cancelled", tone: "red" },
    ],
    hasDocs: true,
    fields: [
      { key: "poNo", label: "Customer PO no.", type: "text", required: true, section: "PO" },
      { key: "poDate", label: "PO date", type: "date", required: true, section: "PO" },
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", required: true, section: "PO" },
      { key: "quotationId", label: "Quotation", type: "ref", ref: "quotes", required: true, section: "PO" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "PO" },
      { key: "value", label: "PO value (incl. GST)", type: "money", required: true, section: "PO" },
      { key: "currency", label: "Currency", type: "select", options: ["INR", "USD", "EUR"], section: "PO" },
      { key: "deliveryDate", label: "Delivery date", type: "date", section: "PO" },
      { key: "paymentTerms", label: "Payment terms", type: "text", section: "PO", full: true },
      { key: "billingAddress", label: "Billing address", type: "textarea", section: "Addresses" },
      { key: "shippingAddress", label: "Shipping address", type: "textarea", section: "Addresses" },
      { key: "specialTerms", label: "Special terms", type: "textarea", section: "Addresses", full: true },
      { key: "qty", label: "Ordered quantity", type: "number", section: "PO" },
      { key: "products", label: "Ordered products (SKU / model)", type: "text", section: "PO", full: true },
      { key: "fileUrl", label: "Uploaded PO", type: "text", section: "PO" },
      OWN,
      { key: "status", label: "Status", type: "status", section: "Ownership" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "poNo", label: "Customer PO", type: "mono", sub: "accountId" },
      { key: "quotationId", label: "Quotation", type: "ref" },
      { key: "value", label: "Value", type: "money" },
      { key: "poDate", label: "PO date", type: "date" },
      { key: "sla", label: "Verification SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Start verification", to: "Under verification", when: ["Received", "Clarification required"] },
      {
        label: "Request clarification",
        to: "Clarification required",
        when: ["Under verification"],
        ask: { key: "clar", label: "Clarification to request", type: "textarea", required: true },
      },
      { label: "Accept PO", special: "acceptPo", when: ["Under verification", "Received", "Clarification required"], primary: true },
      {
        label: "Reject",
        to: "Rejected / cancelled",
        when: ["Received", "Under verification", "Clarification required"],
        danger: true,
        ask: { key: "rej", label: "Reason", type: "textarea", required: true },
      },
    ],
    tabs: [
      { key: "compare", label: "PO vs Quotation", kind: "table" },
      { key: "overview", label: "PO details", kind: "fields" },
    ],
  },

  sorders: {
    title: "Sales orders",
    singular: "Sales order",
    icon: "package-check",
    idPrefix: "SO-",
    label: "id",
    desc: "Accepted-order handover to operations, with execution milestones.",
    statuses: ORDER_FLOW.map((value, i) => ({ value, tone: orderFlowTone(i) })),
    flow: ORDER_FLOW,
    hasDocs: true,
    fields: [
      { key: "purchaseOrderId", label: "Purchase order", type: "ref", ref: "pos", section: "Order" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Order" },
      { key: "plant", label: "Plant", type: "text", section: "Order" },
      { key: "value", label: "Order value", type: "money", required: true, section: "Order" },
      { key: "committedDelivery", label: "Committed delivery", type: "date", required: true, section: "Order" },
      { key: "status", label: "Order status", type: "status", section: "Order" },
      { key: "products", label: "Final products / specs", type: "textarea", section: "Handover", full: true },
      { key: "drawingRef", label: "Approved drawing", type: "text", section: "Handover" },
      { key: "installScope", label: "Installation scope", type: "select", options: ["Our scope", "Customer scope", "Supervision only"], section: "Handover" },
      { key: "commissioningScope", label: "Commissioning scope", type: "select", options: ["Our scope", "Customer scope"], section: "Handover" },
      { key: "custContactId", label: "Customer contact", type: "ref", ref: "contacts", section: "Handover" },
      { key: "paymentTerms", label: "Payment terms", type: "text", section: "Handover", full: true },
      { key: "installStatus", label: "Installation status", type: "text", section: "Installation", workflow: true },
      { key: "installPlannedOn", label: "Installation planned", type: "date", section: "Installation", workflow: true },
      { key: "installedOn", label: "Installed on", type: "date", section: "Installation", workflow: true },
      { key: "signOffBy", label: "Customer sign-off by", type: "text", section: "Installation", workflow: true },
      { key: "signOffOn", label: "Sign-off date", type: "date", section: "Installation", workflow: true },
      { key: "paymentSummary", label: "Payment summary", type: "text", section: "Order", full: true, workflow: true },
      { key: "special", label: "Special instructions", type: "textarea", section: "Handover", full: true },
      { key: "ownerId", label: "Handover owner", type: "owner", required: true, section: "Handover" },
      { key: "ackStatus", label: "Operations acknowledgement", type: "select", options: ["Pending", "Acknowledged"], section: "Handover", workflow: true },
    ],
    cols: [
      { key: "id", label: "Order", type: "id", sub: "purchaseOrderId" },
      { key: "accountId", label: "Account", type: "ref" },
      { key: "value", label: "Value", type: "money" },
      { key: "committedDelivery", label: "Committed", type: "date" },
      { key: "ackStatus", label: "Ops ack", type: "pill", tones: { Pending: "amber", Acknowledged: "green" } },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "sla", label: "Delivery risk", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Acknowledge handover", special: "ack", primary: true },
      { label: "Advance status", special: "advance", notWhen: ["Closed"] },
      { label: "Send back for rework", when: ["Quality check"], to: "Production", ask: { key: "reason", label: "What needs rework?", type: "textarea", required: true } },
      { label: "Create dispatch", special: "createDispatch" },
      { label: "Plan installation", when: ["Delivered", "Installation", "Commissioned"], ask: { key: "date", label: "Planned installation date", type: "date", required: true } },
      { label: "Start installation", when: ["Delivered", "Installation", "Commissioned"] },
      { label: "Mark installed", when: ["Delivered", "Installation", "Commissioned"] },
      { label: "Request sign-off", when: ["Delivered", "Installation", "Commissioned"] },
      { label: "Customer sign-off", when: ["Delivered", "Installation", "Commissioned"], ask: { key: "by", label: "Signed off by (customer name)", type: "text", required: true } },
      { label: "Commissioning report", special: "pdf", when: ["Installation", "Commissioned", "Closed"] },
    ],
    tabs: [
      { key: "handover", label: "Handover", kind: "fields" },
      { key: "milestones", label: "Milestones", kind: "events" },
      { key: "dispatch", label: "Dispatches", kind: "related", relatedModule: "dispatch", foreignKey: "so" },
      { key: "payments", label: "Payments", kind: "related", relatedModule: "payments", foreignKey: "so" },
      { key: "assets", label: "Installed assets", kind: "related", relatedModule: "assets", foreignKey: "so" },
    ],
  },

  dispatch: {
    title: "Dispatch",
    singular: "Dispatch",
    icon: "truck",
    idPrefix: "DS-",
    label: "id",
    desc: "Shipments, invoices and transport details, including partial dispatches.",
    statuses: [
      { value: "Planned", tone: "gray" },
      { value: "Dispatched", tone: "blue" },
      { value: "In transit", tone: "amber" },
      { value: "Delivered", tone: "green" },
    ],
    hasDocs: true,
    fields: [
      { key: "salesOrderId", label: "Sales order", type: "ref", ref: "sorders", required: true, section: "Shipment" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Shipment" },
      { key: "invoiceNo", label: "Invoice no.", type: "text", section: "Shipment" },
      { key: "invoiceDate", label: "Invoice date", type: "date", section: "Shipment" },
      { key: "dispatchDate", label: "Dispatch date", type: "date", required: true, section: "Shipment" },
      { key: "qty", label: "Quantity", type: "text", section: "Shipment" },
      { key: "partial", label: "Partial dispatch", type: "bool", section: "Shipment" },
      { key: "status", label: "Status", type: "status", section: "Shipment" },
      { key: "transporter", label: "Transporter", type: "text", section: "Transport" },
      { key: "lrNumber", label: "LR / AWB", type: "text", section: "Transport" },
      { key: "vehicleNo", label: "Vehicle no.", type: "text", section: "Transport" },
      { key: "ewayBill", label: "E-way bill", type: "text", section: "Transport" },
      { key: "expectedDelivery", label: "Expected delivery", type: "date", section: "Transport" },
      { key: "actual", label: "Actual delivery", type: "date", section: "Transport", workflow: true },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "salesOrderId", label: "Order", type: "ref", sub: "accountId" },
      { key: "invoiceNo", label: "Invoice", type: "mono" },
      { key: "transporter", label: "Transporter", type: "text" },
      { key: "dispatchDate", label: "Dispatched", type: "date" },
      { key: "expectedDelivery", label: "Expected", type: "date" },
      { key: "sla", label: "Delivery SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Mark dispatched", to: "Dispatched", when: ["Planned"], primary: true },
      { label: "In transit", to: "In transit", when: ["Dispatched"] },
      {
        label: "Mark delivered",
        to: "Delivered",
        when: ["Dispatched", "In transit"],
        primary: true,
        ask: { key: "actual", label: "Delivered on", type: "date", required: true },
      },
    ],
    tabs: [
      { key: "overview", label: "Shipment", kind: "fields" },
    ],
  },

  payments: {
    title: "Payments",
    singular: "Payment milestone",
    icon: "credit-card",
    idPrefix: "PM-",
    label: "milestone",
    desc: "Milestone dues, receipts and overdue follow-up per order. Accounting stays the source of truth.",
    statuses: [
      { value: "Not due", tone: "gray" },
      { value: "Due", tone: "amber" },
      { value: "Partially received", tone: "blue" },
      { value: "Received", tone: "green" },
      { value: "Overdue", tone: "red" },
    ],
    fields: [
      { key: "salesOrderId", label: "Sales order", type: "ref", ref: "sorders", required: true, section: "Milestone" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Milestone" },
      { key: "milestone", label: "Milestone", type: "select", options: ["Advance", "Before dispatch", "After delivery", "After installation", "Retention"], required: true, section: "Milestone" },
      { key: "pct", label: "Percentage", type: "pct", section: "Milestone" },
      { key: "amount", label: "Amount", type: "money", required: true, section: "Milestone" },
      { key: "dueDate", label: "Due date", type: "date", required: true, section: "Milestone" },
      { key: "invoiceRef", label: "Invoice ref.", type: "text", section: "Milestone" },
      { key: "status", label: "Status", type: "status", section: "Milestone" },
      { key: "received", label: "Received amount", type: "money", section: "Receipt", workflow: true },
      { key: "receivedDate", label: "Received on", type: "date", section: "Receipt", workflow: true },
      { key: "balance", label: "Balance", type: "money", section: "Receipt", readOnly: true },
      { key: "accountsOwnerId", label: "Accounts owner", type: "owner", section: "Receipt" },
      { key: "ownerId", label: "Sales owner", type: "owner", required: true, section: "Receipt" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "accountId", label: "Account", type: "ref", sub: "milestone" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "received", label: "Received", type: "money" },
      { key: "balance", label: "Balance", type: "money" },
      { key: "dueDate", label: "Due", type: "date" },
      { key: "sla", label: "Collection SLA", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      {
        label: "Record receipt",
        special: "receipt",
        notWhen: ["Received"],
        primary: true,
        ask: { key: "amt", label: "Amount received (₹)", type: "money", required: true },
      },
      { label: "Send reminder", special: "remind", notWhen: ["Received"] },
    ],
    tabs: [
      { key: "overview", label: "Milestone", kind: "fields" },
      { key: "esc", label: "Reminders & escalations", kind: "events" },
    ],
  },

  assets: {
    title: "Installed assets",
    singular: "Installed asset",
    icon: "cpu",
    idPrefix: "AS-",
    label: "serial",
    desc: "Serial-level installed base, created automatically on commissioning.",
    statuses: [
      { value: "Under warranty", tone: "teal" },
      { value: "Under AMC", tone: "green" },
      { value: "Out of coverage", tone: "amber" },
      { value: "Decommissioned", tone: "gray" },
    ],
    fields: [
      { key: "serial", label: "Serial no.", type: "text", required: true, section: "Asset" },
      { key: "model", label: "Product / model", type: "text", required: true, section: "Asset" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Asset" },
      { key: "plant", label: "Plant", type: "text", section: "Asset" },
      { key: "location", label: "Location", type: "text", section: "Asset" },
      { key: "salesOrderId", label: "Parent order", type: "ref", ref: "sorders", section: "Asset" },
      { key: "status", label: "Coverage status", type: "status", section: "Asset" },
      { key: "installedOn", label: "Installed on", type: "date", section: "Lifecycle" },
      { key: "commissionedOn", label: "Commissioned on", type: "date", section: "Lifecycle" },
      { key: "warrantyStart", label: "Warranty start", type: "date", section: "Lifecycle" },
      { key: "warrantyEnd", label: "Warranty end", type: "date", section: "Lifecycle" },
      { key: "customerSignoff", label: "Customer sign-off", type: "select", options: ["Pending", "Signed"], section: "Lifecycle" },
    ],
    cols: [
      { key: "serial", label: "Serial", type: "id" },
      { key: "model", label: "Model", type: "text", sub: "accountId" },
      { key: "plant", label: "Plant", type: "text" },
      { key: "commissionedOn", label: "Commissioned", type: "date" },
      { key: "warrantyEnd", label: "Warranty end", type: "date" },
      { key: "status", label: "Coverage", type: "status" },
    ],
    actions: [
      { label: "Raise service ticket", special: "raiseTicket", primary: true },
      { label: "Create AMC renewal", special: "createAmc" },
      {
        label: "Set coverage status",
        ask: { key: "status", label: "Coverage status", type: "select", options: ["Under warranty", "Under AMC", "Out of coverage", "Decommissioned"], required: true },
      },
    ],
    tabs: [
      { key: "overview", label: "Asset", kind: "fields" },
      { key: "coverage", label: "Coverage", kind: "related", relatedModule: "amc", foreignKey: "asset" },
      { key: "service", label: "Service history", kind: "related", relatedModule: "service", foreignKey: "asset" },
    ],
  },

  amc: {
    title: "AMC & warranty",
    singular: "Coverage",
    icon: "shield-check",
    idPrefix: "CV-",
    label: "id",
    desc: "Warranty and AMC coverage with renewal reminders at 90 / 60 / 30 days.",
    statuses: [
      { value: "Not due", tone: "gray" },
      { value: "Due soon", tone: "amber" },
      { value: "Contacted", tone: "blue" },
      { value: "Quoted", tone: "blue" },
      { value: "Negotiation", tone: "teal" },
      { value: "Renewed", tone: "green" },
      { value: "Lost", tone: "red" },
    ],
    fields: [
      { key: "assetId", label: "Asset", type: "ref", ref: "assets", required: true, section: "Coverage" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Coverage" },
      { key: "type", label: "Coverage type", type: "select", options: ["Warranty", "AMC", "CMC", "Paid service"], required: true, section: "Coverage" },
      { key: "start", label: "Start", type: "date", required: true, section: "Coverage" },
      { key: "end", label: "End", type: "date", required: true, section: "Coverage" },
      { key: "value", label: "AMC value", type: "money", section: "Coverage" },
      { key: "visitsIncluded", label: "Visits included", type: "number", section: "Coverage" },
      { key: "visitsUsed", label: "Visits used", type: "number", section: "Coverage" },
      { key: "terms", label: "Terms", type: "textarea", section: "Coverage", full: true },
      { key: "ownerId", label: "Renewal owner", type: "owner", required: true, section: "Renewal" },
      { key: "renewalOpportunityId", label: "Renewal opportunity", type: "ref", ref: "opps", section: "Renewal" },
      { key: "status", label: "Renewal status", type: "status", section: "Renewal" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "assetId", label: "Asset", type: "ref", sub: "accountId" },
      { key: "type", label: "Type", type: "pill", tones: { Warranty: "teal", AMC: "green", CMC: "blue", "Paid service": "gray" } },
      { key: "end", label: "Ends", type: "date" },
      { key: "visits", label: "Visits", type: "mono" },
      { key: "value", label: "Value", type: "money" },
      { key: "sla", label: "Renewal reminder", type: "sla" },
      { key: "status", label: "Renewal", type: "status" },
    ],
    actions: [
      { label: "Mark contacted", to: "Contacted", when: ["Not due", "Due soon"] },
      { label: "Mark quoted", to: "Quoted", when: ["Contacted"] },
      { label: "Start negotiation", to: "Negotiation", when: ["Quoted"] },
      { label: "Create renewal opportunity", special: "renewalOpp", when: ["Due soon", "Contacted"], primary: true },
      { label: "Mark renewed", to: "Renewed", when: ["Quoted", "Negotiation"] },
      {
        label: "Mark lost",
        to: "Lost",
        notWhen: ["Renewed", "Lost"],
        danger: true,
        ask: { key: "lost", label: "Reason", type: "select", options: LOST, required: true },
      },
    ],
    tabs: [
      { key: "overview", label: "Coverage", kind: "fields" },
      { key: "reminders", label: "Renewal reminders", kind: "events" },
    ],
  },

  service: {
    title: "Service tickets",
    singular: "Service ticket",
    icon: "wrench",
    idPrefix: "ST-",
    label: "description",
    desc: "Breakdowns, calibrations and preventive visits against installed equipment.",
    statuses: [
      { value: "Open", tone: "blue" },
      { value: "Assigned", tone: "teal" },
      { value: "Visit scheduled", tone: "teal" },
      { value: "In progress", tone: "amber" },
      { value: "Parts required", tone: "amber" },
      { value: "Resolved", tone: "green" },
      { value: "Customer confirmation", tone: "violet" },
      { value: "Closed", tone: "gray" },
    ],
    flow: ["Open", "Assigned", "Visit scheduled", "In progress", "Resolved", "Customer confirmation", "Closed"],
    fields: [
      { key: "description", label: "Complaint", type: "text", required: true, section: "Ticket", full: true },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", required: true, section: "Ticket" },
      { key: "plant", label: "Plant", type: "text", section: "Ticket" },
      { key: "assetId", label: "Asset", type: "ref", ref: "assets", section: "Ticket" },
      { key: "complaintType", label: "Complaint type", type: "select", options: ["Breakdown", "Calibration", "Preventive maintenance", "Installation issue", "Software / integration"], required: true, section: "Ticket" },
      { key: "priority", label: "Priority", type: "select", options: ["Critical", "High", "Medium", "Low"], required: true, section: "Ticket" },
      { key: "created", label: "Created", type: "date", section: "Ticket", readOnly: true },
      { key: "coverage", label: "Coverage", type: "select", options: ["In warranty", "Under AMC", "Chargeable"], section: "Ticket" },
      { key: "status", label: "Status", type: "status", section: "Ticket" },
      { key: "engineer", label: "Assigned engineer", type: "owner", section: "Work", workflow: true },
      { key: "responseDue", label: "Response due", type: "text", section: "Work" },
      { key: "visitDate", label: "Visit date", type: "date", section: "Work", workflow: true },
      { key: "diagnosis", label: "Diagnosis", type: "textarea", section: "Work", full: true },
      { key: "parts", label: "Parts required", type: "text", section: "Work", workflow: true },
      { key: "action", label: "Action taken", type: "textarea", section: "Work", full: true },
      { key: "resolution", label: "Resolution", type: "textarea", section: "Work", full: true, workflow: true },
      { key: "customerConfirmation", label: "Customer confirmation", type: "select", options: ["Pending", "Confirmed"], section: "Work" },
      { key: "chargeable", label: "Chargeable", type: "bool", section: "Work" },
    ],
    cols: [
      { key: "id", label: "Ticket", type: "id" },
      { key: "description", label: "Complaint", type: "text", sub: "accountId" },
      { key: "priority", label: "Priority", type: "pill", tones: { Critical: "red", High: "amber", Medium: "blue", Low: "gray" } },
      { key: "engineer", label: "Engineer", type: "owner" },
      { key: "sla", label: "Response / resolution", type: "sla" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      {
        label: "Assign engineer",
        to: "Assigned",
        when: ["Open"],
        primary: true,
        ask: { key: "engineer", label: "Engineer", type: "owner", required: true },
      },
      {
        label: "Schedule visit",
        to: "Visit scheduled",
        when: ["Assigned"],
        ask: { key: "visitDate", label: "Visit date", type: "date", required: true },
      },
      { label: "Start work", to: "In progress", when: ["Visit scheduled", "Assigned", "Parts required"] },
      {
        label: "Parts required",
        to: "Parts required",
        when: ["In progress"],
        ask: { key: "parts", label: "Parts", type: "text", required: true },
      },
      {
        label: "Resolve",
        to: "Resolved",
        when: ["In progress"],
        primary: true,
        ask: { key: "resolution", label: "Resolution", type: "textarea", required: true },
      },
      { label: "Request confirmation", to: "Customer confirmation", when: ["Resolved"] },
      { label: "Close", to: "Closed", when: ["Customer confirmation", "Resolved"] },
    ],
    tabs: [
      { key: "overview", label: "Ticket", kind: "fields", excludeSections: ["Work"] },
      { key: "work", label: "Work log", kind: "fields", sections: ["Work"] },
    ],
  },

  reports: {
    title: "Reports",
    singular: "Report",
    icon: "chart-column",
    idPrefix: "R-",
    label: "name",
    desc: "Standard reports with filters, export and scheduled email delivery.",
    statusKey: "scheduleFrequency",
    statuses: [
      { value: "Not scheduled", tone: "gray" },
      { value: "Daily", tone: "teal" },
      { value: "Weekly", tone: "teal" },
      { value: "Monthly", tone: "teal" },
    ],
    noCreate: true,
    fields: [
      { key: "name", label: "Report", type: "text", required: true, section: "Report", full: true },
      { key: "category", label: "Category", type: "select", options: ["Leads", "Pipeline", "Performance", "Quotes & orders", "Sales", "Finance", "After-sales", "Operations"], required: true, section: "Report" },
      { key: "ownerId", label: "Owner", type: "owner", section: "Report" },
      { key: "dateRange", label: "Date range", type: "select", options: ["This month", "Last month", "This quarter", "This financial year", "Custom"], section: "Filters" },
      { key: "team", label: "Owner / team", type: "select", options: ["All teams", "South team", "West team", "North & Central team"], section: "Filters" },
      { key: "region", label: "Region", type: "select", options: ["All", ...TERR], section: "Filters" },
      { key: "product", label: "Product", type: "select", options: ["All", ...PRODUCTS], section: "Filters" },
      { key: "industry", label: "Industry", type: "select", options: ["All", ...INDUSTRIES], section: "Filters" },
      { key: "source", label: "Source", type: "select", options: ["All", ...SOURCES], section: "Filters" },
      { key: "scheduleFrequency", label: "Frequency", type: "select", options: ["Not scheduled", "Daily", "Weekly", "Monthly"], section: "Schedule" },
      { key: "sendAt", label: "Send at", type: "text", section: "Schedule" },
      { key: "recipients", label: "Recipients", type: "text", section: "Schedule", full: true },
      { key: "format", label: "Format", type: "select", options: ["Excel", "CSV", "PDF"], section: "Schedule" },
      { key: "lastRunAt", label: "Last run", type: "date", readOnly: true, section: "Schedule" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "name", label: "Report", type: "text", sub: "category" },
      { key: "lastRunAt", label: "Last run", type: "date" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "scheduleFrequency", label: "Schedule", type: "status" },
    ],
    actions: [
      { label: "Export Excel", special: "export" },
      { label: "Export PDF", special: "pdf" },
    ],
    tabs: [
      { key: "data", label: "Report", kind: "table" },
      { key: "filters", label: "Filters", kind: "fields", sections: ["Filters"] },
      { key: "schedule", label: "Schedule", kind: "fields", sections: ["Schedule"] },
    ],
  },

  nurturing: {
    title: "Nurturing",
    singular: "Sequence",
    icon: "zap",
    idPrefix: "NS-",
    label: "name",
    desc: "Stage-triggered follow-up sequences across email and WhatsApp.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Paused", tone: "amber" },
      { value: "Draft", tone: "gray" },
    ],
    fields: [
      { key: "name", label: "Sequence", type: "text", required: true, section: "Sequence", full: true },
      { key: "trigger", label: "Trigger", type: "select", options: ["Lead created", "Lead moved to Nurture", "Quotation sent", "Opportunity lost (postponed)", "AMC 90 days to expiry"], required: true, section: "Sequence" },
      { key: "channel", label: "Channels", type: "select", options: ["Email", "WhatsApp", "Email + WhatsApp"], section: "Sequence" },
      { key: "steps", label: "Steps", type: "number", section: "Sequence" },
      { key: "enrolled", label: "Enrolled", type: "number", section: "Sequence", readOnly: true },
      OWN,
      { key: "status", label: "Status", type: "status", section: "Ownership" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "name", label: "Sequence", type: "text", sub: "trigger" },
      { key: "channel", label: "Channels", type: "text" },
      { key: "steps", label: "Steps", type: "num" },
      { key: "enrolled", label: "Enrolled", type: "num" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Pause", to: "Paused", when: ["Active"] },
      { label: "Activate", to: "Active", when: ["Paused", "Draft"], primary: true },
    ],
    tabs: [
      { key: "overview", label: "Sequence", kind: "fields" },
      { key: "steps", label: "Steps", kind: "events" },
    ],
  },

  templates: {
    title: "Templates",
    singular: "Template",
    icon: "mail",
    idPrefix: "TP-",
    label: "name",
    desc: "Approved email and WhatsApp templates used by sequences and automations.",
    statuses: [
      { value: "Approved", tone: "green" },
      { value: "Pending approval", tone: "amber" },
      { value: "Draft", tone: "gray" },
      { value: "Rejected", tone: "red" },
    ],
    fields: [
      { key: "name", label: "Template", type: "text", required: true, section: "Template", full: true },
      { key: "channel", label: "Channel", type: "select", options: ["Email", "WhatsApp", "SMS"], required: true, section: "Template" },
      { key: "category", label: "Category", type: "select", options: ["Enquiry", "Quotation", "Order", "Payment", "Service", "AMC"], section: "Template" },
      { key: "subject", label: "Subject", type: "text", section: "Template", full: true },
      { key: "body", label: "Body", type: "textarea", required: true, section: "Template", full: true },
      { key: "status", label: "Status", type: "status", section: "Template" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "name", label: "Template", type: "text", sub: "category" },
      { key: "channel", label: "Channel", type: "pill", tones: { Email: "blue", WhatsApp: "green", SMS: "gray" } },
      { key: "status", label: "Status", type: "status" },
    ],
    tabs: [
      { key: "overview", label: "Content", kind: "fields" },
    ],
  },

  team: {
    title: "Team",
    singular: "User",
    icon: "users",
    idPrefix: "U-",
    label: "name",
    desc: "Users, roles, reporting lines and record access.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Invited", tone: "amber" },
      { value: "Deactivated", tone: "gray" },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, section: "User" },
      { key: "email", label: "Email", type: "text", required: true, section: "User" },
      { key: "role", label: "Role", type: "select", options: ROLES, required: true, section: "User" },
      { key: "team", label: "Team", type: "select", options: ["Management", "South team", "West team", "North & Central team", "Engineering", "Service", "Accounts"], section: "User" },
      { key: "territory", label: "Territory", type: "select", options: ["All", ...TERR], section: "User" },
      { key: "manager", label: "Reports to", type: "owner", section: "User" },
      { key: "access", label: "Record access", type: "select", options: ["Own records", "Team records", "Region records", "All records"], section: "User" },
      { key: "status", label: "Status", type: "status", section: "User" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "name", label: "Name", type: "text", sub: "email" },
      { key: "role", label: "Role", type: "text" },
      { key: "team", label: "Team", type: "text" },
      { key: "access", label: "Access", type: "text" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Deactivate", to: "Deactivated", when: ["Active"], danger: true },
      { label: "Reactivate", to: "Active", when: ["Deactivated"] },
      { label: "Resend invite", special: "remind", when: ["Invited"] },
    ],
    tabs: [
      { key: "overview", label: "Profile", kind: "fields" },
      { key: "opps", label: "Owned opportunities", kind: "related", relatedModule: "opps", foreignKey: "owner" },
    ],
  },

  integrations: {
    title: "Integrations",
    singular: "Integration",
    icon: "link-2",
    idPrefix: "IN-",
    label: "name",
    desc: "Lead sources, communication and ERP connections — with dedupe and retry logs.",
    statuses: [
      { value: "Connected", tone: "green" },
      { value: "Not connected", tone: "gray" },
      { value: "Error", tone: "red" },
    ],
    noCreate: true,
    fields: [
      { key: "name", label: "Integration", type: "text", required: true, section: "Connection" },
      { key: "category", label: "Category", type: "select", options: ["Lead sources", "Communication", "ERP & accounting", "Calendar"], section: "Connection" },
      { key: "lastSync", label: "Last sync", type: "text", section: "Connection", readOnly: true },
      { key: "synced", label: "Records synced (30d)", type: "number", section: "Connection", readOnly: true },
      { key: "dupes", label: "Duplicates skipped (30d)", type: "number", section: "Connection", readOnly: true },
      { key: "status", label: "Status", type: "status", section: "Connection" },
    ],
    cols: [
      { key: "id", label: "ID", type: "id" },
      { key: "name", label: "Integration", type: "text", sub: "category" },
      { key: "lastSync", label: "Last sync", type: "text" },
      { key: "synced", label: "Synced (30d)", type: "num" },
      { key: "dupes", label: "Dupes skipped", type: "num" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Connect", to: "Connected", when: ["Not connected"], primary: true },
      { label: "Retry failed", special: "retry", when: ["Error"], primary: true },
      { label: "Disconnect", to: "Not connected", when: ["Connected", "Error"], danger: true },
    ],
    tabs: [
      { key: "overview", label: "Settings", kind: "fields" },
      { key: "log", label: "Sync log", kind: "events" },
    ],
  },

  billing: {
    title: "Billing",
    singular: "Invoice",
    icon: "receipt",
    idPrefix: "INV-",
    label: "period",
    desc: "Your GenX CRM subscription: plan, seats and invoices.",
    noCreate: true,
    statuses: [
      { value: "Paid", tone: "green" },
      { value: "Due", tone: "amber" },
      { value: "Failed", tone: "red" },
    ],
    fields: [
      { key: "period", label: "Period", type: "text", section: "Invoice" },
      { key: "plan", label: "Plan", type: "text", section: "Invoice" },
      { key: "seats", label: "Seats", type: "number", section: "Invoice" },
      { key: "amount", label: "Amount", type: "money", section: "Invoice" },
      { key: "paidOn", label: "Paid on", type: "date", section: "Invoice" },
      { key: "status", label: "Status", type: "status", section: "Invoice" },
    ],
    cols: [
      { key: "id", label: "Invoice", type: "id" },
      { key: "period", label: "Period", type: "text" },
      { key: "plan", label: "Plan", type: "text" },
      { key: "seats", label: "Seats", type: "num" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Download invoice", special: "pdf" },
    ],
    tabs: [
      { key: "overview", label: "Invoice", kind: "fields" },
    ],
  },

  // ---------------------------------------------------------------------------
  // Administration > Manufacturing config modules (Phase 5). List-and-drawer
  // only — no detail page/tabs, since these are flat config records edited
  // inline from Administration, not workflow entities with their own SLA/audit
  // surfaces. Field keys match the backend DTOs in backend/src/modules/<name>
  // exactly (see manufacturing-defaults.data.ts for the seeded defaults).
  // ---------------------------------------------------------------------------

  approvalRules: {
    title: "Approval rules",
    singular: "Approval rule",
    icon: "shield-check",
    idPrefix: "AR-",
    label: "type",
    desc: "Discount, margin and credit-term thresholds that route approvals.",
    statuses: [{ value: "Active", tone: "gray" }], // config record; no real lifecycle, kept non-empty for the list-chip invariant
    fields: [
      { key: "type", label: "Type", type: "select", options: ["Discount", "Margin", "PaymentTerms", "CreditTerms"], required: true },
      { key: "min", label: "Min", type: "number", required: true },
      { key: "max", label: "Max", type: "number", required: true },
      { key: "approverRole", label: "Approver", type: "text", required: true },
    ],
    cols: [
      { key: "type", label: "Type", type: "text" },
      { key: "min", label: "Min", type: "num" },
      { key: "max", label: "Max", type: "num" },
      { key: "approverRole", label: "Approver", type: "text" },
    ],
    tabs: [],
  },

  automationRules: {
    title: "Automation rules",
    singular: "Automation rule",
    icon: "zap",
    idPrefix: "AU-",
    label: "trigger",
    desc: "Trigger / condition / action rules, with their last-run status.",
    statuses: [
      { value: "OK", tone: "green" },
      { value: "Failed", tone: "red" },
    ],
    statusKey: "lastRunStatus",
    fields: [
      { key: "trigger", label: "When this happens", type: "select", options: ["Lead created", "Quotation sent", "Opportunity lost", "PO accepted", "Payment overdue", "Service ticket created"], required: true },
      { key: "condition", label: "Only if (Always, or Value >= 100000)", type: "text", required: true },
      { key: "action", label: "Do this (Notify owner · Notify role: Sales Manager · Create task: Call the customer)", type: "text", required: true, full: true },
    ],
    cols: [
      { key: "trigger", label: "Trigger", type: "text" },
      { key: "condition", label: "Condition", type: "text" },
      { key: "action", label: "Action", type: "text" },
      { key: "lastRunStatus", label: "Last run", type: "status" },
    ],
    actions: [
      { label: "Deactivate" },
      { label: "Activate" },
    ],
    tabs: [{ key: "overview", label: "Overview", kind: "fields" }, { key: "runs", label: "Run history", kind: "events" }],
  },

  masters: {
    title: "Masters",
    singular: "Master value",
    icon: "list",
    idPrefix: "MV-",
    label: "label",
    desc: "The 13 master lists (sources, stages, industries, etc.) used across every module.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Inactive", tone: "gray" },
    ],
    fields: [
      { key: "category", label: "Category", type: "text", required: true },
      { key: "value", label: "Value", type: "text", required: true },
      { key: "label", label: "Label", type: "text", required: true },
      { key: "numericValue", label: "Number (e.g. probability/%)", type: "number" },
      { key: "sortOrder", label: "Sort order", type: "number" },
    ],
    cols: [
      { key: "category", label: "Category", type: "text" },
      { key: "label", label: "Label", type: "text" },
      { key: "numericValue", label: "Number", type: "num" },
      { key: "status", label: "Status", type: "status" },
    ],
    tabs: [],
  },

  holidays: {
    title: "Holidays",
    singular: "Holiday",
    icon: "calendar-off",
    idPrefix: "HOL-",
    label: "name",
    desc: "Dates the business calendar treats as closed for Business-hours SLAs.",
    statuses: [{ value: "Active", tone: "gray" }], // config record; no real lifecycle, kept non-empty for the list-chip invariant
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "name", label: "Name", type: "text", required: true },
    ],
    cols: [
      { key: "date", label: "Date", type: "date" },
      { key: "name", label: "Name", type: "text" },
    ],
    tabs: [],
  },

  docTemplates: {
    title: "Document templates",
    singular: "Document template",
    icon: "file-text",
    idPrefix: "DT-",
    label: "name",
    desc: "Numbering patterns for quotations, purchase orders and other generated documents.",
    statuses: [{ value: "Active", tone: "gray" }], // config record; no real lifecycle, kept non-empty for the list-chip invariant
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "numberingPattern", label: "Numbering pattern ({YYYY} {YY} {MM} {SEQ} or {####})", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea", full: true },
    ],
    cols: [
      { key: "name", label: "Name", type: "text" },
      { key: "numberingPattern", label: "Pattern", type: "mono" },
    ],
    tabs: [],
  },

  dealers: {
    title: "Dealers",
    singular: "Dealer",
    icon: "building-2",
    idPrefix: "DL-",
    label: "name",
    desc: "Channel partners, the deals they register, and how they perform.",
    statuses: [
      { value: "Active", tone: "green" },
      { value: "Inactive", tone: "gray" },
    ],
    dupKeys: ["name"],
    fields: [
      { key: "name", label: "Dealer name", type: "text", required: true, section: "Dealer" },
      { key: "territory", label: "Territory", type: "text", required: true, section: "Dealer" },
      { key: "contactName", label: "Contact person", type: "text", section: "Dealer" },
      { key: "phone", label: "Phone", type: "text", section: "Dealer" },
      { key: "email", label: "Email", type: "text", section: "Dealer" },
      { key: "gstin", label: "GSTIN", type: "text", section: "Dealer" },
      { key: "commission", label: "Commission (%)", type: "number", section: "Dealer" },
      { key: "ownerId", label: "Relationship owner", type: "owner", section: "Ownership" },
      { key: "status", label: "Status", type: "status", section: "Ownership" },
      { key: "dealsRegistered", label: "Deals registered", type: "number", section: "Performance", readOnly: true, workflow: true },
      { key: "dealsWon", label: "Deals won", type: "number", section: "Performance", readOnly: true, workflow: true },
      { key: "wonValue", label: "Won value", type: "money", section: "Performance", readOnly: true, workflow: true },
    ],
    cols: [
      { key: "name", label: "Dealer", type: "text", sub: "territory" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "dealsRegistered", label: "Registered", type: "num" },
      { key: "dealsWon", label: "Won", type: "num" },
      { key: "wonValue", label: "Won value", type: "money" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Mark deal won", when: ["Active"], ask: { key: "customer", label: "Customer of the registered deal", type: "text", required: true } },
      { label: "Mark deal lost", when: ["Active"], ask: { key: "customer", label: "Customer of the registered deal", type: "text", required: true } },
      { label: "Deactivate", to: "Inactive", when: ["Active"], danger: true },
      { label: "Activate", to: "Active", when: ["Inactive"] },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields" },
      {
        key: "deals",
        label: "Registered deals",
        kind: "table",
        rowLabel: "deal",
        rowFields: [
          { key: "customer", label: "Customer", type: "text", required: true },
          { key: "product", label: "Product", type: "text", required: true },
          { key: "value", label: "Expected value (INR)", type: "text", required: true },
        ],
      },
    ],
  },

  tenders: {
    title: "Tenders",
    singular: "Tender",
    icon: "file-spreadsheet",
    idPrefix: "TN-",
    label: "title",
    desc: "Government and PSU tenders with deadlines, EMD and a submission checklist.",
    statuses: [
      { value: "Identified", tone: "blue" },
      { value: "Preparing", tone: "amber" },
      { value: "Submitted", tone: "teal" },
      { value: "Won", tone: "green" },
      { value: "Lost", tone: "red" },
      { value: "Withdrawn", tone: "gray" },
    ],
    flow: ["Identified", "Preparing", "Submitted", "Won"],
    dupKeys: ["tenderNo"],
    fields: [
      { key: "title", label: "Tender title", type: "text", required: true, section: "Tender" },
      { key: "tenderNo", label: "Tender number", type: "text", required: true, section: "Tender" },
      { key: "authority", label: "Issuing authority", type: "text", required: true, section: "Tender" },
      { key: "accountId", label: "Account", type: "ref", ref: "accounts", section: "Tender" },
      { key: "opportunityId", label: "Opportunity", type: "ref", ref: "opps", section: "Tender" },
      { key: "estimatedValue", label: "Estimated value", type: "money", required: true, section: "Tender" },
      { key: "publishedOn", label: "Published on", type: "date", section: "Dates" },
      { key: "submissionDeadline", label: "Submission deadline", type: "date", required: true, section: "Dates" },
      { key: "openingDate", label: "Bid opening", type: "date", section: "Dates" },
      { key: "emdAmount", label: "EMD amount", type: "money", section: "EMD" },
      { key: "emdStatus", label: "EMD status", type: "text", section: "EMD", workflow: true },
      { key: "docsReady", label: "Documents ready", type: "bool", section: "Checklist" },
      { key: "technicalBidReady", label: "Technical bid ready", type: "bool", section: "Checklist" },
      { key: "financialBidReady", label: "Financial bid ready", type: "bool", section: "Checklist" },
      { key: "preBidAttended", label: "Pre-bid meeting attended", type: "bool", section: "Checklist" },
      { key: "outcomeNote", label: "Outcome note", type: "textarea", full: true, section: "Outcome", workflow: true },
      { key: "ownerId", label: "Owner", type: "owner", section: "Ownership" },
      { key: "status", label: "Status", type: "status", section: "Ownership" },
    ],
    cols: [
      { key: "title", label: "Tender", type: "text", sub: "tenderNo" },
      { key: "authority", label: "Authority", type: "text" },
      { key: "estimatedValue", label: "Value", type: "money" },
      { key: "submissionDeadline", label: "Deadline", type: "date" },
      { key: "emdStatus", label: "EMD", type: "text" },
      { key: "ownerId", label: "Owner", type: "owner" },
      { key: "status", label: "Status", type: "status" },
    ],
    actions: [
      { label: "Add to calendar", special: "ics" },
      { label: "Start preparing", to: "Preparing", when: ["Identified"], primary: true },
      { label: "Submit tender", to: "Submitted", when: ["Preparing"], primary: true, confirm: "Submit this tender? Documents, both bids and the EMD must be ready." },
      { label: "Mark EMD paid", when: ["Identified", "Preparing"] },
      { label: "Mark EMD refunded", when: ["Submitted", "Won", "Lost"] },
      { label: "Mark won", to: "Won", when: ["Submitted"] },
      { label: "Mark lost", to: "Lost", when: ["Submitted"], danger: true, ask: { key: "note", label: "Why was it lost?", type: "textarea", required: true } },
      { label: "Withdraw", to: "Withdrawn", when: ["Identified", "Preparing"], danger: true, ask: { key: "note", label: "Reason for withdrawing", type: "textarea", required: true } },
    ],
    tabs: [{ key: "overview", label: "Overview", kind: "fields" }],
  },

  erp: {
    title: "ERP connections",
    singular: "ERP connection",
    icon: "link-2",
    idPrefix: "ERP-",
    label: "name",
    desc: "Where to push customers, items, orders, dispatches and receipts. Every push is signed with the secret.",
    statuses: [{ value: "Active", tone: "gray" }],
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "endpointUrl", label: "Endpoint URL", type: "text", required: true },
      { key: "secret", label: "Signing secret", type: "text", required: true },
      { key: "entities", label: "What to send: customers, items, orders, dispatches, receipts (comma-separated)", type: "text", required: true },
      { key: "lastStatus", label: "Last sync", type: "text", workflow: true },
    ],
    cols: [
      { key: "name", label: "Name", type: "text" },
      { key: "entities", label: "Sends", type: "text" },
      { key: "lastStatus", label: "Last sync", type: "text" },
    ],
    actions: [
      { label: "Sync now", primary: true },
      { label: "Pause" },
      { label: "Resume" },
    ],
    tabs: [
      { key: "overview", label: "Overview", kind: "fields" },
      { key: "log", label: "Sync log", kind: "events" },
    ],
  },
};

