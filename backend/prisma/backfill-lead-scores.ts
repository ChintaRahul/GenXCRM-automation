// One-time backfill: computes each existing lead's engagement score from its
// historical communications/activities, using the same point values the live
// app now applies going forward (see common/constants/lead.constants.ts
// ENGAGEMENT_SCORE_POINTS). Without this, every lead created before the
// engagement-scoring fix stays at score: 0 forever — Not Engaged would only
// self-correct as new activity accrues.
//
// Run once, against production, via the connect-prod-db.ps1 tunnel:
//   DATABASE_URL="postgresql://USER:PASSWORD@localhost:5433/genxcrm?sslmode=require" \
//     npx ts-node prisma/backfill-lead-scores.ts
//
// Adds to whatever score a lead may already have (does not overwrite) so it is
// safe to run even if some leads have already earned points post-deploy.
import { PrismaClient } from '@prisma/client';
import { bumpLeadScore } from '../src/common/utils/lead-score.util';
import { SYSTEM_ACTIVITY_TYPES, ENGAGEMENT_SCORE_POINTS } from '../src/common/constants/lead.constants';

const prisma = new PrismaClient();

async function main() {
  const points = new Map<string, number>();
  const add = (leadId: string, amount: number) => points.set(leadId, (points.get(leadId) ?? 0) + amount);

  const calls = await prisma.communication.groupBy({
    by: ['leadId'],
    where: { type: 'CALL' },
    _count: { _all: true },
  });
  for (const row of calls) add(row.leadId, row._count._all * ENGAGEMENT_SCORE_POINTS.CALL);

  const messages = await prisma.communication.groupBy({
    by: ['leadId'],
    where: { type: { in: ['EMAIL', 'SMS', 'WHATSAPP'] }, status: 'sent' },
    _count: { _all: true },
  });
  // EMAIL/SMS/WHATSAPP each carry the same point value today, so a flat count is fine —
  // if that ever diverges per-channel, group `messages` `by: ['leadId', 'type']` instead.
  for (const row of messages) add(row.leadId, row._count._all * ENGAGEMENT_SCORE_POINTS.EMAIL);

  const stageChanges = await prisma.activity.groupBy({
    by: ['leadId'],
    where: { type: 'STAGE_CHANGE' },
    _count: { _all: true },
  });
  for (const row of stageChanges) add(row.leadId, row._count._all * ENGAGEMENT_SCORE_POINTS.STAGE_CHANGE);

  // Every other rep-written activity type counts as a NOTE — excludes system types
  // (ASSIGNED/REASSIGN/ASSIGNMENT_FAILED), CALL (already counted via Communication
  // above, since logCall/completeCallRecording both write a CALL Communication), and
  // STAGE_CHANGE (counted above).
  const notes = await prisma.activity.groupBy({
    by: ['leadId'],
    where: { type: { notIn: [...SYSTEM_ACTIVITY_TYPES, 'CALL', 'STAGE_CHANGE'] } },
    _count: { _all: true },
  });
  for (const row of notes) add(row.leadId, row._count._all * ENGAGEMENT_SCORE_POINTS.NOTE);

  const entries = [...points.entries()].filter(([, amount]) => amount > 0);
  console.log(`Backfilling engagement score for ${entries.length} leads with prior activity...`);

  const CHUNK = 25;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    await Promise.all(chunk.map(([leadId, amount]) => bumpLeadScore(prisma, leadId, amount)));
    console.log(`  ${Math.min(i + CHUNK, entries.length)}/${entries.length}`);
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
