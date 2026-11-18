import { MfgRole } from '@prisma/client';

// Every value below is copied verbatim from design_handoff_manufacturing_workspace/mfg-schema.js
// (the ADMIN export and its PERM/accessDefault/fsDefault helpers) and mfg-data.js (D.stages), which
// are the agreed source of truth for Manufacturing workspace defaults. Do not invent new values here —
// add to the source design file first if a new default is needed.

// All module keys from frontend/src/modules/registry.ts that a manufacturing org's RolePermission
// matrix covers (excludes EdTech-only keys and keys with no Create/Read/Update/Delete/Export concept).
export const MANUFACTURING_MODULE_KEYS = [
  'leads', 'accounts', 'contacts', 'activities', 'opps', 'rfqs', 'visits', 'demos', 'products',
  'costing', 'quotes', 'approvals', 'pos', 'sorders', 'dispatch', 'payments', 'assets', 'amc',
  'service', 'reports', 'nurturing', 'templates', 'dealers', 'tenders',
] as const;

type CrudeOp = 'C' | 'R' | 'U' | 'D' | 'E';
type RecordAccess = 'OWN' | 'TEAM' | 'ALL';

// Verbatim from mfg-schema.js `PERM` — role label -> "<moduleKeys>:<ops>;..." spec ('ALL' means every key).
const PERM_SPEC: Record<string, string> = {
  'Sales Head': 'ALL:CRUE',
  'Sales Manager': 'ALL:CRUE',
  'Sales Executive':
    'leads,accounts,contacts,activities,opps,visits,demos,quotes:CRU;rfqs,products,approvals,pos,sorders,dispatch,payments,assets,amc,service,nurturing,templates,dealers,tenders:R;reports:RE',
  'Application Engineer': 'rfqs,visits,demos,activities:CRU;opps,accounts,contacts,products,service,assets,tenders:R',
  'Commercial / Estimation': 'costing,quotes,approvals,products:CRUDE;opps,rfqs,accounts:R;pos,tenders:CRU',
  Operations: 'sorders:RU;dispatch:CRU;pos,accounts,products,assets:R',
  Accounts: 'payments:RUE;sorders,pos,accounts,dispatch,billing:R;reports:RE',
  'Service Manager': 'service,assets,amc:CRUDE;accounts,contacts,sorders:R',
  'Service Engineer': 'service:RU;assets,amc,accounts:R',
};

// Verbatim from mfg-schema.js `accessDefault` — role label -> record-access default ('All records' fallback).
const RECORD_ACCESS_LABEL: Record<string, RecordAccess> = {
  'Sales Executive': 'OWN',
  'Application Engineer': 'TEAM',
  'Service Engineer': 'OWN',
  'Sales Manager': 'TEAM',
  Operations: 'ALL',
};

// Role label -> MfgRole enum value (the enum RolePermission.role/caller.mfgRole actually compare
// against). Exported for reuse by the SLA engine's escalation-recipient resolver, which receives
// the same human-readable role labels in SlaPolicy.escalationLevels[].who.
export const ROLE_LABEL_TO_ENUM: Record<string, MfgRole> = {
  'Super Admin': MfgRole.SUPER_ADMIN,
  Director: MfgRole.DIRECTOR,
  'Sales Head': MfgRole.SALES_HEAD,
  'Sales Manager': MfgRole.SALES_MANAGER,
  'Sales Executive': MfgRole.SALES_EXECUTIVE,
  'Application Engineer': MfgRole.APPLICATION_ENGINEER,
  'Commercial / Estimation': MfgRole.COMMERCIAL_ESTIMATION,
  Operations: MfgRole.OPERATIONS,
  Accounts: MfgRole.ACCOUNTS,
  'Service Manager': MfgRole.SERVICE_MANAGER,
  'Service Engineer': MfgRole.SERVICE_ENGINEER,
};

// Roles mfg-schema.js's `fsDefault` grants field-security (unrestricted) access to.
// Everyone else is restricted from the six field-security toggles below.
const FIELD_SECURITY_UNRESTRICTED_LABELS = ['Super Admin', 'Director', 'Sales Head', 'Commercial / Estimation'];

export interface RolePermissionDefault {
  role: MfgRole;
  moduleKey: string;
  recordAccess: RecordAccess;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
}

// Mirrors mfg-schema.js's `permDefault(role, mod)`: Super Admin/Director get full CRUDE on every
// module; every other role's ops come from PERM_SPEC, defaulting to no access when unlisted.
function opsFor(roleLabel: string, moduleKey: string): CrudeOp[] {
  if (roleLabel === 'Super Admin' || roleLabel === 'Director') return ['C', 'R', 'U', 'D', 'E'];
  const spec = PERM_SPEC[roleLabel] ?? '';
  let ops: CrudeOp[] = [];
  for (const part of spec.split(';')) {
    const [moduleSpec, opsSpec] = part.split(':');
    if (!moduleSpec || !opsSpec) continue;
    if (moduleSpec === 'ALL' || moduleSpec.split(',').includes(moduleKey)) {
      ops = opsSpec.split('') as CrudeOp[];
    }
  }
  return ops;
}

export function buildRolePermissionDefaults(): RolePermissionDefault[] {
  const defaults: RolePermissionDefault[] = [];
  for (const roleLabel of Object.keys(ROLE_LABEL_TO_ENUM)) {
    const recordAccess: RecordAccess =
      roleLabel === 'Super Admin' || roleLabel === 'Director' ? 'ALL' : (RECORD_ACCESS_LABEL[roleLabel] ?? 'ALL');
    for (const moduleKey of MANUFACTURING_MODULE_KEYS) {
      const ops = opsFor(roleLabel, moduleKey);
      if (!ops.length) continue;
      defaults.push({
        role: ROLE_LABEL_TO_ENUM[roleLabel],
        moduleKey,
        recordAccess,
        canCreate: ops.includes('C'),
        canRead: ops.includes('R'),
        canUpdate: ops.includes('U'),
        canDelete: ops.includes('D'),
        canExport: ops.includes('E'),
      });
    }
  }
  return defaults;
}

// The six Administration > Roles & permissions field-security toggles (README §27), each
// restricted to every role except FIELD_SECURITY_UNRESTRICTED_LABELS.
export const FIELD_PERMISSION_DEFAULT_LABELS = [
  'Standard cost',
  'Minimum selling price',
  'Costing & margin',
  'Approval thresholds',
  'Competitor pricing',
  'Payment receipts',
] as const;

export function buildFieldPermissionDefaults(): { moduleKey: string; fieldLabel: string; restrictedToRoles: string[] }[] {
  const restrictedFor = (unrestricted: string[]) =>
    Object.entries(ROLE_LABEL_TO_ENUM)
      .filter(([label]) => !unrestricted.includes(label))
      .map(([, mfgRole]) => mfgRole);
  const restrictedToRoles = restrictedFor(FIELD_SECURITY_UNRESTRICTED_LABELS);
  // Accounts owns payments, so it always sees receipt amounts.
  const paymentReceiptRoles = restrictedFor([...FIELD_SECURITY_UNRESTRICTED_LABELS, 'Accounts']);
  // moduleKey is the module the restriction is displayed/enforced against.
  const moduleKeyByLabel: Record<string, string> = {
    'Standard cost': 'products',
    'Minimum selling price': 'products',
    'Costing & margin': 'costing',
    'Approval thresholds': 'approvals',
    'Competitor pricing': 'opps',
    'Payment receipts': 'payments',
  };
  return FIELD_PERMISSION_DEFAULT_LABELS.map((fieldLabel) => ({
    moduleKey: moduleKeyByLabel[fieldLabel],
    fieldLabel,
    restrictedToRoles: fieldLabel === 'Payment receipts' ? paymentReceiptRoles : restrictedToRoles,
  }));
}

// Verbatim from mfg-schema.js ADMIN.approvalRules, with two label fixes to match the already-shipped
// Phase 3/4 contract instead of the prototype's free-text labels: 'Margin' (not 'Margin (below %)')
// matches CostingSheetsService/QuotationsService's literal `findMatchingApprovalRule('Margin', ...)`
// query, and 'CreditTerms' (not 'Payment credit days') matches CreateApprovalRuleDto's fixed
// `type` enum (['Discount', 'Margin', 'PaymentTerms', 'CreditTerms']), which the generic
// Administration > Approval rules form validates against.
export const APPROVAL_RULE_DEFAULTS: { type: string; min: number; max: number; approverRole: string }[] = [
  { type: 'Discount', min: 0, max: 5, approverRole: 'Salesperson' },
  { type: 'Discount', min: 5, max: 10, approverRole: 'Sales Manager' },
  { type: 'Discount', min: 10, max: 15, approverRole: 'Sales Head' },
  { type: 'Discount', min: 15, max: 100, approverRole: 'Director' },
  { type: 'Margin', min: 15, max: 20, approverRole: 'Sales Head' },
  { type: 'Margin', min: 0, max: 15, approverRole: 'Director' },
  { type: 'CreditTerms', min: 45, max: 60, approverRole: 'Accounts' },
  { type: 'CreditTerms', min: 60, max: 120, approverRole: 'Director' },
];

const SOURCES = ['Website', 'Google Ads', 'Meta', 'IndiaMART', 'TradeIndia', 'ExportersIndia', 'JustDial', 'Exhibition', 'Referral', 'LinkedIn', 'WhatsApp', 'Email', 'Dealer', 'Cold calling', 'Existing customer', 'Manual / API'];
const INDUSTRIES = ['Steel & metals', 'Cement', 'Food processing', 'Pharmaceuticals', 'Chemicals & polymers', 'Warehousing & logistics', 'Fertilisers', 'Plantation & agri', 'Sugar', 'Paper & packaging', 'Mining & minerals', 'Dairy', 'Textiles'];
const TERRITORIES = ['North', 'South', 'East', 'West', 'Central'];
const LOST_REASONS = ['Price', 'Competitor', 'Technical mismatch', 'Delivery time', 'Budget', 'Project cancelled', 'No response', 'Existing vendor', 'Payment terms', 'Internal approval', 'Other'];
const COMPETITORS = ['Avery Weigh-Tronix', 'Essae Digitronics', 'Mettler Toledo', 'Local fabricator', 'Other'];
const BUYING_ROLES = ['Decision Maker', 'Technical Influencer', 'User', 'Procurement', 'Finance', 'Gatekeeper', 'Management'];
// Exported for reuse by MfgDashboardService's weighted-pipeline/aging calculations, which
// need the same stage->probability mapping as the seeded 'stages' master.
export const STAGES: [string, number][] = [
  ['Qualified', 10], ['Requirement collected', 15], ['Technical discussion', 20], ['Site visit', 25],
  ['Demo / trial', 30], ['Solution proposed', 40], ['Costing', 45], ['Quotation sent', 50],
  ['Negotiation', 60], ['Approval pending', 65], ['PO expected', 80], ['PO received', 95],
];

export interface MasterValueSeed {
  category: string;
  value: string;
  label: string;
  numericValue?: number;
  sortOrder: number;
}

// Verbatim from mfg-schema.js ADMIN.masters (13 masters). `numericValue` carries the "extra
// number column" (stage probability %, milestone default %) mfg-schema.js calls `x`.
export function buildMasterValueDefaults(): MasterValueSeed[] {
  const simple = (category: string, values: readonly string[]): MasterValueSeed[] =>
    values.map((v, i) => ({ category, value: v, label: v, sortOrder: i }));
  return [
    ...simple('sources', SOURCES),
    ...simple('leadStatus', ['New', 'Assigned', 'Contacted', 'Follow-up', 'Qualified', 'Nurture', 'Disqualified']),
    ...STAGES.map(([label, pct], i) => ({ category: 'stages', value: label, label, numericValue: pct, sortOrder: i })),
    ...simple('industries', INDUSTRIES),
    ...simple('territories', TERRITORIES),
    ...simple('categories', ['Weighbridges', 'Belt weighers', 'Checkweighers', 'Bagging & packing', 'Conveyors', 'Components', 'Services']),
    ...simple('activityTypes', ['Call', 'WhatsApp', 'Email', 'Meeting', 'Site visit', 'Demo', 'Quotation follow-up', 'PO follow-up', 'Payment follow-up', 'Service follow-up']),
    ...simple('lost', LOST_REASONS),
    ...simple('competitors', COMPETITORS),
    ...[['Advance', 30], ['Before dispatch', 60], ['After installation', 10], ['Retention', 0]].map(([label, pct], i) => ({
      category: 'milestones',
      value: label as string,
      label: label as string,
      numericValue: pct as number,
      sortOrder: i,
    })),
    ...simple('priorities', ['Critical', 'High', 'Medium', 'Low']),
    ...simple('buying', BUYING_ROLES),
    ...simple('coverage', ['Warranty', 'AMC', 'CMC', 'Paid service']),
  ];
}

// Verbatim from mfg-schema.js ADMIN.hours — Mon-Sat business hours (Sat shortened), Sun closed
// business-wise but shown open 09:00-18:00 in the prototype (kept as-is; BusinessCalendar-type
// SLAs that need a closed Sunday should also list it in holidays or treat `isOpen` explicitly).
export const BUSINESS_CALENDAR_DEFAULT = {
  timezone: 'Asia/Kolkata',
  days: [
    { day: 'Mon', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Tue', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Wed', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Thu', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Fri', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Sat', isOpen: true, from: '09:00', to: '13:00' },
    { day: 'Sun', isOpen: false, from: '09:00', to: '18:00' },
  ],
};

export const HOLIDAY_DEFAULTS: { date: string; name: string }[] = [
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Diwali' },
  { date: '2026-11-09', name: 'Diwali (Balipratipada)' },
  { date: '2026-12-25', name: 'Christmas' },
];

export interface SlaTarget { cond: string; val: number; unit: 'minutes' | 'hours' | 'days'; }
export interface SlaEscalationLevel { at: number; who: string; channels: string[]; }
export interface SlaPolicyDefault {
  id: string;
  moduleKey: string;
  name: string;
  startEvent: string;
  stopEvent: string;
  calendarType: 'Business hours' | 'Calendar days' | '24 x 7';
  targets: SlaTarget[];
  escalationLevels: SlaEscalationLevel[];
  pauseStatuses: string[];
}

const tg = (cond: string, val: number, unit: SlaTarget['unit']): SlaTarget => ({ cond, val, unit });
const lvl = (at: number, who: string, channels: string[]): SlaEscalationLevel => ({ at, who, channels });
const cal = (t: string): SlaPolicyDefault['calendarType'] => (t === '24 × 7' ? '24 x 7' : (t as SlaPolicyDefault['calendarType']));

// Verbatim from mfg-schema.js ADMIN.sla (the 22 seeded policies) — see that file for the source.
export const SLA_POLICY_DEFAULTS: SlaPolicyDefault[] = [
  { id: 'SLA-01', moduleKey: 'leads', name: 'Lead first response', startEvent: 'Lead created', stopEvent: 'First call / message logged', calendarType: cal('Business hours'), targets: [tg('All leads', 2, 'hours'), tg('Source = IndiaMART or Google Ads', 30, 'minutes'), tg('Estimated value ≥ ₹50 L', 1, 'hours')], escalationLevels: [lvl(75, 'Owner', ['In-app']), lvl(100, 'Owner', ['In-app', 'WhatsApp']), lvl(150, 'Sales Manager', ['In-app', 'Email']), lvl(300, 'Sales Head', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-02', moduleKey: 'leads', name: 'Lead qualification decision', startEvent: 'Lead contacted', stopEvent: 'Qualified / Nurture / Disqualified', calendarType: cal('Business hours'), targets: [tg('All leads', 5, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app']), lvl(200, 'Sales Manager', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-03', moduleKey: 'opps', name: 'Stage stagnation', startEvent: 'Stage entered', stopEvent: 'Stage changed', calendarType: cal('Calendar days'), targets: [tg('Stage = Qualified / Requirement collected', 7, 'days'), tg('Stage = Technical discussion / Site visit / Demo', 14, 'days'), tg('Stage = Quotation sent', 10, 'days'), tg('Stage = Negotiation / Approval pending', 14, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app']), lvl(150, 'Sales Manager', ['In-app', 'Email']), lvl(200, 'Sales Head', ['Email'])], pauseStatuses: ['Waiting on customer'] },
  { id: 'SLA-04', moduleKey: 'opps', name: 'High-value deal attention', startEvent: 'Stage entered', stopEvent: 'Stage changed', calendarType: cal('Calendar days'), targets: [tg('Value ≥ ₹1 Cr', 7, 'days')], escalationLevels: [lvl(100, 'Sales Head', ['In-app', 'Email']), lvl(200, 'Director', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-05', moduleKey: 'opps', name: 'Next action overdue', startEvent: 'Next action date reached', stopEvent: 'Activity completed', calendarType: cal('Business hours'), targets: [tg('All active opportunities', 1, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app']), lvl(300, 'Sales Manager', ['In-app'])], pauseStatuses: [] },
  { id: 'SLA-06', moduleKey: 'activities', name: 'Follow-up completion', startEvent: 'Scheduled time', stopEvent: 'Activity completed', calendarType: cal('Business hours'), targets: [tg('Priority = High', 4, 'hours'), tg('Priority = Medium', 1, 'days'), tg('Priority = Low', 3, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app']), lvl(200, 'Sales Manager', ['In-app', 'Email'])], pauseStatuses: [] },
  { id: 'SLA-07', moduleKey: 'rfqs', name: 'Technical feasibility response', startEvent: 'RFQ received', stopEvent: 'Feasible / Not feasible / Clarification', calendarType: cal('Business hours'), targets: [tg('All RFQs', 3, 'days'), tg('Tender RFQs', 1, 'days')], escalationLevels: [lvl(75, 'Technical owner', ['In-app']), lvl(100, 'Sales owner', ['In-app']), lvl(150, 'Sales Head', ['Email'])], pauseStatuses: ['Clarification required'] },
  { id: 'SLA-08', moduleKey: 'visits', name: 'Site visit report submission', startEvent: 'Visit completed', stopEvent: 'Report submitted', calendarType: cal('Business hours'), targets: [tg('All visits', 24, 'hours')], escalationLevels: [lvl(100, 'Sales owner', ['In-app']), lvl(200, 'Sales Manager', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-09', moduleKey: 'demos', name: 'Evaluation result', startEvent: 'Trial started', stopEvent: 'Result recorded', calendarType: cal('Calendar days'), targets: [tg('Demo', 2, 'days'), tg('Trial / Sample', 7, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app']), lvl(200, 'Sales Manager', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-10', moduleKey: 'costing', name: 'Costing preparation', startEvent: 'Approved for costing', stopEvent: 'Costing submitted', calendarType: cal('Business hours'), targets: [tg('All', 3, 'days'), tg('Value ≥ ₹1 Cr', 5, 'days')], escalationLevels: [lvl(100, 'Commercial / Estimation', ['In-app']), lvl(150, 'Sales Head', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-11', moduleKey: 'quotes', name: 'Quotation issue', startEvent: 'Costing approved', stopEvent: 'Quotation sent', calendarType: cal('Business hours'), targets: [tg('All', 2, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app']), lvl(200, 'Sales Manager', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-12', moduleKey: 'quotes', name: 'Quotation follow-up', startEvent: 'Quotation sent', stopEvent: 'Customer response logged', calendarType: cal('Calendar days'), targets: [tg('All', 3, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app', 'WhatsApp']), lvl(200, 'Sales Manager', ['In-app'])], pauseStatuses: [] },
  { id: 'SLA-13', moduleKey: 'quotes', name: 'Quotation expiry reminder', startEvent: 'Validity date − 7 days', stopEvent: 'Revised / accepted', calendarType: cal('Calendar days'), targets: [tg('All', 7, 'days')], escalationLevels: [lvl(100, 'Owner', ['In-app', 'Email'])], pauseStatuses: [] },
  { id: 'SLA-14', moduleKey: 'approvals', name: 'Approval turnaround', startEvent: 'Approval requested', stopEvent: 'Approved / rejected / returned', calendarType: cal('Business hours'), targets: [tg('Level = Sales Manager', 4, 'hours'), tg('Level = Sales Head', 8, 'hours'), tg('Level = Director', 1, 'days'), tg('Level = Accounts', 1, 'days')], escalationLevels: [lvl(75, 'Approver', ['In-app']), lvl(100, 'Approver', ['In-app', 'Email']), lvl(200, 'Next level up', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-15', moduleKey: 'pos', name: 'PO verification', startEvent: 'PO received', stopEvent: 'Accepted / clarification', calendarType: cal('Business hours'), targets: [tg('All', 2, 'days')], escalationLevels: [lvl(100, 'Commercial / Estimation', ['In-app']), lvl(150, 'Sales Head', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-16', moduleKey: 'sorders', name: 'Operations handover acknowledgement', startEvent: 'Sales order created', stopEvent: 'Handover acknowledged', calendarType: cal('Business hours'), targets: [tg('All', 1, 'days')], escalationLevels: [lvl(100, 'Operations', ['In-app', 'Email']), lvl(200, 'Director', ['Email'])], pauseStatuses: [] },
  { id: 'SLA-17', moduleKey: 'sorders', name: 'Delivery commitment risk', startEvent: 'Committed delivery − 7 days', stopEvent: 'Dispatched', calendarType: cal('Calendar days'), targets: [tg('All', 7, 'days')], escalationLevels: [lvl(100, 'Operations', ['In-app']), lvl(100, 'Sales owner', ['In-app'])], pauseStatuses: [] },
  { id: 'SLA-18', moduleKey: 'dispatch', name: 'Delivery confirmation', startEvent: 'Dispatched', stopEvent: 'Delivered', calendarType: cal('Calendar days'), targets: [tg('Within state', 3, 'days'), tg('Inter-state', 7, 'days')], escalationLevels: [lvl(100, 'Sales owner', ['In-app'])], pauseStatuses: [] },
  { id: 'SLA-19', moduleKey: 'service', name: 'Service first response', startEvent: 'Ticket created', stopEvent: 'Engineer assigned + customer contacted', calendarType: cal('24 × 7'), targets: [tg('Priority = Critical', 2, 'hours'), tg('Priority = High', 4, 'hours'), tg('Priority = Medium', 1, 'days'), tg('Priority = Low', 2, 'days')], escalationLevels: [lvl(75, 'Service Manager', ['In-app']), lvl(100, 'Service Manager', ['In-app', 'WhatsApp']), lvl(200, 'Director', ['Email'])], pauseStatuses: ['Waiting on customer', 'Parts required'] },
  { id: 'SLA-20', moduleKey: 'service', name: 'Service resolution', startEvent: 'Ticket created', stopEvent: 'Resolved', calendarType: cal('24 × 7'), targets: [tg('Priority = Critical', 24, 'hours'), tg('Priority = High', 48, 'hours'), tg('Priority = Medium', 5, 'days'), tg('Priority = Low', 10, 'days')], escalationLevels: [lvl(100, 'Service Manager', ['In-app', 'Email']), lvl(150, 'Director', ['Email'])], pauseStatuses: ['Waiting on customer', 'Parts required'] },
  { id: 'SLA-21', moduleKey: 'amc', name: 'Renewal reminders', startEvent: 'End date − 90 days', stopEvent: 'Renewed / lost', calendarType: cal('Calendar days'), targets: [tg('90 days before', 90, 'days'), tg('60 days before', 60, 'days'), tg('30 days before', 30, 'days')], escalationLevels: [lvl(100, 'Renewal owner', ['In-app', 'Email']), lvl(100, 'Service Manager', ['In-app'])], pauseStatuses: [] },
  { id: 'SLA-22', moduleKey: 'payments', name: 'Payment collection', startEvent: 'Due date', stopEvent: 'Received in full', calendarType: cal('Calendar days'), targets: [tg('Reminder before due', 7, 'days'), tg('Overdue', 1, 'days'), tg('Escalation', 15, 'days'), tg('Critical', 30, 'days')], escalationLevels: [lvl(100, 'Accounts', ['In-app', 'Email']), lvl(100, 'Sales owner', ['In-app']), lvl(200, 'Sales Head', ['Email']), lvl(400, 'Director', ['Email'])], pauseStatuses: [] },
];

// Verbatim from mfg-schema.js's `RPT` constant — the 25 standard reports (23 business reports
// + the 2 Operations ones), seeded as Report rows so a new org's Reports list isn't empty.
// MfgReportsService.getDataTable() dispatches on `name` — keep these names in sync with that
// dispatch table (backend/src/modules/mfg-reports/mfg-reports.service.ts).
export const REPORT_DEFAULTS: { category: string; name: string }[] = [
  { category: 'Leads', name: 'Lead source & campaign performance' },
  { category: 'Leads', name: 'Lead response SLA' },
  { category: 'Leads', name: 'Lead-to-opportunity conversion' },
  { category: 'Pipeline', name: 'Opportunity stage conversion' },
  { category: 'Pipeline', name: 'Opportunity aging / stagnation' },
  { category: 'Pipeline', name: 'Pipeline & weighted pipeline' },
  { category: 'Pipeline', name: 'Expected PO / order booking' },
  { category: 'Pipeline', name: 'Average sales cycle duration' },
  { category: 'Performance', name: 'Salesperson / team performance' },
  { category: 'Performance', name: 'Win/loss & lost reason' },
  { category: 'Performance', name: 'Competitor analysis' },
  { category: 'Quotes & orders', name: 'Quotation conversion & revision analysis' },
  { category: 'Quotes & orders', name: 'Order / dispatch status' },
  { category: 'Sales', name: 'Product / SKU-wise sales' },
  { category: 'Sales', name: 'Industry-wise sales' },
  { category: 'Sales', name: 'Customer / account-wise sales' },
  { category: 'Sales', name: 'Territory / region-wise sales' },
  { category: 'Sales', name: 'Repeat business / cross-sell' },
  { category: 'Finance', name: 'Payment outstanding & aging' },
  { category: 'After-sales', name: 'Installed base' },
  { category: 'After-sales', name: 'Warranty expiry' },
  { category: 'After-sales', name: 'AMC renewal' },
  { category: 'After-sales', name: 'Service SLA & ticket aging' },
  { category: 'Operations', name: 'SLA compliance (all policies)' },
  { category: 'Operations', name: 'Automation execution log' },
];
