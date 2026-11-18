// Seeds a small, fixed E2E test organization used by the Playwright suite in `e2e/`.
// Idempotent (upsert by fixed email) so it can be re-run before every test session
// without accumulating duplicate orgs/users. Only ever run against the dedicated
// `genxcrm_test` database (see e2e/README.md) — never against real dev/prod data.
//
// Run with:
//   npm run db:seed:e2e   (from backend/, uses .env.e2e.local -> .env.local -> .env)

import { assertE2eDatabase } from './e2e-db-guard';
import { PrismaClient, Role, Industry, OrgSize, PlanStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ORG_SLUG = 'genxcrm-e2e-org';
export const E2E_PASSWORD = 'E2ePass@12345';

export const E2E_USERS = {
  director: { email: 'e2e.director@genxcrm-e2e.example', role: Role.DIRECTOR },
  manager: { email: 'e2e.manager@genxcrm-e2e.example', role: Role.MANAGER },
  salesRep: { email: 'e2e.salesrep@genxcrm-e2e.example', role: Role.SALES_REP },
} as const;

async function main() {
  assertE2eDatabase();
  console.log('Seeding E2E test data...');
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

  let org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });

  const director = await prisma.user.upsert({
    where: { email: E2E_USERS.director.email },
    create: {
      name: 'E2E Director',
      email: E2E_USERS.director.email,
      passwordHash,
      role: Role.DIRECTOR,
      isActive: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash, isActive: true, emailVerified: true },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'GenXCRM E2E Org',
        slug: ORG_SLUG,
        industry: Industry.EDTECH,
        size: OrgSize.SMALL,
        country: 'India',
        timezone: 'Asia/Kolkata',
        planStatus: PlanStatus.ACTIVE,
        trialEndsAt: new Date('2099-01-01'),
        ownerId: director.id,
      },
    });
  } else {
    org = await prisma.organization.update({
      where: { id: org.id },
      data: { planStatus: PlanStatus.ACTIVE, trialEndsAt: new Date('2099-01-01') },
    });
  }

  await prisma.user.update({ where: { id: director.id }, data: { orgId: org.id } });

  const existingTeam = await prisma.team.findFirst({ where: { orgId: org.id, name: 'E2E Team' } });
  const team = existingTeam ?? (await prisma.team.create({ data: { name: 'E2E Team', orgId: org.id } }));

  const manager = await prisma.user.upsert({
    where: { email: E2E_USERS.manager.email },
    create: {
      name: 'E2E Manager',
      email: E2E_USERS.manager.email,
      passwordHash,
      role: Role.MANAGER,
      isActive: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      orgId: org.id,
      teamId: team.id,
    },
    update: { passwordHash, isActive: true, emailVerified: true, orgId: org.id, teamId: team.id },
  });

  await prisma.team.update({ where: { id: team.id }, data: { managerId: manager.id } });

  await prisma.user.upsert({
    where: { email: E2E_USERS.salesRep.email },
    create: {
      name: 'E2E Sales Rep',
      email: E2E_USERS.salesRep.email,
      passwordHash,
      role: Role.SALES_REP,
      isActive: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      orgId: org.id,
      teamId: team.id,
    },
    update: { passwordHash, isActive: true, emailVerified: true, orgId: org.id, teamId: team.id },
  });

  console.log(`E2E org ready: ${org.id} (${ORG_SLUG})`);
  console.log(`  director: ${E2E_USERS.director.email}`);
  console.log(`  manager:  ${E2E_USERS.manager.email}`);
  console.log(`  salesRep: ${E2E_USERS.salesRep.email}`);
  console.log(`  password (all): ${E2E_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
