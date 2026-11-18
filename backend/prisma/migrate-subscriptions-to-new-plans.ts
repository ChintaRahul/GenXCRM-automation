// One-off: moves every live Razorpay subscription onto the CURRENT Pro plan IDs
// (RAZORPAY_PRO_MONTHLY_PLAN_ID / RAZORPAY_PRO_ANNUAL_PLAN_ID from the environment).
//
// Razorpay plan amounts are immutable, so a price change means new plans; existing
// subscriptions keep billing the old plan until they are re-pointed here.
//
// - Decides the target from each subscription's own plan interval (monthly/annual),
//   and compares against what Razorpay itself reports, so it is idempotent: already
//   migrated subscriptions are skipped, and re-running is safe.
// - Uses schedule_change_at: 'cycle_end' — no mid-cycle proration, no surprise charge;
//   the new price applies from the next renewal.
// - DRY RUN by default (reads only). Pass --apply to actually update Razorpay.
// - Optional --org=<orgId> limits the run to one org (use it for a first live trial).
// - Run this BEFORE `db:seed` so the DB plan rows only flip to the new price once
//   Razorpay is already moving.
//
// Run with:
//   npm run migrate:subscription-plans                       (dry run)
//   npm run migrate:subscription-plans -- --apply --org=<id>
//   npm run migrate:subscription-plans -- --apply

import { PrismaClient, SubscriptionStatus, BillingInterval } from '@prisma/client';
import Razorpay from 'razorpay';

const prisma = new PrismaClient();

const apply = process.argv.includes('--apply');
const orgArg = process.argv.find((a) => a.startsWith('--org='))?.slice('--org='.length);

const targetPlanIds: Record<BillingInterval, string | undefined> = {
  [BillingInterval.MONTHLY]: process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID,
  [BillingInterval.ANNUAL]: process.env.RAZORPAY_PRO_ANNUAL_PLAN_ID,
};

// Razorpay only allows plan changes on these states.
const UPDATABLE: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.AUTHENTICATED];
// Not updatable, but worth reporting so nobody is left on the old price unnoticed.
const NEEDS_ATTENTION: SubscriptionStatus[] = [
  SubscriptionStatus.CREATED,
  SubscriptionStatus.PENDING,
  SubscriptionStatus.HALTED,
];

type RzpSub = { plan_id: string; status: string; remaining_count?: number; has_scheduled_changes?: boolean };

async function main() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
  if (!targetPlanIds.MONTHLY || !targetPlanIds.ANNUAL) throw new Error('RAZORPAY_PRO_*_PLAN_ID not set');

  const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  const mode = RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'LIVE' : 'TEST';
  console.log(`Mode: ${mode} | ${apply ? 'APPLY' : 'DRY RUN'}${orgArg ? ` | org ${orgArg}` : ''}`);
  console.log(`Targets: monthly=${targetPlanIds.MONTHLY} annual=${targetPlanIds.ANNUAL}\n`);

  const subs = await prisma.orgSubscription.findMany({
    where: {
      razorpaySubId: { not: null },
      status: { in: [...UPDATABLE, ...NEEDS_ATTENTION] },
      ...(orgArg && { orgId: orgArg }),
    },
    include: { plan: { select: { billingInterval: true } }, org: { select: { name: true } } },
  });
  console.log(`Found ${subs.length} candidate subscription(s).\n`);

  const tally = { updated: 0, wouldUpdate: 0, alreadyNew: 0, attention: 0, failed: 0 };

  for (const sub of subs) {
    const label = `${sub.org.name} (${sub.orgId}) ${sub.razorpaySubId} [${sub.status}, ${sub.userCount} seats]`;
    const target = targetPlanIds[sub.plan.billingInterval];

    if (!UPDATABLE.includes(sub.status)) {
      tally.attention++;
      console.log(`ATTENTION  ${label} — status ${sub.status} cannot be updated; handle manually`);
      continue;
    }

    try {
      const current = (await rzp.subscriptions.fetch(sub.razorpaySubId as string)) as unknown as RzpSub;
      if (current.plan_id === target) {
        tally.alreadyNew++;
        console.log(`SKIP       ${label} — already on ${target}`);
        continue;
      }
      if (current.has_scheduled_changes) {
        tally.attention++;
        console.log(`ATTENTION  ${label} — has a pending scheduled change on Razorpay; clear it first`);
        continue;
      }
      if (!apply) {
        tally.wouldUpdate++;
        console.log(`WOULD      ${label} — ${current.plan_id} -> ${target} at next cycle`);
        continue;
      }
      await rzp.subscriptions.update(sub.razorpaySubId as string, {
        plan_id: target,
        schedule_change_at: 'cycle_end',
        ...(current.remaining_count != null && { remaining_count: current.remaining_count }),
      } as Parameters<typeof rzp.subscriptions.update>[1]);
      tally.updated++;
      console.log(`UPDATED    ${label} — ${current.plan_id} -> ${target} at next cycle`);
    } catch (err) {
      tally.failed++;
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error(`FAILED     ${label} — ${msg}`);
    }
  }

  console.log('\nSummary:', tally);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
