// Seeds the Manufacturing org(s) used by the Playwright suite (e2e/specs/mfg). Idempotent.
// Only ever run against the dedicated `genxcrm_test` DB:  npm run db:seed:e2e:mfg
import { PrismaClient, Role, MfgRole, WorkspaceType, Industry, OrgSize, PlanStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { assertE2eDatabase } from './e2e-db-guard';
import {
  APPROVAL_RULE_DEFAULTS, BUSINESS_CALENDAR_DEFAULT, HOLIDAY_DEFAULTS, REPORT_DEFAULTS, SLA_POLICY_DEFAULTS,
  buildFieldPermissionDefaults, buildMasterValueDefaults, buildRolePermissionDefaults,
} from '../src/modules/manufacturing-defaults/manufacturing-defaults.data';

const prisma = new PrismaClient();
export const E2E_PASSWORD = 'E2ePass@12345';
// Keep in sync with e2e/mfg/orgs.ts (E2E_ORG_SLUGS; the e2e package cannot import from backend).
const SLUG_A = 'genxcrm-e2e-mfg';
const SLUG_B = 'genxcrm-e2e-mfg-b';

// key -> [display name, legacy Role, MfgRole]
const USERS_A = {
  superAdmin: ['Mfg Super Admin', Role.DIRECTOR, MfgRole.SUPER_ADMIN],
  director: ['Mfg Director', Role.DIRECTOR, MfgRole.DIRECTOR],
  salesHead: ['Mfg Sales Head', Role.MANAGER, MfgRole.SALES_HEAD],
  salesManager: ['Mfg Sales Manager', Role.MANAGER, MfgRole.SALES_MANAGER],
  salesExec1: ['Mfg Sales Exec 1', Role.SALES_REP, MfgRole.SALES_EXECUTIVE],
  salesExec2: ['Mfg Sales Exec 2', Role.SALES_REP, MfgRole.SALES_EXECUTIVE],
  appEngineer: ['Mfg App Engineer', Role.SALES_REP, MfgRole.APPLICATION_ENGINEER],
  commercial: ['Mfg Commercial', Role.SALES_REP, MfgRole.COMMERCIAL_ESTIMATION],
  operations: ['Mfg Operations', Role.SALES_REP, MfgRole.OPERATIONS],
  accounts: ['Mfg Accounts', Role.SALES_REP, MfgRole.ACCOUNTS],
  serviceManager: ['Mfg Service Manager', Role.SALES_REP, MfgRole.SERVICE_MANAGER],
  serviceEngineer: ['Mfg Service Engineer', Role.SALES_REP, MfgRole.SERVICE_ENGINEER],
} as const;

const email = (key: string) => `mfg.${key.toLowerCase()}@genxcrm-e2e.example`;

// Fills only the tables that are still empty for this org (same rule as backfill-manufacturing-defaults.ts).
const seedDefaults = async (orgId: string) => {
  const has = async (n: Promise<number>) => (await n) > 0;
  if (!(await has(prisma.rolePermission.count({ where: { orgId } })))) {
    await prisma.rolePermission.createMany({ data: buildRolePermissionDefaults().map((d) => ({ ...d, orgId })) });
  }
  if (!(await has(prisma.fieldPermission.count({ where: { orgId } })))) {
    await prisma.fieldPermission.createMany({ data: buildFieldPermissionDefaults().map((d) => ({ ...d, orgId })) });
  }
  if (!(await has(prisma.approvalRule.count({ where: { orgId } })))) {
    await prisma.approvalRule.createMany({ data: APPROVAL_RULE_DEFAULTS.map((r) => ({ ...r, orgId })) });
  }
  if (!(await has(prisma.masterValue.count({ where: { orgId } })))) {
    await prisma.masterValue.createMany({ data: buildMasterValueDefaults().map((m) => ({ ...m, orgId })) });
  }
  if (!(await has(prisma.businessCalendar.count({ where: { orgId } })))) {
    await prisma.businessCalendar.create({
      data: { orgId, timezone: BUSINESS_CALENDAR_DEFAULT.timezone, days: BUSINESS_CALENDAR_DEFAULT.days as Prisma.InputJsonValue },
    });
  }
  if (!(await has(prisma.holiday.count({ where: { orgId } })))) {
    await prisma.holiday.createMany({ data: HOLIDAY_DEFAULTS.map((h) => ({ orgId, name: h.name, date: new Date(h.date) })) });
  }
  if (!(await has(prisma.slaPolicy.count({ where: { orgId } })))) {
    await prisma.slaPolicy.createMany({
      data: SLA_POLICY_DEFAULTS.map((p) => ({
        orgId, moduleKey: p.moduleKey, name: p.name, startEvent: p.startEvent, stopEvent: p.stopEvent,
        calendarType: p.calendarType, targets: p.targets as unknown as Prisma.InputJsonValue,
        escalationLevels: p.escalationLevels as unknown as Prisma.InputJsonValue, pauseStatuses: p.pauseStatuses, isActive: true,
      })),
    });
  }
  if (!(await has(prisma.report.count({ where: { orgId } })))) {
    await prisma.report.createMany({ data: REPORT_DEFAULTS.map((r) => ({ ...r, orgId })) });
  }
};

const upsertUser = async (key: string, name: string, role: Role, mfgRole: MfgRole, passwordHash: string, orgId?: string, teamId?: string) =>
  prisma.user.upsert({
    where: { email: email(key) },
    create: { name, email: email(key), passwordHash, role, mfgRole, isActive: true, emailVerified: true, emailVerifiedAt: new Date(), orgId, teamId },
    update: { passwordHash, role, mfgRole, isActive: true, emailVerified: true, orgId, teamId },
  });

// A full-suite run lasts hours; the mfg storage states hold a JWT whose lifetime comes from the org's Security > Session timeout (default 60 min).
const E2E_SESSION_TIMEOUT_MINUTES = 12 * 60;

const ensureOrg = async (slug: string, name: string, ownerId: string) => {
  const data = {
    name, slug, industry: Industry.MANUFACTURING, workspaceType: WorkspaceType.MANUFACTURING, size: OrgSize.SMALL,
    country: 'India', timezone: 'Asia/Kolkata', planStatus: PlanStatus.ACTIVE, trialEndsAt: new Date('2099-01-01'), ownerId,
  };
  const existing = await prisma.organization.findUnique({ where: { slug } });
  // Merge into the stored settings (never overwrite other security keys).
  const securitySettings = { ...((existing?.securitySettings as Prisma.JsonObject | null) ?? {}), sessionTimeoutMinutes: E2E_SESSION_TIMEOUT_MINUTES };
  return existing
    ? prisma.organization.update({ where: { id: existing.id }, data: { planStatus: PlanStatus.ACTIVE, trialEndsAt: data.trialEndsAt, workspaceType: WorkspaceType.MANUFACTURING, securitySettings } })
    : prisma.organization.create({ data: { ...data, securitySettings } });
};

const main = async () => {
  assertE2eDatabase();
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

  // Org A
  const [adminName, adminRole, adminMfg] = USERS_A.superAdmin;
  const admin = await upsertUser('superAdmin', adminName, adminRole, adminMfg, passwordHash);
  const orgA = await ensureOrg(SLUG_A, 'GenXCRM E2E Manufacturer', admin.id);
  await prisma.user.update({ where: { id: admin.id }, data: { orgId: orgA.id } });

  const team = (await prisma.team.findFirst({ where: { orgId: orgA.id, name: 'Mfg E2E Team' } }))
    ?? (await prisma.team.create({ data: { name: 'Mfg E2E Team', orgId: orgA.id } }));
  const created: Record<string, string> = { superAdmin: admin.id };
  for (const [key, [name, role, mfgRole]] of Object.entries(USERS_A)) {
    if (key === 'superAdmin') continue;
    const u = await upsertUser(key, name, role, mfgRole, passwordHash, orgA.id, team.id);
    created[key] = u.id;
  }
  await prisma.team.update({ where: { id: team.id }, data: { managerId: created.salesManager } });
  await seedDefaults(orgA.id);

  // Org B (tenant-isolation only)
  const adminB = await upsertUser('orgBAdmin', 'Mfg Org B Admin', Role.DIRECTOR, MfgRole.SUPER_ADMIN, passwordHash);
  const orgB = await ensureOrg(SLUG_B, 'GenXCRM E2E Manufacturer B', adminB.id);
  await prisma.user.update({ where: { id: adminB.id }, data: { orgId: orgB.id } });
  await seedDefaults(orgB.id);

  console.log(`Mfg E2E orgs ready: A=${orgA.id} B=${orgB.id}; password (all): ${E2E_PASSWORD}`);
};

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
