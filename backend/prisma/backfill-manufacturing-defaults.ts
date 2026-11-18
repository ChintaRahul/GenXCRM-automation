// Backfills Manufacturing-workspace defaults for orgs that were created before
// ManufacturingDefaultsService existed (or whose registration-time seed failed).
//
// Unlike seedForOrg() — which skips an org entirely once it has any RolePermission — this checks
// each table on its own, so a partly-seeded org only gets what it is missing, and nothing an admin
// has already configured is touched or duplicated.
//
// Dry-run by default. Pass --apply to write; pass --org=<orgId> to limit to one org.
//   local: npm run backfill:mfg-defaults:local [-- --apply]
//   prod:  DATABASE_URL=<prod url> ts-node prisma/backfill-manufacturing-defaults.ts [--apply]
import { PrismaClient, Prisma, WorkspaceType } from '@prisma/client';
import {
  APPROVAL_RULE_DEFAULTS,
  BUSINESS_CALENDAR_DEFAULT,
  HOLIDAY_DEFAULTS,
  REPORT_DEFAULTS,
  SLA_POLICY_DEFAULTS,
  buildFieldPermissionDefaults,
  buildMasterValueDefaults,
  buildRolePermissionDefaults,
} from '../src/modules/manufacturing-defaults/manufacturing-defaults.data';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const onlyOrg = process.argv.find((a) => a.startsWith('--org='))?.slice('--org='.length);

const main = async () => {
  const orgs = await prisma.organization.findMany({
    where: { workspaceType: WorkspaceType.MANUFACTURING, ...(onlyOrg ? { id: onlyOrg } : {}) },
    select: { id: true, name: true },
  });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${orgs.length} manufacturing org(s)`);

  for (const { id: orgId, name } of orgs) {
    const [rolePerm, fieldPerm, rules, masters, calendar, holidays, sla, reports] = await Promise.all([
      prisma.rolePermission.count({ where: { orgId } }),
      prisma.fieldPermission.count({ where: { orgId } }),
      prisma.approvalRule.count({ where: { orgId } }),
      prisma.masterValue.count({ where: { orgId } }),
      prisma.businessCalendar.count({ where: { orgId } }),
      prisma.holiday.count({ where: { orgId } }),
      prisma.slaPolicy.count({ where: { orgId } }),
      prisma.report.count({ where: { orgId } }),
    ]);
    const missing = Object.entries({ rolePerm, fieldPerm, rules, masters, calendar, holidays, sla, reports })
      .filter(([, n]) => n === 0)
      .map(([k]) => k);
    console.log(`- ${name} (${orgId}): missing [${missing.join(', ') || 'nothing'}]`);
    if (!apply || !missing.length) continue;

    await prisma.$transaction(async (tx) => {
      if (!rolePerm) await tx.rolePermission.createMany({ data: buildRolePermissionDefaults().map((d) => ({ ...d, orgId })) });
      if (!fieldPerm) await tx.fieldPermission.createMany({ data: buildFieldPermissionDefaults().map((d) => ({ ...d, orgId })) });
      if (!rules) await tx.approvalRule.createMany({ data: APPROVAL_RULE_DEFAULTS.map((r) => ({ ...r, orgId })) });
      if (!masters) await tx.masterValue.createMany({ data: buildMasterValueDefaults().map((m) => ({ ...m, orgId })) });
      if (!calendar) {
        await tx.businessCalendar.create({
          data: { orgId, timezone: BUSINESS_CALENDAR_DEFAULT.timezone, days: BUSINESS_CALENDAR_DEFAULT.days as Prisma.InputJsonValue },
        });
      }
      if (!holidays) await tx.holiday.createMany({ data: HOLIDAY_DEFAULTS.map((h) => ({ orgId, name: h.name, date: new Date(h.date) })) });
      if (!sla) {
        await tx.slaPolicy.createMany({
          data: SLA_POLICY_DEFAULTS.map((p) => ({
            orgId,
            moduleKey: p.moduleKey,
            name: p.name,
            startEvent: p.startEvent,
            stopEvent: p.stopEvent,
            calendarType: p.calendarType,
            targets: p.targets as unknown as Prisma.InputJsonValue,
            escalationLevels: p.escalationLevels as unknown as Prisma.InputJsonValue,
            pauseStatuses: p.pauseStatuses,
            isActive: true,
          })),
        });
      }
      if (!reports) await tx.report.createMany({ data: REPORT_DEFAULTS.map((r) => ({ ...r, orgId })) });
    });
    console.log(`  seeded: ${missing.join(', ')}`);
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
