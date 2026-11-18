// One-off local script to create/update the "Welcome Offer" coupon in the local dev DB.
// Coupon has no separate display-name field (schema.prisma) — "Welcome Offer" is the
// code itself. Terms mirror create-coupon-save1000.sql used against prod: ₹1,000 flat
// off, single redemption, all plan tiers, no expiry.
//
// razorpayOfferIds below are the TEST-mode Razorpay Offer ids (Dashboard, Test mode ->
// Subscriptions -> Offers), one per (billingInterval, paymentMethod) pair, linked to the
// TEST plans plan_TZbuUt6rXALluq (Monthly) / plan_TZbtTVisVHI7L0 (Annual) — see
// BillingService.getOfferId. Fill in each slot as the corresponding Offer is created;
// leaving a slot undefined just means that combination falls back to the refund path.
// Safe to re-run any time a new offer id is added — upsert keeps existing fields.
//   npx dotenv -e .env.local -e .env -- ts-node prisma/create-welcome-offer-coupon.local.ts
import { PrismaClient, DiscountType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const razorpayOfferIds = {
  MONTHLY: {
    card: 'offer_TcJ4gRSqCu8iYw',
    // upi: '',
  },
  // ANNUAL: {
  //   card: '',
  //   upi: '',
  // },
} satisfies Prisma.InputJsonValue;

async function main() {
  const coupon = await prisma.coupon.upsert({
    where: { code: 'WELCOMEOFFER' },
    update: { razorpayOfferIds },
    create: {
      code: 'WELCOMEOFFER',
      discountType: DiscountType.FLAT,
      discountValue: 1000,
      applicablePlanTiers: [],
      maxRedemptions: 1,
      isActive: true,
      razorpayOfferIds,
    },
  });
  console.log('Welcome Offer coupon ready:', coupon);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
