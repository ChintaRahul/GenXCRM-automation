// Pre-seeds the data the Manufacturing manual test-case sheet (GenXCRM-Manufacturing-Manual-Test-Cases.xlsx,
// "Test Data" sheet + each case's Preconditions) assumes, into ONE existing Manufacturing org and its
// EXISTING members. It never creates users: every record is owned by the member whose mfgRole matches
// the test case (rep A/B = first/second Sales Executive, engineer, commercial, ops, accounts, service ...),
// falling back to the login user when the org has no member in that role.
//
// Dry-run by default (prints the member->role mapping). Pass --apply to write; --rollback runs the full seed then undoes it.
// Idempotent: aborts if account 'Shree Steel Pvt Ltd' already exists in the org. Fills missing Administration
// defaults (permissions, masters, rules, SLA, calendar ...) first, same rule as backfill-manufacturing-defaults.ts.
//   local: npm run seed:man-testdata:local [-- --apply]
//   prod:  DATABASE_URL=<tunnel url> npm run seed:man-testdata -- --apply   (tunnel: connect-prod-db.ps1)
import { PrismaClient, Prisma, MfgRole, WorkspaceType } from '@prisma/client';
import {
  APPROVAL_RULE_DEFAULTS, BUSINESS_CALENDAR_DEFAULT, HOLIDAY_DEFAULTS, REPORT_DEFAULTS, SLA_POLICY_DEFAULTS, STAGES,
  buildFieldPermissionDefaults, buildMasterValueDefaults, buildRolePermissionDefaults,
} from '../src/modules/manufacturing-defaults/manufacturing-defaults.data';

const prisma = new PrismaClient();
const rollback = process.argv.includes('--rollback'); // validate every insert, then undo (nothing persists)
const apply = process.argv.includes('--apply') || rollback;
const loginEmail = (process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length) ?? 'genxcrm002+man@gmail.com').toLowerCase();

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);
const amount = (qty: number, unitPrice: number, discountPct: number) => Math.round(qty * unitPrice * (1 - discountPct / 100));

type Tx = Prisma.TransactionClient;

// Fills only the tables that are still empty for this org.
const seedDefaults = async (tx: Tx, orgId: string) => {
  const empty = async (n: Promise<number>) => (await n) === 0;
  if (await empty(tx.rolePermission.count({ where: { orgId } }))) await tx.rolePermission.createMany({ data: buildRolePermissionDefaults().map((d) => ({ ...d, orgId })) });
  if (await empty(tx.fieldPermission.count({ where: { orgId } }))) await tx.fieldPermission.createMany({ data: buildFieldPermissionDefaults().map((d) => ({ ...d, orgId })) });
  if (await empty(tx.approvalRule.count({ where: { orgId } }))) await tx.approvalRule.createMany({ data: APPROVAL_RULE_DEFAULTS.map((r) => ({ ...r, orgId })) });
  if (await empty(tx.masterValue.count({ where: { orgId } }))) await tx.masterValue.createMany({ data: buildMasterValueDefaults().map((m) => ({ ...m, orgId })) });
  if (await empty(tx.businessCalendar.count({ where: { orgId } }))) {
    await tx.businessCalendar.create({ data: { orgId, timezone: BUSINESS_CALENDAR_DEFAULT.timezone, days: BUSINESS_CALENDAR_DEFAULT.days as Prisma.InputJsonValue } });
  }
  if (await empty(tx.holiday.count({ where: { orgId } }))) await tx.holiday.createMany({ data: HOLIDAY_DEFAULTS.map((h) => ({ orgId, name: h.name, date: new Date(h.date) })) });
  if (await empty(tx.slaPolicy.count({ where: { orgId } }))) {
    await tx.slaPolicy.createMany({
      data: SLA_POLICY_DEFAULTS.map((p) => ({
        orgId, moduleKey: p.moduleKey, name: p.name, startEvent: p.startEvent, stopEvent: p.stopEvent, calendarType: p.calendarType,
        targets: p.targets as unknown as Prisma.InputJsonValue, escalationLevels: p.escalationLevels as unknown as Prisma.InputJsonValue,
        pauseStatuses: p.pauseStatuses, isActive: true,
      })),
    });
  }
  if (await empty(tx.report.count({ where: { orgId } }))) await tx.report.createMany({ data: REPORT_DEFAULTS.map((r) => ({ ...r, orgId })) });
};

interface People { admin: string; repA: string; repB: string; manager: string; head: string; director: string; engineer: string; commercial: string; ops: string; accounts: string; svcMgr: string; svcEng: string }

const seedTestData = async (tx: Tx, orgId: string, p: People) => {
  // ── Products ────────────────────────────────────────────────────────────────
  const mkProduct = (d: { category: string; family: string; model: string; sku: string; price: number; minPrice?: number; cost?: number; leadTime?: string; warrantyMonths?: number; status?: string; description?: string }) =>
    tx.product.create({ data: { orgId, uom: 'Nos', hsn: '8423', gstRate: '18%', status: 'Active', ...d } });
  const wb60 = await mkProduct({ category: 'Weighbridges', family: 'Truck weighbridge', model: '60T', sku: 'WB-60-STD', price: 1_000_000, minPrice: 900_000, cost: 700_000, leadTime: '8 weeks', warrantyMonths: 12, description: 'Truck Weighbridge 60T, 18 x 3 m, 4 load cells' });
  const wb100 = await mkProduct({ category: 'Weighbridges', family: 'Truck weighbridge', model: '100T', sku: 'WB-100-STD', price: 1_650_000, minPrice: 1_500_000, cost: 1_200_000, leadTime: '10 weeks', warrantyMonths: 12 });
  const lc10 = await mkProduct({ category: 'Components', family: 'Load cell', model: 'LC-10', sku: 'LC-10-STD', price: 110_000, minPrice: 100_000, cost: 70_000, leadTime: '2 weeks', warrantyMonths: 12 });
  const bw200 = await mkProduct({ category: 'Belt weighers', family: 'Belt weigher', model: 'BW-200', sku: 'BW-200-STD', price: 850_000, minPrice: 760_000, cost: 600_000, leadTime: '6 weeks', warrantyMonths: 18 });
  const cw50 = await mkProduct({ category: 'Checkweighers', family: 'Checkweigher', model: 'CW-50', sku: 'CW-50-STD', price: 520_000, minPrice: 470_000, cost: 380_000, leadTime: '5 weeks', warrantyMonths: 12 });
  await mkProduct({ category: 'Bagging & packing', family: 'Bagging machine', model: 'BG-25', sku: 'BG-25-STD', price: 1_250_000, minPrice: 1_100_000, cost: 900_000, leadTime: '8 weeks', warrantyMonths: 12 });
  await mkProduct({ category: 'Weighbridges', family: 'Truck weighbridge', model: '40T (legacy)', sku: 'WB-40-OLD', price: 700_000, minPrice: 640_000, cost: 500_000, status: 'Inactive' });
  await mkProduct({ category: 'Services', family: 'AMC', model: 'Annual AMC', sku: 'SVC-AMC-1Y', price: 60_000, leadTime: 'n/a', warrantyMonths: 0 });
  await tx.productAttribute.createMany({
    data: [
      { productId: wb60.id, name: 'Capacity', value: '60 tonne' }, { productId: wb60.id, name: 'Platform size', value: '18 x 3 m' },
      { productId: wb60.id, name: 'Load cells', value: '4 x 30T' }, { productId: bw200.id, name: 'Belt width', value: '800 mm' },
    ],
  });

  // ── Accounts, plants, contacts ──────────────────────────────────────────────
  const mkAccount = (d: { name: string; short: string; type?: string; industry: string; city: string; state: string; territory: string; gstin?: string; owner: string; status?: string; creditTerms?: string; potential?: number; source?: string }) =>
    tx.account.create({
      data: {
        orgId, name: d.name, short: d.short, type: d.type ?? 'Customer', industry: d.industry, city: d.city, state: d.state, country: 'India', territory: d.territory,
        gstin: d.gstin, ownerId: d.owner, status: d.status ?? 'Active', creditTerms: d.creditTerms ?? '30 days', potential: d.potential ?? 5_000_000, source: d.source ?? 'Referral',
        billing: `${d.name}, ${d.city}, ${d.state}`, tags: ['test-data'],
      },
    });
  const shree = await mkAccount({ name: 'Shree Steel Pvt Ltd', short: 'Shree Steel', industry: 'Steel & metals', city: 'Pune', state: 'Maharashtra', territory: 'West', gstin: '27AABCS1234A1Z5', owner: p.repA, creditTerms: '45 days', potential: 12_000_000, source: 'IndiaMART' });
  const anna = await mkAccount({ name: 'Annapurna Foods Ltd', short: 'Annapurna', industry: 'Food processing', city: 'Hyderabad', state: 'Telangana', territory: 'South', gstin: '36AAACA5678B1Z2', owner: p.repB, creditTerms: '60 days' });
  const bharat = await mkAccount({ name: 'Bharat Cement Ltd', short: 'Bharat Cement', industry: 'Cement', city: 'Raipur', state: 'Chhattisgarh', territory: 'Central', gstin: '22AABCB9012C1Z8', owner: p.repA });
  const konark = await mkAccount({ name: 'Konark Pharma', short: 'Konark', industry: 'Pharmaceuticals', city: 'Mumbai', state: 'Maharashtra', territory: 'West', gstin: '27AAACK3456D1Z1', owner: p.repB, type: 'Prospect' });
  const gati = await mkAccount({ name: 'Gati Logistics Hub', short: 'Gati', industry: 'Warehousing & logistics', city: 'Pune', state: 'Maharashtra', territory: 'West', owner: p.repA, status: 'Dormant' });
  const sagar = await mkAccount({ name: 'Sagar Cement', short: 'Sagar', industry: 'Cement', city: 'Ahmedabad', state: 'Gujarat', territory: 'West', gstin: '24AABCS7788E1Z3', owner: p.repB, type: 'Dealer' });
  await mkAccount({
    name: 'Maharashtra Integrated Bulk Handling, Storage & Warehousing Solutions Private Limited - Western Region Unit 4',
    short: 'MIBHS West 4', industry: 'Warehousing & logistics', city: 'Nashik', state: 'Maharashtra', territory: 'West', owner: p.repA,
  });
  await tx.plant.createMany({
    data: [
      { accountId: shree.id, name: 'Plant 1 - Pune MIDC', type: 'Manufacturing', city: 'Pune' }, { accountId: shree.id, name: 'Plant 2 - Nashik', type: 'Manufacturing', city: 'Nashik' },
      { accountId: anna.id, name: 'Hyderabad Main Plant', type: 'Manufacturing', city: 'Hyderabad' }, { accountId: bharat.id, name: 'Raipur Kiln Unit', type: 'Manufacturing', city: 'Raipur' },
      { accountId: bharat.id, name: 'Bilaspur Grinding Unit', type: 'Warehouse', city: 'Bilaspur' }, { accountId: konark.id, name: 'Mumbai Formulation Site', type: 'Manufacturing', city: 'Mumbai' },
      { accountId: sagar.id, name: 'Ahmedabad Depot', type: 'Warehouse', city: 'Ahmedabad' }, { accountId: gati.id, name: 'Pune Hub', type: 'Warehouse', city: 'Pune' },
    ],
  });
  const mkContact = (accountId: string, d: { name: string; phone: string; email?: string; role: string; designation: string; department: string; plant?: string; influence?: string }) =>
    tx.contact.create({ data: { orgId, accountId, channel: 'Phone', status: 'Active', whatsapp: d.phone, influence: d.influence ?? 'Medium', ...d } });
  const ramesh = await mkContact(shree.id, { name: 'Ramesh Iyer', phone: '9876543210', email: 'buyer@shreesteel.in', role: 'Decision Maker', designation: 'Purchase Head', department: 'Purchase', plant: 'Plant 1 - Pune MIDC', influence: 'High' });
  const shreeEng = await mkContact(shree.id, { name: 'Anita Desai', phone: '9812345678', email: 'anita.desai@shreesteel.in', role: 'Technical Influencer', designation: 'Plant Engineer', department: 'Maintenance', plant: 'Plant 2 - Nashik' });
  const annaC = await mkContact(anna.id, { name: 'Suresh Nair', phone: '9845012345', email: 'suresh.nair@annapurna.in', role: 'Decision Maker', designation: 'GM Operations', department: 'Production', influence: 'High' });
  const bharatC = await mkContact(bharat.id, { name: 'Rohit Sharma', phone: '9893011122', email: 'rohit.sharma@bharatcement.in', role: 'Procurement', designation: 'Purchase Manager', department: 'Purchase' });
  const konarkC = await mkContact(konark.id, { name: 'Priya Kulkarni', phone: '9820099887', email: 'priya.k@konarkpharma.in', role: 'Decision Maker', designation: 'Director', department: 'Management', influence: 'High' });
  const sagarC = await mkContact(sagar.id, { name: 'Vikram Mehta', phone: '9825011223', role: 'Finance', designation: 'Accounts Head', department: 'Finance' }); // no email (PAY-008)
  await mkContact(gati.id, { name: 'Neha Joshi', phone: '9890765432', email: 'neha.joshi@gati.example.com', role: 'User', designation: 'Hub Manager', department: 'Stores' });

  // ── Opportunities (+ stage history) ─────────────────────────────────────────
  const stageNames = STAGES.map(([s]) => s);
  interface OppSpec { title: string; account: { id: string }; contactId?: string; product: string; qty?: number; value: number; stage: string; closeIn?: number; next?: string; nextIn?: number; owner: string; source?: string; lostReason?: string; ageDays?: number; plant?: string }
  const mkOpp = async (o: OppSpec) => {
    const { id } = await tx.opportunity.create({
      data: {
        orgId, title: o.title, accountId: o.account.id, contactId: o.contactId, plant: o.plant, product: o.product, qty: o.qty ?? 1, value: o.value, stage: o.stage,
        closeDate: at(o.closeIn ?? 60), source: o.source ?? 'Referral', ownerId: o.owner, technicalOwnerId: p.engineer, nextAction: o.next ?? 'Follow up with customer', nextActionDate: at(o.nextIn ?? 3),
        lostReason: o.lostReason, createdAt: at(-(o.ageDays ?? 30)),
      },
    });
    // Path through the stage ladder up to the current stage (Won/Lost branch off Negotiation).
    const idx = stageNames.indexOf(o.stage);
    const path = idx >= 0 ? stageNames.slice(0, idx + 1) : stageNames.slice(0, stageNames.indexOf('Negotiation') + 1).concat(o.stage);
    const age = o.ageDays ?? 30;
    await tx.opportunityStageHistory.createMany({
      data: path.map((to, i) => ({ opportunityId: id, fromStage: i === 0 ? null : path[i - 1], toStage: to, changedById: o.owner, changedAt: at(-age + Math.floor((age * 0.9 * i) / path.length)) })),
    });
    return { id, accountId: o.account.id, owner: o.owner };
  };
  const TW = 'Truck Weighbridge 60T';
  const oShreeQ = await mkOpp({ title: `Shree Steel Pvt Ltd - ${TW}`, account: shree, contactId: ramesh.id, product: TW, value: 1_000_000, stage: 'Qualified', owner: p.repA, source: 'IndiaMART', ageDays: 5, plant: 'Plant 1 - Pune MIDC' });
  const oShreeCost = await mkOpp({ title: 'Shree Steel Pvt Ltd - Plant 2 weighbridge', account: shree, contactId: shreeEng.id, product: TW, value: 1_000_000, stage: 'Costing', owner: p.repA, ageDays: 28, plant: 'Plant 2 - Nashik' });
  const oAnnaNeg = await mkOpp({ title: 'Annapurna Foods - Belt weigher line 2', account: anna, contactId: annaC.id, product: 'Belt weigher BW-200', value: 2_000_000, stage: 'Negotiation', owner: p.repB, ageDays: 45 });
  const oBharatQs = await mkOpp({ title: 'Bharat Cement - Checkweigher CW-50', account: bharat, contactId: bharatC.id, product: 'Checkweigher CW-50', value: 1_500_000, stage: 'Quotation sent', owner: p.repA, ageDays: 33 });
  const oKonarkPo = await mkOpp({ title: 'Konark Pharma - Checkweigher upgrade', account: konark, contactId: konarkC.id, product: 'Checkweigher CW-50', value: 1_040_000, stage: 'PO expected', owner: p.repB, ageDays: 52 });
  const oShreePoRx = await mkOpp({ title: 'Shree Steel - Weighbridge expansion', account: shree, contactId: ramesh.id, product: TW, value: 1_000_000, stage: 'PO received', owner: p.repA, ageDays: 70 });
  const oAnnaLost = await mkOpp({ title: 'Annapurna Foods - Platform scale', account: anna, contactId: annaC.id, product: 'Platform scale', value: 800_000, stage: 'Lost', owner: p.repB, lostReason: 'Budget', ageDays: 60 });
  await mkOpp({ title: 'Bharat Cement - Weighbridge (won)', account: bharat, contactId: bharatC.id, product: TW, value: 1_000_000, stage: 'Won', owner: p.repA, ageDays: 120 });
  const oPastClose = await mkOpp({ title: 'Sagar Cement - Weighbridge 100T', account: sagar, contactId: sagarC.id, product: 'Truck Weighbridge 100T', value: 1_650_000, stage: 'Site visit', owner: p.repB, closeIn: -12, ageDays: 80 });
  const oTech = await mkOpp({ title: 'Konark Pharma - Belt weigher', account: konark, contactId: konarkC.id, product: 'Belt weigher BW-200', value: 850_000, stage: 'Technical discussion', owner: p.repB, ageDays: 18 });
  const oDemo = await mkOpp({ title: 'Bharat Cement - Belt weigher trial', account: bharat, contactId: bharatC.id, product: 'Belt weigher BW-200', value: 850_000, stage: 'Demo / trial', owner: p.repA, ageDays: 24 });
  const oApproval = await mkOpp({ title: 'Annapurna Foods - Weighbridge', account: anna, contactId: annaC.id, product: TW, value: 1_000_000, stage: 'Approval pending', owner: p.repB, ageDays: 40 });
  const oSolution = await mkOpp({ title: 'Shree Steel - Load cell replacement', account: shree, contactId: shreeEng.id, product: 'Load cell kit LC-10', value: 440_000, stage: 'Solution proposed', owner: p.repA, ageDays: 22 });
  const oReq = await mkOpp({ title: 'Sagar Cement - Checkweigher', account: sagar, contactId: sagarC.id, product: 'Checkweigher CW-50', value: 520_000, stage: 'Requirement collected', owner: p.repB, ageDays: 12 });
  const oTen = await mkOpp({ title: 'Konark Pharma - Weighbridge (₹10 L vs ₹11.5 L quote)', account: konark, contactId: konarkC.id, product: TW, value: 1_000_000, stage: 'Quotation sent', owner: p.repB, ageDays: 20 });
  const oRfqReady = await mkOpp({ title: 'Bharat Cement - Weighbridge 100T (RFQ ready)', account: bharat, contactId: bharatC.id, product: 'Truck Weighbridge 100T', value: 1_650_000, stage: 'Technical discussion', owner: p.repA, ageDays: 15 });
  const oRenewal = await mkOpp({ title: 'Renewal - Shree Steel AMC (WB-60-0001)', account: shree, contactId: ramesh.id, product: 'Annual AMC', value: 60_000, stage: 'Qualified', owner: p.repA, ageDays: 6, source: 'Existing customer' });
  // Volume filler so every list passes 20 rows and each rep has several opportunities.
  const fillerStages = ['Qualified', 'Requirement collected', 'Technical discussion', 'Site visit', 'Demo / trial', 'Solution proposed', 'Costing', 'Quotation sent', 'Negotiation', 'PO expected'];
  const fillerAccts = [shree, anna, bharat, konark, sagar, gati];
  for (let i = 0; i < 10; i += 1) {
    await mkOpp({
      title: `${fillerAccts[i % 6].short} - Enquiry ${i + 1}`, account: fillerAccts[i % 6], product: i % 2 ? 'Checkweigher CW-50' : TW, value: 300_000 + i * 150_000,
      stage: fillerStages[i], owner: i % 2 ? p.repB : p.repA, ageDays: 10 + i * 6, nextIn: i - 3,
    });
  }

  // ── RFQs ────────────────────────────────────────────────────────────────────
  const mkRfq = async (n: number, o: { opp: { id: string; accountId: string; owner: string }; status: string; product: string; application: string; qty?: number; revision?: number; extra?: Partial<Prisma.RfqUncheckedCreateInput> }) => {
    const rfq = await tx.rfq.create({
      data: {
        orgId, custNo: `CUST-RFQ-${String(n).padStart(3, '0')}`, opportunityId: o.opp.id, accountId: o.opp.accountId, receivedOn: at(-(10 - n)), ownerId: p.engineer,
        status: o.status, application: o.application, product: o.product, qty: o.qty ?? 1, capacity: '60 tonne', dimensions: '18 x 3 m', accuracy: 'OIML Class III', material: 'Mild steel',
        environment: 'Outdoor, dusty', utilities: '230V single phase', protocol: 'RS-232 / Modbus', erp: 'SAP', installRequired: true, calibRequired: true, compliance: 'Legal Metrology', delivery: '8 weeks',
        revision: o.revision ?? 0, ...o.extra,
      },
    });
    if ((o.revision ?? 0) > 0) await tx.rfqRevision.create({ data: { rfqId: rfq.id, revisionNumber: 1, note: 'Customer revised capacity', createdById: o.opp.owner } });
    return rfq;
  };
  await mkRfq(1, { opp: oRfqReady, status: 'Received', product: 'Truck Weighbridge 100T', application: 'Inbound raw-material weighing' });
  await mkRfq(2, { opp: oTech, status: 'Technically feasible', product: 'Belt weigher BW-200', application: 'Conveyor throughput measurement' });
  await mkRfq(3, { opp: oReq, status: 'Clarification required', product: 'Checkweigher CW-50', application: 'In-line pack weight check', extra: { specialConditions: 'Customer to confirm product range' } });
  await mkRfq(4, { opp: oPastClose, status: 'Not feasible', product: 'Truck Weighbridge 100T', application: 'Pit-type installation', extra: { specialConditions: 'Site has no foundation space' } });
  await mkRfq(5, { opp: oShreeCost, status: 'Approved for costing', product: TW, application: 'Dispatch weighing', revision: 1 });
  await mkRfq(6, { opp: oAnnaNeg, status: 'Approved for costing', product: 'Belt weigher BW-200', application: 'Ingredient dosing' });
  await mkRfq(7, { opp: oApproval, status: 'Approved for costing', product: TW, application: 'Finished-goods weighing' }); // approved, no costing yet (CST-001)

  // ── Site visits ─────────────────────────────────────────────────────────────
  const visit = (title: string, o: { opp: { id: string; accountId: string; owner: string }; status: string; in: number; extra?: Partial<Prisma.SiteVisitUncheckedCreateInput> }) =>
    tx.siteVisit.create({
      data: {
        orgId, title, opportunityId: o.opp.id, accountId: o.opp.accountId, visitDate: at(o.in), time: '11:00', ownerId: o.opp.owner, engineers: 'Application Engineer', objective: 'Site survey for weighbridge foundation and approach road',
        status: o.status, ...o.extra,
      },
    });
  await visit('Planned survey - Sagar Cement', { opp: oPastClose, status: 'Planned', in: 6 });
  await visit('Confirmed survey - Konark Pharma', { opp: oTech, status: 'Confirmed', in: 1 }); // within 24h (VIS-009)
  await visit('Completed survey - Shree Steel Plant 1', { opp: oShreeCost, status: 'Completed', in: -9, extra: { existingSystem: 'Old mechanical weighbridge', customerProblem: 'Frequent load-cell failures', measurements: 'Pit 18 x 3 m', observations: 'Foundation OK', recommendation: '60T electronic weighbridge', customerComments: 'Needs commissioning in 8 weeks', nextAction: 'Prepare costing', nextActionDate: at(2) } });
  await visit('Rescheduled survey - Annapurna', { opp: oApproval, status: 'Rescheduled', in: 9 });
  await visit('Cancelled survey - Bharat Cement', { opp: oDemo, status: 'Cancelled', in: -3 });

  // ── Evaluations (demo / trial / sample) ─────────────────────────────────────
  const evaluation = (title: string, type: string, status: string, o: { opp: { id: string; accountId: string; owner: string }; planned: number; extra?: Partial<Prisma.EvaluationUncheckedCreateInput> }) =>
    tx.evaluation.create({ data: { orgId, title, type, status, opportunityId: o.opp.id, accountId: o.opp.accountId, plannedDate: at(o.planned), ownerId: p.engineer, product: 'Belt weigher BW-200', ...o.extra } });
  await evaluation('Demo requested - Bharat belt weigher', 'Demo', 'Requested', { opp: oDemo, planned: 7 });
  await evaluation('Trial in progress - Konark', 'Trial', 'In progress', { opp: oTech, planned: -2, extra: { parameters: 'Accuracy +/-0.25%', application: 'Pack weight verification' } });
  await evaluation('Demo successful - Shree Steel', 'Demo', 'Successful', { opp: oSolution, planned: -6, extra: { actualDate: at(-6), result: 'Within tolerance', feedback: 'Customer happy' } });
  await evaluation('Trial approved - Annapurna', 'Trial', 'Customer approved', { opp: oAnnaNeg, planned: -15, extra: { actualDate: at(-15), result: 'Accepted', approvedByCustomer: 'Suresh Nair' } });
  await evaluation('Sample sent - Sagar Cement', 'Sample', 'Scheduled', { opp: oReq, planned: -4, extra: { sampleQty: 3, sampleDispatched: at(-5), serial: 'SMP-0001' } }); // planned date passed (DEM-008)
  await evaluation('Trial failed - Gati', 'Trial', 'Failed', { opp: oPastClose, planned: -20, extra: { actualDate: at(-20), result: 'Out of tolerance in humid conditions' } });

  // ── Costing sheets ──────────────────────────────────────────────────────────
  const costing = ({ opp, approvedBy, ...cost }: { opp: { id: string; accountId: string }; status: string; material: number; boughtOut: number; fabrication: number; labor: number; sellingPrice: number; approvedBy?: string }) =>
    tx.costingSheet.create({ data: { orgId, opportunityId: opp.id, accountId: opp.accountId, ownerId: p.commercial, other: 0, approvedById: approvedBy, ...cost } });
  await costing({ opp: oShreeCost, status: 'Approved', material: 400_000, boughtOut: 100_000, fabrication: 150_000, labor: 50_000, sellingPrice: 1_000_000, approvedBy: p.head }); // 30% margin
  const lowMargin = await costing({ opp: oAnnaNeg, status: 'Approval pending', material: 500_000, boughtOut: 150_000, fabrication: 150_000, labor: 80_000, sellingPrice: 1_000_000 }); // 12% margin
  await costing({ opp: oBharatQs, status: 'Draft', material: 420_000, boughtOut: 90_000, fabrication: 140_000, labor: 50_000, sellingPrice: 900_000 });
  await costing({ opp: oKonarkPo, status: 'Rejected', material: 600_000, boughtOut: 200_000, fabrication: 150_000, labor: 90_000, sellingPrice: 1_000_000 });
  await costing({ opp: oSolution, status: 'Submitted', material: 150_000, boughtOut: 50_000, fabrication: 20_000, labor: 10_000, sellingPrice: 400_000 });

  // ── Quotations / lines / approvals ──────────────────────────────────────────
  interface Line { product?: { id: string }; description: string; qty: number; unitPrice: number; discountPct: number }
  const quote = async (o: { opp: { id: string; accountId: string; owner: string }; status: string; lines: Line[]; version?: number; parentId?: string; validIn?: number; terms?: string; extra?: Partial<Prisma.QuotationUncheckedCreateInput> }) =>
    tx.quotation.create({
      data: {
        orgId, opportunityId: o.opp.id, accountId: o.opp.accountId, version: o.version ?? 1, parentId: o.parentId, quotationDate: at(-4), validUntil: at(o.validIn ?? 30), ownerId: o.opp.owner, status: o.status,
        paymentTerms: o.terms ?? '30% advance, 60% before dispatch, 10% after installation', deliveryTerms: 'Ex-works', deliveryTime: '8 weeks', warranty: '12 months', freight: 25_000, installation: 40_000,
        exclusions: 'Civil foundation work', termsAndConditions: 'Prices valid for the validity period. GST extra as applicable.',
        lines: { create: o.lines.map((l) => ({ productId: l.product?.id, description: l.description, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, amount: amount(l.qty, l.unitPrice, l.discountPct) })) },
        ...o.extra,
      },
    });
  const wbLine = (disc: number, unit = 1_000_000): Line => ({ product: wb60, description: TW, qty: 1, unitPrice: unit, discountPct: disc });
  await quote({ opp: oShreeQ, status: 'Draft', lines: [wbLine(3)] }); // max 3% discount (QUO-003)
  await quote({ opp: oSolution, status: 'Draft', lines: [{ product: lc10, description: 'Load cell LC-10', qty: 4, unitPrice: 110_000, discountPct: 12 }] }); // below min price after 12% (QUO-007)
  await quote({ opp: oReq, status: 'Draft', lines: [wbLine(2), { product: cw50, description: 'Checkweigher CW-50', qty: 1, unitPrice: 520_000, discountPct: 4 }, { product: lc10, description: 'Load cell LC-10', qty: 2, unitPrice: 110_000, discountPct: 11 }] });
  await quote({ opp: oBharatQs, status: 'Sent', lines: [{ product: cw50, description: 'Checkweigher CW-50', qty: 3, unitPrice: 520_000, discountPct: 4 }], validIn: 5 }); // validity within 7 days (QUO-016)
  const annaV1 = await quote({ opp: oAnnaNeg, status: 'Revised', lines: [{ product: bw200, description: 'Belt weigher BW-200', qty: 2, unitPrice: 850_000, discountPct: 0 }] });
  await quote({ opp: oAnnaNeg, status: 'Sent', version: 2, parentId: annaV1.id, lines: [{ product: bw200, description: 'Belt weigher BW-200', qty: 2, unitPrice: 850_000, discountPct: 5 }] });
  const qApprovalHead = await quote({ opp: oApproval, status: 'Approval pending', lines: [wbLine(12)] }); // 12% -> Sales Head
  const qApprovalMgr = await quote({ opp: oSolution, status: 'Approval pending', lines: [{ product: wb60, description: TW, qty: 1, unitPrice: 1_000_000, discountPct: 8 }], extra: { version: 2 } }); // 8% -> Sales Manager
  await quote({ opp: oPastClose, status: 'Sent', validIn: -6, lines: [{ product: wb100, description: 'Truck Weighbridge 100T', qty: 1, unitPrice: 1_650_000, discountPct: 2 }] }); // expired (QUO-017)
  await quote({ opp: oTech, status: 'Rejected', lines: [{ product: bw200, description: 'Belt weigher BW-200', qty: 1, unitPrice: 850_000, discountPct: 0 }] });
  await quote({ opp: oTen, status: 'Sent', lines: [wbLine(0, 1_150_000)] }); // ₹11.5 L vs opp ₹10 L (QUO-018)
  await quote({ opp: oDemo, status: 'Approved', lines: [{ product: bw200, description: 'Belt weigher BW-200', qty: 1, unitPrice: 850_000, discountPct: 3 }] });
  await quote({ opp: oRfqReady, status: 'Accepted', lines: [{ product: wb100, description: 'Truck Weighbridge 100T', qty: 1, unitPrice: 1_650_000, discountPct: 0 }] }); // accepted, no PO yet (PO-001)
  const approval = (title: string, o: { entityType: string; entityId: string; type: string; approver: string; level: number; rule: string; status: string; reason?: string; comments?: string; by?: string }) =>
    tx.approval.create({ data: { orgId, title, entityType: o.entityType, entityId: o.entityId, type: o.type, requestedById: o.by ?? p.repB, currentApprover: o.approver, level: o.level, matchedRule: o.rule, reason: o.reason ?? 'Customer asked for a better price', approverComments: o.comments, status: o.status } });
  await approval('Quotation discount 12% - Annapurna Foods', { entityType: 'Quotation', entityId: qApprovalHead.id, type: 'Discount', approver: 'Sales Head', level: 3, rule: 'Discount 10-15%', status: 'Requested' });
  await approval('Quotation discount 8% - Shree Steel', { entityType: 'Quotation', entityId: qApprovalMgr.id, type: 'Discount', approver: 'Sales Manager', level: 2, rule: 'Discount 5-10%', status: 'Pending', by: p.repA });
  await approval('Costing margin 12% - Annapurna belt weigher', { entityType: 'Costing', entityId: lowMargin.id, type: 'Margin', approver: 'Director', level: 4, rule: 'Margin 0-15%', status: 'Requested', by: p.commercial, reason: 'Margin below 15%' });
  await approval('Quotation discount 9% - Konark (approved)', { entityType: 'Quotation', entityId: annaV1.id, type: 'Discount', approver: 'Sales Manager', level: 2, rule: 'Discount 5-10%', status: 'Approved', comments: 'OK for strategic account' });
  await approval('Quotation discount 14% - Sagar (rejected)', { entityType: 'Quotation', entityId: annaV1.id, type: 'Discount', approver: 'Sales Head', level: 3, rule: 'Discount 10-15%', status: 'Rejected', comments: 'Too deep - hold at 10%' });
  await approval('Quotation discount 11% - Bharat (returned)', { entityType: 'Quotation', entityId: annaV1.id, type: 'Discount', approver: 'Sales Head', level: 3, rule: 'Discount 10-15%', status: 'Returned for revision', comments: 'Add competitor quote', by: p.repA });
  await approval('Credit terms 60 days - Annapurna', { entityType: 'Credit', entityId: anna.id, type: 'CreditTerms', approver: 'Accounts', level: 2, rule: 'CreditTerms 45-60', status: 'Requested', reason: 'Customer requests 60 days credit' });

  // ── Deals that run through PO → sales order → dispatch / payments / assets ──
  interface DealSpec { name: string; account: typeof shree; contact: { id: string }; owner: string; value: number; po?: { status: string; terms?: string | null; value?: number; clarification?: string; rejection?: string }; so?: { status: string; ack?: string; deliveryIn?: number; special?: string }; pay?: { milestone: string; pct: number; status: string; dueIn: number; received?: number }[]; dispatch?: { status: string; partial?: boolean; actualDelivery?: number }[] }
  const deals: DealSpec[] = [
    { name: 'Gati - weighbridge A', account: gati, contact: { id: ramesh.id }, owner: p.repA, value: 1_000_000, po: { status: 'Received', terms: '30% advance, 60% before dispatch, 10% after installation' } },
    { name: 'Shree - weighbridge PO under verification', account: shree, contact: ramesh, owner: p.repA, value: 1_000_000, po: { status: 'Under verification', terms: '30% advance, 60% before dispatch, 10% after installation' } },
    { name: 'Annapurna - PO clarification', account: anna, contact: annaC, owner: p.repB, value: 950_000, po: { status: 'Clarification required', terms: '30% advance, 70% before dispatch', value: 950_000, clarification: 'PO value differs from quotation (₹10,00,000)' } },
    { name: 'Konark - PO rejected', account: konark, contact: konarkC, owner: p.repB, value: 1_040_000, po: { status: 'Rejected / cancelled', rejection: 'Customer withdrew the order' } },
    { name: 'Sagar - PO credit terms', account: sagar, contact: sagarC, owner: p.repB, value: 520_000, po: { status: 'Under verification', terms: '45 days credit' } },
    { name: 'Bharat - PO without payment terms', account: bharat, contact: bharatC, owner: p.repA, value: 850_000, po: { status: 'Under verification', terms: null } },
    {
      name: 'Shree - SO accepted', account: shree, contact: ramesh, owner: p.repA, value: 1_000_000, po: { status: 'Accepted', terms: '30% advance, 60% before dispatch, 10% after installation' },
      so: { status: 'Order accepted', ack: 'Pending', deliveryIn: 60 },
      pay: [{ milestone: 'Advance', pct: 30, status: 'Due', dueIn: 5 }, { milestone: 'Before dispatch', pct: 60, status: 'Not due', dueIn: 50 }, { milestone: 'After installation', pct: 10, status: 'Not due', dueIn: 80 }],
    },
    {
      name: 'Annapurna - SO quality check', account: anna, contact: annaC, owner: p.repB, value: 1_700_000, po: { status: 'Accepted', terms: '30% advance, 60% before dispatch, 10% after installation' },
      so: { status: 'Quality check', ack: 'Acknowledged', deliveryIn: 20, special: 'Customer inspection before dispatch' },
      pay: [{ milestone: 'Advance', pct: 30, status: 'Partially received', dueIn: -30, received: 200_000 }, { milestone: 'Before dispatch', pct: 60, status: 'Overdue', dueIn: -1 }, { milestone: 'After installation', pct: 10, status: 'Not due', dueIn: 40 }],
    },
    {
      name: 'Bharat - SO ready for dispatch', account: bharat, contact: bharatC, owner: p.repA, value: 1_650_000, po: { status: 'Accepted', terms: '30% advance, 60% before dispatch, 10% after installation' },
      so: { status: 'Ready for dispatch', ack: 'Acknowledged', deliveryIn: 5 }, // committed delivery in 5 days, not dispatched (SO-010)
      pay: [{ milestone: 'Advance', pct: 30, status: 'Received', dueIn: -45, received: 495_000 }, { milestone: 'Before dispatch', pct: 60, status: 'Overdue', dueIn: -2 }, { milestone: 'After installation', pct: 10, status: 'Not due', dueIn: 30 }],
      dispatch: [{ status: 'Planned' }],
    },
    {
      name: 'Shree - SO installation', account: shree, contact: ramesh, owner: p.repA, value: 1_000_000, po: { status: 'Accepted', terms: '30% advance, 60% before dispatch, 10% after installation' },
      so: { status: 'Installation', ack: 'Acknowledged', deliveryIn: -15 },
      pay: [{ milestone: 'Advance', pct: 30, status: 'Received', dueIn: -70, received: 300_000 }, { milestone: 'Before dispatch', pct: 60, status: 'Received', dueIn: -40, received: 600_000 }, { milestone: 'After installation', pct: 10, status: 'Due', dueIn: 3 }],
      dispatch: [{ status: 'Delivered', actualDelivery: -16 }],
    },
    {
      name: 'Konark - SO in transit', account: konark, contact: konarkC, owner: p.repB, value: 1_040_000, po: { status: 'Accepted', terms: '50% advance, 50% before dispatch' },
      so: { status: 'Dispatched', ack: 'Acknowledged', deliveryIn: 4 }, dispatch: [{ status: 'In transit' }, { status: 'Dispatched', partial: true }],
      pay: [{ milestone: 'Advance', pct: 50, status: 'Received', dueIn: -35, received: 520_000 }, { milestone: 'Before dispatch', pct: 50, status: 'Received', dueIn: -9, received: 520_000 }],
    },
    {
      name: 'Sagar - SO commissioned', account: sagar, contact: sagarC, owner: p.repB, value: 1_650_000, po: { status: 'Accepted', terms: '30% advance, 60% before dispatch, 10% after installation' },
      so: { status: 'Commissioned', ack: 'Acknowledged', deliveryIn: -60 }, dispatch: [{ status: 'Delivered', actualDelivery: -62 }],
      pay: [{ milestone: 'Advance', pct: 30, status: 'Received', dueIn: -100, received: 495_000 }, { milestone: 'Before dispatch', pct: 60, status: 'Received', dueIn: -70, received: 990_000 }, { milestone: 'After installation', pct: 10, status: 'Received', dueIn: -50, received: 165_000 }],
    },
    {
      name: 'Bharat - SO closed', account: bharat, contact: bharatC, owner: p.repA, value: 1_000_000, po: { status: 'Accepted', terms: '100% advance' },
      so: { status: 'Closed', ack: 'Acknowledged', deliveryIn: -120 }, dispatch: [{ status: 'Delivered', actualDelivery: -125 }],
      pay: [{ milestone: 'Advance', pct: 100, status: 'Received', dueIn: -150, received: 1_000_000 }],
    },
  ];
  const orders: { id: string; account: typeof shree; status: string }[] = [];
  let poSeq = 1;
  for (const d of deals) {
    const opp = await mkOpp({ title: d.name, account: d.account, contactId: d.contact.id, product: TW, value: d.value, stage: d.po?.status === 'Accepted' ? 'PO received' : 'PO expected', owner: d.owner, ageDays: 60 });
    const q = await quote({ opp, status: 'Accepted', lines: [wbLine(0, d.value)], extra: { paymentTerms: d.po?.terms ?? '30% advance, 60% before dispatch, 10% after installation' } });
    if (!d.po) continue;
    const po = await tx.purchaseOrder.create({
      data: {
        orgId, poNo: `PO/2026/${String(poSeq++).padStart(4, '0')}`, poDate: at(-14), opportunityId: opp.id, quotationId: q.id, accountId: d.account.id, value: d.po.value ?? d.value, deliveryDate: at(60),
        paymentTerms: d.po.terms, billingAddress: `${d.account.name}, billing`, shippingAddress: `${d.account.name}, plant gate`, ownerId: p.commercial, status: d.po.status,
        clarification: d.po.clarification, rejectionReason: d.po.rejection,
      },
    });
    if (!d.so) continue;
    const so = await tx.salesOrder.create({
      data: {
        orgId, purchaseOrderId: po.id, accountId: d.account.id, value: d.value, committedDelivery: at(d.so.deliveryIn ?? 45), status: d.so.status, products: TW, drawingRef: 'DWG-WB-60-001',
        installScope: 'Vendor', commissioningScope: 'Vendor', custContactId: d.contact.id, special: d.so.special, paymentTerms: d.po.terms, ownerId: p.ops, ackStatus: d.so.ack ?? 'Pending',
      },
    });
    orders.push({ id: so.id, account: d.account, status: d.so.status });
    const trail = ['Order accepted', 'Design', 'Procurement', 'Production', 'Quality check', 'Ready for dispatch', 'Dispatched', 'Delivered', 'Installation', 'Commissioned', 'Closed'];
    const upTo = trail.indexOf(d.so.status);
    await tx.orderMilestone.createMany({ data: trail.slice(0, upTo + 1).map((status, i) => ({ salesOrderId: so.id, status, note: i === upTo ? 'Current status' : null, createdById: p.ops, createdAt: at(-(upTo - i) * 4) })) });
    for (const m of d.pay ?? []) {
      const pm = await tx.paymentMilestone.create({
        data: { orgId, salesOrderId: so.id, accountId: d.account.id, milestone: m.milestone, pct: m.pct, amount: Math.round((d.value * m.pct) / 100), dueDate: at(m.dueIn), invoiceRef: m.received ? `INV-${poSeq}${m.pct}` : null, status: m.status, receivedDate: m.status === 'Received' ? at(m.dueIn + 1) : null, accountsOwnerId: p.accounts, ownerId: d.owner },
      });
      if (m.received) await tx.receipt.create({ data: { paymentMilestoneId: pm.id, amount: m.received, receivedOn: at(m.dueIn + 1), note: 'Bank transfer (UTR test-data)', createdById: p.accounts } });
    }
    for (const [i, disp] of (d.dispatch ?? []).entries()) {
      await tx.dispatch.create({
        data: {
          orgId, salesOrderId: so.id, accountId: d.account.id, invoiceNo: disp.status === 'Planned' ? null : `GST/26/${poSeq}${i}`, invoiceDate: disp.status === 'Planned' ? null : at(-3), dispatchDate: at(disp.status === 'Planned' ? 4 : -3),
          qty: disp.partial ? '1 of 2' : '1 of 1', partial: disp.partial ?? false, status: disp.status, transporter: 'VRL Logistics', lrNumber: disp.status === 'Planned' ? null : `LR-${poSeq}${i}`, vehicleNo: 'MH12AB1234',
          ewayBill: disp.status === 'Planned' ? null : '271000123456', expectedDelivery: at(disp.status === 'Delivered' ? (disp.actualDelivery ?? -2) : 4), actualDelivery: disp.actualDelivery === undefined ? null : at(disp.actualDelivery),
        },
      });
    }
  }

  // ── Installed assets, AMC / warranty coverage, service tickets ──────────────
  const commissioned = orders.find((o) => o.status === 'Commissioned');
  const asset = (serial: string, o: { account: typeof shree; model: string; status: string; so?: string; installedAgo: number; warrantyEndIn: number; plant?: string }) =>
    tx.installedAsset.create({
      data: {
        orgId, serial, model: o.model, accountId: o.account.id, plant: o.plant ?? 'Main plant', location: 'Weighbridge bay', salesOrderId: o.so, status: o.status, installedOn: at(-o.installedAgo), commissionedOn: at(-o.installedAgo + 2),
        warrantyStart: at(-o.installedAgo + 2), warrantyEnd: at(o.warrantyEndIn), customerSignoff: 'Signed',
      },
    });
  const a1 = await asset('WB-60-0001', { account: shree, model: TW, status: 'Under warranty', installedAgo: 120, warrantyEndIn: 240, plant: 'Plant 1 - Pune MIDC' });
  const a2 = await asset('WB-60-0002', { account: sagar, model: TW, status: 'Under AMC', so: commissioned?.id, installedAgo: 400, warrantyEndIn: -35 });
  const a3 = await asset('BW-200-0001', { account: anna, model: 'Belt weigher BW-200', status: 'Under AMC', installedAgo: 300, warrantyEndIn: 65 });
  const a4 = await asset('CW-50-0001', { account: konark, model: 'Checkweigher CW-50', status: 'Under warranty', installedAgo: 60, warrantyEndIn: 300 });
  const a5 = await asset('WB-100-0001', { account: bharat, model: 'Truck Weighbridge 100T', status: 'Commissioned', installedAgo: 700, warrantyEndIn: -330 }); // warranty expired
  const cover = (a: { id: string }, accountId: string, o: { type: string; startAgo: number; endIn: number; value?: number; status: string; owner?: string; visits?: [number, number]; renewalOpp?: string; lost?: string }) =>
    tx.coverage.create({
      data: {
        orgId, assetId: a.id, accountId, type: o.type, start: at(-o.startAgo), end: at(o.endIn), value: o.value, visitsIncluded: o.visits?.[0], visitsUsed: o.visits?.[1], terms: 'As per AMC agreement',
        ownerId: o.owner ?? p.svcMgr, renewalOpportunityId: o.renewalOpp, status: o.status, lostReason: o.lost,
      },
    });
  await cover(a1, shree.id, { type: 'Warranty', startAgo: 120, endIn: 240, status: 'Not due' });
  await cover(a2, sagar.id, { type: 'AMC', startAgo: 265, endIn: 100, value: 60_000, status: 'Not due', visits: [4, 1] }); // ends in 100 days; 4 visits (AMC-002/011)
  await cover(a3, anna.id, { type: 'AMC', startAgo: 305, endIn: 60, value: 55_000, status: 'Due soon' });
  await cover(a4, konark.id, { type: 'CMC', startAgo: 320, endIn: 45, value: 90_000, status: 'Contacted' });
  await cover(a5, bharat.id, { type: 'AMC', startAgo: 365, endIn: -5, value: 60_000, status: 'Renewed' });
  await cover(a1, shree.id, { type: 'AMC', startAgo: 10, endIn: 355, value: 60_000, status: 'Quoted', renewalOpp: oRenewal.id });
  await cover(a5, bharat.id, { type: 'Paid service', startAgo: 200, endIn: 30, value: 30_000, status: 'Negotiation' });
  await cover(a3, anna.id, { type: 'AMC', startAgo: 400, endIn: -40, status: 'Lost', lost: 'Price' });
  const ticket = (description: string, a: { id: string }, account: { id: string }, o: { type: string; priority: string; status: string; coverage?: string; engineer?: boolean; visitIn?: number; extra?: Partial<Prisma.ServiceTicketUncheckedCreateInput> }) =>
    tx.serviceTicket.create({
      data: {
        orgId, description, accountId: account.id, assetId: a.id, complaintType: o.type, priority: o.priority, coverage: o.coverage ?? 'In warranty', status: o.status, engineerId: o.engineer ? p.svcEng : null,
        responseDue: o.priority === 'Critical' ? '2 hours' : o.priority === 'High' ? '4 hours' : '1 day', visitDate: o.visitIn === undefined ? null : at(o.visitIn), ...o.extra,
      },
    });
  await ticket('Display shows unstable reading', a1, shree, { type: 'Breakdown', priority: 'Critical', status: 'Open' });
  await ticket('Load cell 2 drifting', a1, shree, { type: 'Calibration', priority: 'High', status: 'Assigned', engineer: true });
  await ticket('Junction box water ingress', a1, shree, { type: 'Breakdown', priority: 'High', status: 'Closed', engineer: true, extra: { diagnosis: 'Seal damaged', action: 'Seal replaced', resolution: 'Fixed', customerConfirmation: 'Confirmed' } }); // 3 tickets on one asset (SVC-011)
  await ticket('Quarterly preventive maintenance', a2, sagar, { type: 'Preventive maintenance', priority: 'Medium', status: 'Visit scheduled', coverage: 'Under AMC', engineer: true, visitIn: 3 });
  await ticket('Belt tracking issue', a3, anna, { type: 'Breakdown', priority: 'Medium', status: 'In progress', coverage: 'Under AMC', engineer: true, extra: { diagnosis: 'Idler misalignment' } });
  await ticket('Software export to ERP failing', a4, konark, { type: 'Software / integration', priority: 'Low', status: 'Resolved', engineer: true, extra: { action: 'Config updated', resolution: 'ERP export restored', customerConfirmation: 'Pending' } });
  await ticket('Indicator replacement', a5, bharat, { type: 'Breakdown', priority: 'High', status: 'Parts required', coverage: 'Chargeable', engineer: true, extra: { partsRequired: 'Indicator board IB-2', chargeable: true } });
  await ticket('Calibration after relocation', a4, konark, { type: 'Calibration', priority: 'Medium', status: 'Customer confirmation', engineer: true, extra: { resolution: 'Calibrated', customerConfirmation: 'Pending' } });

  // ── Leads: owners, and a lead in every status the lead cases need ───────────
  const unowned = await tx.mfgLead.findMany({ where: { orgId, ownerId: null, isDeleted: false }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  for (const [i, { id }] of unowned.entries()) await tx.mfgLead.update({ where: { id }, data: { ownerId: i % 2 ? p.repB : p.repA } });
  const mkLead = (d: { company: string; contactName: string; phone: string; email?: string; status: string; owner: string; product?: string; source?: string; value?: number; city?: string; state?: string; extra?: Partial<Prisma.MfgLeadUncheckedCreateInput>; ageDays?: number }) =>
    tx.mfgLead.create({
      data: {
        orgId, company: d.company, contactName: d.contactName, designation: 'Purchase Head', phone: d.phone, email: d.email, city: d.city ?? 'Pune', state: d.state ?? 'Maharashtra', industry: 'Steel & metals',
        product: d.product ?? TW, source: d.source ?? 'IndiaMART', value: d.value ?? 2_500_000, timeline: '1–3 months', status: d.status, ownerId: d.owner, next: 'Call customer', nextDate: at(2), createdAt: at(-(d.ageDays ?? 6)), ...d.extra,
      },
    });
  const qual = { qReq: 'Truck weighbridge for inbound trucks', qApp: 'Raw-material weighing', qQty: '1', qBudget: '₹10-12 L', qAuth: 'Purchase head', qNeed: 'Replace failing mechanical unit', qTime: '3 months' };
  const leadRows = await Promise.all([
    mkLead({ company: 'Shree Steel Pvt Ltd', contactName: 'Ramesh Iyer', phone: '9876543210', email: 'buyer@shreesteel.in', status: 'New', owner: p.repA }), // Lead 1 / duplicate probe
    mkLead({ company: 'Vishwakarma Engineering Works', contactName: 'Mahesh Patil', phone: '9822011001', email: 'mahesh@vishwakarma.example.com', status: 'Contacted', owner: p.repA, ageDays: 9 }),
    mkLead({ company: 'Deccan Agro Industries', contactName: 'Lakshmi Rao', phone: '9848011002', status: 'Follow-up', owner: p.repB, city: 'Hyderabad', state: 'Telangana', ageDays: 11 }),
    mkLead({ company: 'Himalaya Foods', contactName: 'Aman Verma', phone: '9810011003', status: 'Nurture', owner: p.repB, city: 'Delhi', state: 'Delhi', ageDays: 25 }),
    mkLead({ company: 'Kaveri Sugars', contactName: 'Ravi Kumar', phone: '9880011004', status: 'Qualified', owner: p.repA, city: 'Mysuru', state: 'Karnataka', ageDays: 14, extra: qual }),
    mkLead({ company: 'Narmada Fertilisers', contactName: 'Hetal Shah', phone: '9825011005', email: 'hetal@narmada.example.com', status: 'Qualified', owner: p.repB, city: 'Vadodara', state: 'Gujarat', ageDays: 16, extra: qual }),
    mkLead({ company: 'Ganga Paper Mills', contactName: 'Sunil Yadav', phone: '9839011006', status: 'Disqualified', owner: p.repA, city: 'Kanpur', state: 'Uttar Pradesh', ageDays: 30, extra: { disqualifyReason: 'Budget not available' } }),
    mkLead({ company: 'Tata Agro Storage Hub', contactName: 'Pooja Singh', phone: '9867011007', status: 'New', owner: p.repB, value: 6_000_000, source: 'Google Ads', ageDays: 1 }), // ≥ ₹50 L value (LEAD-024)
    mkLead({ company: 'Sutlej Textiles', contactName: 'Harpreet Gill', phone: '9815011008', status: 'Contacted', owner: p.repB, source: 'IndiaMART', city: 'Ludhiana', state: 'Punjab', ageDays: 3 }),
    mkLead({ company: 'Pennar Cement', contactName: 'Srinivas Reddy', phone: '9849011009', status: 'New', owner: p.repA, source: 'Website', city: 'Hyderabad', state: 'Telangana', ageDays: 0 }), // fresh lead -> SLA-01 running
  ]);
  void leadRows;

  // ── Activities (open / completed / overdue / cancelled, mixed owners) ───────
  const someLeads = await tx.mfgLead.findMany({ where: { orgId, isDeleted: false }, select: { id: true, ownerId: true }, take: 6, orderBy: { createdAt: 'desc' } });
  const types = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Site visit', 'Demo', 'Quotation follow-up', 'PO follow-up', 'Payment follow-up', 'Service follow-up'];
  const actOwners = [p.repA, p.repB, p.repA, p.engineer, p.repB, p.commercial, p.accounts, p.svcMgr];
  const links = [
    { opportunityId: oShreeQ.id, accountId: shree.id, contactId: ramesh.id }, { opportunityId: oAnnaNeg.id, accountId: anna.id, contactId: annaC.id }, { opportunityId: oBharatQs.id, accountId: bharat.id, contactId: bharatC.id },
    { opportunityId: oKonarkPo.id, accountId: konark.id, contactId: konarkC.id }, { accountId: sagar.id, contactId: sagarC.id }, { mfgLeadId: someLeads[0]?.id }, { mfgLeadId: someLeads[1]?.id },
  ];
  const actStatus = ['Open', 'Open', 'Completed', 'Open', 'Completed', 'Cancelled'];
  for (let i = 0; i < 30; i += 1) {
    const status = actStatus[i % actStatus.length];
    await tx.mfgActivity.create({
      data: {
        orgId, type: types[i % types.length], subject: `${types[i % types.length]} - follow-up ${i + 1}`, ...links[i % links.length], dueDate: at(status === 'Open' ? (i % 4) - 1 : -(i % 7)), dueTime: '11:00',
        priority: ['High', 'Medium', 'Low'][i % 3], ownerId: actOwners[i % actOwners.length], status, notes: 'Seeded for manual testing',
        outcome: status === 'Completed' ? 'Customer will revert this week' : null, nextAction: status === 'Completed' ? 'Send revised quote' : null, nextActionDate: status === 'Completed' ? at(3) : null,
      },
    });
  }
  await tx.mfgActivity.create({ data: { orgId, type: 'Quotation follow-up', subject: 'OVERDUE: chase Annapurna quotation', opportunityId: oAnnaNeg.id, accountId: anna.id, contactId: annaC.id, dueDate: at(-3), dueTime: '10:00', priority: 'High', ownerId: p.repB, status: 'Open' } });

  // ── Notifications for every member (bell + notification page) ───────────────
  const everyone = [...new Set(Object.values(p))];
  await tx.notification.createMany({
    data: everyone.flatMap((userId) => [
      { orgId, userId, title: 'SLA breached: Lead first response', body: 'Pennar Cement lead has had no first response within target.', link: '/leads', isRead: false },
      { orgId, userId, title: 'Approval pending', body: 'Quotation discount 12% - Annapurna Foods needs a decision.', link: '/approvals', isRead: false },
      { orgId, userId, title: 'Payment overdue', body: 'Before-dispatch milestone for Bharat Cement is overdue.', link: '/payments', isRead: true },
    ]),
  });
};

const main = async () => {
  const login = await prisma.user.findFirst({ where: { email: { equals: loginEmail, mode: 'insensitive' } }, select: { id: true, orgId: true } });
  if (!login?.orgId) throw new Error(`User ${loginEmail} not found or has no org`);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: login.orgId }, select: { id: true, name: true, workspaceType: true } });
  if (org.workspaceType !== WorkspaceType.MANUFACTURING) throw new Error(`Org ${org.name} is ${org.workspaceType}, not MANUFACTURING`);

  const members = await prisma.user.findMany({ where: { orgId: org.id, isActive: true }, select: { id: true, name: true, email: true, mfgRole: true, teamId: true }, orderBy: { createdAt: 'asc' } });
  const roleMembers = (r: MfgRole) => members.filter((m) => m.mfgRole === r);
  const first = (r: MfgRole, fallbacks: MfgRole[] = []) => [r, ...fallbacks].map((x) => roleMembers(x)[0]?.id).find(Boolean) ?? login.id;
  const people: People = {
    admin: login.id,
    repA: roleMembers(MfgRole.SALES_EXECUTIVE)[0]?.id ?? first(MfgRole.SALES_MANAGER),
    repB: roleMembers(MfgRole.SALES_EXECUTIVE)[1]?.id ?? roleMembers(MfgRole.SALES_EXECUTIVE)[0]?.id ?? first(MfgRole.SALES_MANAGER),
    manager: first(MfgRole.SALES_MANAGER), head: first(MfgRole.SALES_HEAD, [MfgRole.DIRECTOR]), director: first(MfgRole.DIRECTOR),
    engineer: first(MfgRole.APPLICATION_ENGINEER), commercial: first(MfgRole.COMMERCIAL_ESTIMATION), ops: first(MfgRole.OPERATIONS), accounts: first(MfgRole.ACCOUNTS),
    svcMgr: first(MfgRole.SERVICE_MANAGER), svcEng: first(MfgRole.SERVICE_ENGINEER),
  };
  const nameOf = (id: string) => members.find((m) => m.id === id)?.email ?? `${id} (login user fallback)`;
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} - org "${org.name}" (${org.id}), ${members.length} active member(s)`);
  for (const m of members) console.log(`  member ${m.email}  ${m.mfgRole ?? '(no mfgRole)'}  team=${m.teamId ?? '-'}`);
  for (const [k, id] of Object.entries(people)) console.log(`  ${k.padEnd(10)} -> ${nameOf(id)}`);
  const [leads, accounts] = await Promise.all([prisma.mfgLead.count({ where: { orgId: org.id } }), prisma.account.count({ where: { orgId: org.id } })]);
  console.log(`  existing: ${leads} MfgLead, ${accounts} Account`);
  if (!apply) return console.log('Dry run only - re-run with --apply to write.');
  if (await prisma.account.findFirst({ where: { orgId: org.id, name: 'Shree Steel Pvt Ltd' }, select: { id: true } })) {
    return console.log("Account 'Shree Steel Pvt Ltd' already exists - test data was seeded before. Nothing written.");
  }

  await prisma.$transaction(
    async (tx) => {
      await seedDefaults(tx, org.id);
      // TEAM record access needs a team: put team-less sales/engineering members under one team managed by the Sales Manager.
      const needTeam = members.filter((m) => !m.teamId && ([MfgRole.SALES_MANAGER, MfgRole.SALES_EXECUTIVE, MfgRole.APPLICATION_ENGINEER] as (MfgRole | null)[]).includes(m.mfgRole));
      if (needTeam.length) {
        const team = (await tx.team.findFirst({ where: { orgId: org.id, name: 'Team A' } })) ?? (await tx.team.create({ data: { name: 'Team A', orgId: org.id, managerId: roleMembers(MfgRole.SALES_MANAGER)[0]?.id } }));
        await tx.user.updateMany({ where: { id: { in: needTeam.map((m) => m.id) } }, data: { teamId: team.id } });
        console.log(`  put ${needTeam.length} member(s) into "Team A"`);
      }
      await seedTestData(tx, org.id, people);
      if (rollback) throw new Error('ROLLBACK_OK');
    },
    { timeout: 300_000, maxWait: 30_000 },
  ).catch((e: unknown) => {
    if (rollback && e instanceof Error && e.message === 'ROLLBACK_OK') return 'rolled-back';
    throw e;
  });
  if (rollback) return console.log('Rollback run OK - every insert succeeded and was undone.');
  console.log('Seeded. Summary:');
  for (const [model, n] of Object.entries({
    account: await prisma.account.count({ where: { orgId: org.id } }), contact: await prisma.contact.count({ where: { orgId: org.id } }), mfgLead: await prisma.mfgLead.count({ where: { orgId: org.id } }),
    opportunity: await prisma.opportunity.count({ where: { orgId: org.id } }), mfgActivity: await prisma.mfgActivity.count({ where: { orgId: org.id } }), rfq: await prisma.rfq.count({ where: { orgId: org.id } }),
    quotation: await prisma.quotation.count({ where: { orgId: org.id } }), purchaseOrder: await prisma.purchaseOrder.count({ where: { orgId: org.id } }), salesOrder: await prisma.salesOrder.count({ where: { orgId: org.id } }),
    paymentMilestone: await prisma.paymentMilestone.count({ where: { orgId: org.id } }), installedAsset: await prisma.installedAsset.count({ where: { orgId: org.id } }), serviceTicket: await prisma.serviceTicket.count({ where: { orgId: org.id } }),
  })) console.log(`  ${model}: ${n}`);
};

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
