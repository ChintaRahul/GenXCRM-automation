// Backfills the 100-character lead name cap (SCRUM-4) onto leads created BEFORE the
// limit was enforced. Trims/collapses whitespace the same way LeadsService.normalizeName
// does, then truncates anything still over 100 chars.
//
// Defaults to a dry run (prints what it would do, writes nothing). Pass DRY_RUN=false to
// apply. Idempotent — only touches leads whose normalized name still exceeds 100 chars,
// so re-running after a partial failure just picks up where it left off.
//
// Run with:
//   npm run backfill:lead-names
//   DRY_RUN=false npm run backfill:lead-names

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN !== 'false';
const MAX_NAME_LENGTH = 100;

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true },
  });

  const overLimit = leads
    .map((lead) => ({ lead, normalized: normalizeName(lead.name) }))
    .filter(({ normalized }) => normalized.length > MAX_NAME_LENGTH);

  console.log(`Found ${overLimit.length} lead(s) with a name over ${MAX_NAME_LENGTH} characters (of ${leads.length} total).`);
  console.log(DRY_RUN ? 'DRY RUN — no writes will be made.\n' : 'LIVE RUN — writes will be applied.\n');

  let updated = 0;

  for (const { lead, normalized } of overLimit) {
    const truncated = normalized.slice(0, MAX_NAME_LENGTH);

    if (DRY_RUN) {
      console.log(`  would update lead ${lead.id}: "${lead.name}" (${lead.name.length} chars) -> "${truncated}"`);
      updated++;
      continue;
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { name: truncated } });
    updated++;
    console.log(`  + updated lead ${lead.id} -> "${truncated}"`);
  }

  console.log(`\nDone. updated=${updated} total=${leads.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
