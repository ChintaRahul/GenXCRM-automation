// Backfills the default "Welcome New Leads" nurturing sequence for existing active orgs
// (planStatus ACTIVE or TRIAL). New orgs get this automatically on signup; this script
// covers orgs created before that behavior existed.
//
// Also refreshes existing welcome sequences whose email step still has the original
// plain-text body, upgrading them to the current HTML + {{org}} version. It only touches
// the known default body, so org-customized welcome emails are left untouched.
//
// Idempotent and safe to re-run. Expired/cancelled orgs are intentionally excluded.
//
// Run with:
//   npm run backfill:welcome          (uses .env)
//   npm run backfill:welcome:local    (uses .env.local then .env)

import { PrismaClient, PlanStatus } from '@prisma/client';
import { WELCOME_SEQUENCE_TRIGGER, welcomeSequenceCreateData } from '../src/modules/nurturing/welcome-sequence';

const prisma = new PrismaClient();

const ACTIVE_STATUSES: PlanStatus[] = [PlanStatus.ACTIVE, PlanStatus.TRIAL];

// The original plain-text welcome body shipped before HTML + {{org}}. Used to detect
// unedited default steps so we only refresh those.
const OLD_WELCOME_BODY =
  'Hi {{name}},\n\n' +
  "Thank you for reaching out to us! We've received your enquiry and one of our " +
  'counselors will get in touch with you shortly.\n\n' +
  'Best regards,\nThe Team';

const NEW_WELCOME_BODY = welcomeSequenceCreateData('x').steps.create[0].body;

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { planStatus: { in: ACTIVE_STATUSES } },
    select: { id: true, name: true },
  });

  console.log(`Found ${orgs.length} active org(s) (planStatus in ${ACTIVE_STATUSES.join(', ')}).`);

  let created = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const org of orgs) {
    const existing = await prisma.nurturingSequence.findFirst({
      where: { orgId: org.id, triggerEvent: WELCOME_SEQUENCE_TRIGGER },
      select: { id: true, steps: { where: { type: 'email' }, select: { id: true, body: true } } },
    });

    if (!existing) {
      await prisma.nurturingSequence.create({ data: welcomeSequenceCreateData(org.id) });
      created++;
      console.log(`  + Created welcome sequence for "${org.name}" (${org.id})`);
      continue;
    }

    // Upgrade an unedited default step to the new HTML + {{org}} body.
    const stale = existing.steps.find((s) => s.body === OLD_WELCOME_BODY);
    if (stale) {
      await prisma.nurturingStep.update({ where: { id: stale.id }, data: { body: NEW_WELCOME_BODY } });
      refreshed++;
      console.log(`  ~ Refreshed welcome email for "${org.name}" (${org.id})`);
    } else {
      skipped++;
    }
  }

  console.log(`Done. created=${created} refreshed=${refreshed} skipped=${skipped} total=${orgs.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
