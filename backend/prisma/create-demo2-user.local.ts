// One-off local script: creates a lightweight dummy DIRECTOR user + trial org for
// manual UI testing (e.g. the coupon/offer subscribe flow), mirroring the field shape
// AuthService.register() creates — 14-day trial, email pre-verified so no verification
// link is needed to log in. Safe to re-run: no-ops if the user already exists.
//   npx dotenv -e .env.local -e .env -- ts-node prisma/create-demo2-user.local.ts
import { PrismaClient, Role, Industry, OrgSize } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const EMAIL = 'demo2@genxcrm.local';
const PASSWORD = 'Demo@12345';
const ORG_NAME = 'Demo2 Test Org';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    console.log(`${EMAIL} already exists (id ${existing.id}) — nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const slug = `demo2-test-org-${Date.now()}`;

  const { user, org } = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: 'Demo Two',
        email: EMAIL,
        passwordHash,
        role: Role.DIRECTOR,
        isActive: true,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    const newOrg = await tx.organization.create({
      data: {
        name: ORG_NAME,
        slug,
        industry: Industry.EDTECH,
        size: OrgSize.SMALL,
        country: 'India',
        timezone: 'Asia/Kolkata',
        ownerId: newUser.id,
        trialEndsAt,
        termsAcceptedAt: new Date(),
      },
    });

    await tx.user.update({ where: { id: newUser.id }, data: { orgId: newOrg.id } });
    return { user: newUser, org: newOrg };
  });

  console.log(`Created ${EMAIL} / ${PASSWORD}`);
  console.log(`Org: "${org.name}" (${org.id}), planStatus=${org.planStatus}, trialEndsAt=${org.trialEndsAt.toISOString()}`);
  console.log(`User: ${user.id}, role=${user.role}, emailVerified=true`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
