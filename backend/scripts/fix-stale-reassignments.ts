/**
 * One-off remediation for the "Administration > Routing" stale-reassignment bug
 * (2026-09-08). DEFAULT_ROUTING_SETTINGS.reassignIfUntouchedDays defaulted to 3
 * (opt-out instead of opt-in), so a daily sweep
 * (formerly backend/src/modules/assignments/reassignment.processor.ts) silently
 * stripped leads from reps the moment 3 days passed without a non-system Activity,
 * even for leads deep in the pipeline (e.g. DEMO_ATTENDED) whose rep was
 * legitimately waiting on the client.
 *
 * The feature itself has since been removed entirely — once round robin assigns a
 * lead, nothing in the codebase reassigns it automatically again, regardless of any
 * org's settings. This script only repairs leads that were already mis-assigned
 * before the removal.
 *
 * Detection relies on a fact about the codebase: a lead can only accumulate MORE
 * THAN ONE Activity of type 'ASSIGNED'. Every other path either fires 'ASSIGNED' at
 * most once per lead (assignRoundRobin/assignRoundRobinOrg refuse to touch an
 * already-assigned lead — see AssignmentsService.isAssignable) or logs a 'REASSIGN'
 * activity instead (LeadsService.update / UsersService, for deliberate manual
 * reassignment). So any lead with 2+ 'ASSIGNED' activities was, by construction,
 * swept by the (now-removed) bug at least once — every activity after the first is
 * a bug-caused reassignment, and the lead's true owner is whoever the FIRST
 * 'ASSIGNED' activity names.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/fix-stale-reassignments.ts                 # dry run, all orgs
 *   npx ts-node scripts/fix-stale-reassignments.ts --org <orgId>   # dry run, one org
 *   npx ts-node scripts/fix-stale-reassignments.ts --apply         # write the fix
 *   npx ts-node scripts/fix-stale-reassignments.ts --apply --disable-sweep
 *       # also strips any org's now-dead stored routingSettings.reassignIfUntouchedDays
 *       # value — purely data hygiene, the field is no longer read by any code path
 *
 * Point DATABASE_URL at the target database before running (see
 * connect-prod-db.ps1 for reaching production RDS via the SSM tunnel).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const disableSweep = args.includes('--disable-sweep');
const orgArgIndex = args.indexOf('--org');
const orgId = orgArgIndex !== -1 ? args[orgArgIndex + 1] : undefined;

type Candidate = {
  leadId: string;
  leadName: string;
  orgId: string;
  originalOwnerId: string;
  originalOwnerName: string;
  currentOwnerId: string | null;
  currentOwnerName: string;
  sweepCount: number;
  lastSweepAt: Date;
};

async function findCandidates(): Promise<Candidate[]> {
  const leads = await prisma.lead.findMany({
    where: {
      isDeleted: false,
      ...(orgId ? { orgId } : {}),
    },
    select: {
      id: true,
      name: true,
      orgId: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      activities: {
        where: { type: 'ASSIGNED' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, createdAt: true, user: { select: { name: true } } },
      },
    },
  });

  const candidates: Candidate[] = [];
  for (const lead of leads) {
    if (lead.activities.length < 2) continue; // never swept

    const original = lead.activities[0];
    if (!original.userId) continue; // no recoverable original owner, needs manual review

    if (lead.assignedToId === original.userId) continue; // already back with the original owner

    candidates.push({
      leadId: lead.id,
      leadName: lead.name,
      orgId: lead.orgId!,
      originalOwnerId: original.userId,
      originalOwnerName: original.user?.name ?? original.userId,
      currentOwnerId: lead.assignedToId,
      currentOwnerName: lead.assignedTo?.name ?? '(unassigned)',
      sweepCount: lead.activities.length - 1,
      lastSweepAt: lead.activities.at(-1)!.createdAt,
    });
  }
  return candidates;
}

async function restore(candidate: Candidate): Promise<void> {
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: candidate.leadId },
      data: { assignedToId: candidate.originalOwnerId },
    }),
    prisma.activity.create({
      data: {
        leadId: candidate.leadId,
        userId: candidate.originalOwnerId,
        type: 'REASSIGN',
        note:
          `System correction: reverted ${candidate.sweepCount} erroneous auto-reassignment(s) ` +
          `caused by the Administration > Routing "reassign if untouched" default-on bug. ` +
          `Restored to original owner ${candidate.originalOwnerName} ` +
          `(was auto-reassigned to ${candidate.currentOwnerName}, last on ${candidate.lastSweepAt.toISOString()}).`,
      },
    }),
  ]);
}

async function disableSweepForAffectedOrgs(orgIds: Set<string>): Promise<void> {
  for (const id of orgIds) {
    const org = await prisma.organization.findUnique({ where: { id }, select: { routingSettings: true } });
    const stored = (org?.routingSettings as Record<string, unknown> | null) ?? {};
    if (!stored.reassignIfUntouchedDays) continue; // already off / never explicitly set
    await prisma.organization.update({
      where: { id },
      data: { routingSettings: { ...stored, reassignIfUntouchedDays: 0 } },
    });
    console.log(`  org ${id}: reassignIfUntouchedDays -> 0`);
  }
}

async function main(): Promise<void> {
  console.log(`Mode: ${apply ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`);
  if (orgId) console.log(`Scoped to org: ${orgId}`);

  const candidates = await findCandidates();
  if (!candidates.length) {
    console.log('No affected leads found.');
    return;
  }

  console.log(`\nFound ${candidates.length} lead(s) still holding a bug-caused reassignment:\n`);
  const byOrg = new Map<string, Candidate[]>();
  for (const c of candidates) {
    console.log(
      `  [${c.orgId}] lead ${c.leadId} "${c.leadName}": ` +
        `currently with ${c.currentOwnerName} (${c.currentOwnerId ?? 'null'}), ` +
        `should be with ${c.originalOwnerName} (${c.originalOwnerId}) ` +
        `— ${c.sweepCount} sweep(s), last ${c.lastSweepAt.toISOString()}`,
    );
    byOrg.set(c.orgId, [...(byOrg.get(c.orgId) ?? []), c]);
  }

  if (!apply) {
    console.log('\nDry run only — re-run with --apply to write these fixes.');
    return;
  }

  console.log('\nApplying fixes...');
  for (const c of candidates) {
    await restore(c);
  }
  console.log(`Restored ${candidates.length} lead(s) to their original owner.`);

  if (disableSweep) {
    console.log('\nDisabling the reassignment sweep for affected orgs...');
    await disableSweepForAffectedOrgs(new Set(byOrg.keys()));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
