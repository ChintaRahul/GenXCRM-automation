import { Prisma, PrismaClient } from '@prisma/client';

// Raises Lead.score by `points`, clamped at 100, without a read-then-write round trip.
// Accepts either the top-level PrismaService or a $transaction callback's `tx` client —
// both expose $executeRaw with this signature. Never throws on a missing lead: the
// caller has typically already resolved the lead for its own purposes, so a 0-row
// update here is not itself an error worth surfacing.
export async function bumpLeadScore(
  prisma: Pick<PrismaClient, '$executeRaw'> | Prisma.TransactionClient,
  leadId: string,
  points: number,
): Promise<void> {
  await prisma.$executeRaw`UPDATE "Lead" SET score = LEAST(score + ${points}, 100) WHERE id = ${leadId}`;
}
