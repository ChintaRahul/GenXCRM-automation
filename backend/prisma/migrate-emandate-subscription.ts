// One-off, for ONE org: moves a Razorpay subscription that cannot be plan-updated
// (payment mode = emandate) onto the current Pro Monthly plan.
//
// Razorpay refuses subscriptions.update on eMandate subscriptions, so the customer must
// authorise a NEW subscription. To avoid charging them twice or re-billing the setup fee
// (which the normal in-app subscribe flow would do), this runs in three safe phases:
//
//   (default)        read-only: shows the old subscription and what --create would do
//   --create         creates the new subscription with start_at = the old one's next
//                    renewal date, NO setup fee, and prints its authorisation link.
//                    Touches nothing else. Send the link to the customer.
//   --finalize=<id>  after the customer has authorised (new sub status 'authenticated'):
//                    repoints the DB at the new subscription, then cancels the old one at
//                    cycle end. Must be done BEFORE the old renewal date, otherwise both
//                    subscriptions bill on that day.
//
// Webhooks are matched by razorpaySubId, so the DB MUST point at the new subscription
// before the old one's `cancelled` event arrives (that event would otherwise expire the
// org). --finalize does the DB repoint first for exactly that reason.
//
// Run with (monthly Pro subscriptions only):
//   npm run migrate:emandate-subscription -- --org=<orgId>
//   npm run migrate:emandate-subscription -- --org=<orgId> --create
//   npm run migrate:emandate-subscription -- --org=<orgId> --finalize=<newSubId>

import { PrismaClient, BillingInterval } from '@prisma/client';
import Razorpay from 'razorpay';

const prisma = new PrismaClient();

const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const orgId = argValue('org');
const finalizeId = argValue('finalize');
const create = process.argv.includes('--create');

const MIN_LEAD_SECONDS = 60 * 60; // new sub must start at least an hour from now

type RzpSub = {
  id: string;
  plan_id: string;
  status: string;
  quantity: number;
  current_end: number | null;
  short_url?: string;
};

const fmt = (unix: number | null) => (unix ? new Date(unix * 1000).toISOString() : 'n/a');

async function main() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_PRO_MONTHLY_PLAN_ID: targetPlanId } = process.env;
  if (!orgId) throw new Error('--org=<orgId> is required');
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
  if (!targetPlanId) throw new Error('RAZORPAY_PRO_MONTHLY_PLAN_ID not set');

  const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  console.log(`Mode: ${RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'LIVE' : 'TEST'} | org ${orgId}\n`);

  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId },
    include: { plan: { select: { billingInterval: true } }, org: { select: { name: true } } },
  });
  if (!sub?.razorpaySubId) throw new Error('Org has no subscription with a Razorpay id');
  if (sub.plan.billingInterval !== BillingInterval.MONTHLY) throw new Error('Only monthly subscriptions are supported');

  const oldId = sub.razorpaySubId;
  const isFinalizing = finalizeId !== undefined;

  // --finalize may run after the DB was already repointed (retry); everything else needs the old id.
  const old = (await rzp.subscriptions.fetch(oldId)) as unknown as RzpSub;
  console.log(`Org:        ${sub.org.name}`);
  console.log(`Current:    ${oldId} | ${old.status} | plan ${old.plan_id} | ${old.quantity} seats | renews ${fmt(old.current_end)}`);

  if (isFinalizing) {
    if (oldId === finalizeId) {
      console.log('\nDB already points at the new subscription; nothing to repoint.');
      return;
    }
    const next = (await rzp.subscriptions.fetch(finalizeId)) as unknown as RzpSub;
    console.log(`New:        ${next.id} | ${next.status} | plan ${next.plan_id} | ${next.quantity} seats`);
    if (next.plan_id !== targetPlanId) throw new Error(`New subscription is not on ${targetPlanId}`);
    if (!['authenticated', 'active'].includes(next.status)) {
      throw new Error(`New subscription is '${next.status}' — the customer has not authorised it yet`);
    }
    if (next.quantity !== sub.userCount) throw new Error(`Seat mismatch: new ${next.quantity} vs DB ${sub.userCount}`);

    await prisma.orgSubscription.update({
      where: { orgId },
      data: { razorpaySubId: finalizeId, cancelAtPeriodEnd: false, cancelledAt: null },
    });
    console.log('\nDB repointed to the new subscription.');

    try {
      await (rzp.subscriptions.cancel as (id: string, opts: unknown) => Promise<unknown>)(oldId, {
        cancel_at_cycle_end: true,
      });
      console.log(`Old subscription ${oldId} set to cancel at cycle end (${fmt(old.current_end)}). Done.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error(`\nCANCEL FAILED for ${oldId}: ${msg}`);
      console.error('Cancel it in the Razorpay dashboard (Cancel at end of cycle) BEFORE the renewal date, or it will double-bill.');
      process.exitCode = 1;
    }
    return;
  }

  if (old.plan_id === targetPlanId) {
    console.log('\nAlready on the target plan; nothing to do.');
    return;
  }
  if (!old.current_end || old.current_end - Math.floor(Date.now() / 1000) < MIN_LEAD_SECONDS) {
    throw new Error('Old renewal date is missing or less than an hour away; handle manually');
  }

  if (!create) {
    console.log(`\nDRY RUN. --create would make a new ${old.quantity}-seat subscription on ${targetPlanId}`);
    console.log(`starting ${fmt(old.current_end)}, with no setup fee, and print the customer's authorisation link.`);
    return;
  }

  const created = (await rzp.subscriptions.create({
    plan_id: targetPlanId,
    total_count: 12,
    quantity: old.quantity,
    start_at: old.current_end,
    customer_notify: 0,
    notes: { migratedFrom: oldId, orgId },
  } as Parameters<typeof rzp.subscriptions.create>[0])) as unknown as RzpSub;

  console.log(`\nCreated ${created.id} (starts ${fmt(old.current_end)}).`);
  console.log(`Send the customer this link to authorise their bank mandate:\n  ${created.short_url ?? '(no short_url returned — open the subscription in the Razorpay dashboard)'}`);
  console.log(`\nAfter they authorise, run: --org=${orgId} --finalize=${created.id}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : JSON.stringify(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
