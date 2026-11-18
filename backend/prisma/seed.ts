import { PrismaClient, BillingInterval, DiscountType } from '@prisma/client';

const prisma = new PrismaClient();

// Demo coupons for the registration wizard's Plan & payment step.
const COUPONS = [
  { code: 'WELCOME20', discountType: DiscountType.PERCENT, discountValue: 20 },
  { code: 'LAUNCH50', discountType: DiscountType.PERCENT, discountValue: 50 },
];

// Retired 2026-09-08: the Starter/Growth/Enterprise tiers were collapsed into a single
// "GenXCRM Pro" plan below. These slugs are deactivated (not deleted — existing
// OrgSubscription rows still hold a FK to them) by the retirement step in main().
const RETIRED_PLAN_SLUGS = [
  'starter-monthly',
  'starter-annual',
  'growth-monthly',
  'growth-annual',
  'enterprise-monthly',
  'enterprise-annual',
];

const PLANS = [
  {
    // Not purchasable (razorpayPlanId is always null) — this row exists so Trial's
    // resource limits live in the DB, same as every paid plan, instead of a hardcoded
    // TypeScript constant. TrialService and BillingService read it for any org that
    // isn't on an ACTIVE/AUTHENTICATED subscription. `whatsappCredits: 0` means Trial
    // orgs get no shared-API WhatsApp sends unless they connect their own WABA.
    slug: 'trial',
    name: 'Free Trial',
    tier: 'trial',
    pricePerUser: 0,
    setupFee: 0,
    billingInterval: BillingInterval.MONTHLY,
    razorpayPlanId: null,
    minUsers: 1,
    maxUsers: null,
    features: {
      leads: 100,
      teams: 1,
      users: 5,
      sequences: 2,
      emailCredits: 1000,
      advancedReports: true,
      whatsappCredits: 0,
    },
  },
  {
    slug: 'pro-monthly',
    name: 'GenXCRM Pro',
    tier: 'pro',
    pricePerUser: 499,
    setupFee: 5000,
    billingInterval: BillingInterval.MONTHLY,
    razorpayPlanId: process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID ?? null,
    minUsers: 3,
    maxUsers: null,
    features: {
      leads: 10000,
      teams: 10,
      users: -1,
      sequences: 10,
      emailCredits: 10000,
      advancedReports: true,
      whatsappCredits: 1000,
    },
  },
  {
    // Same per-seat rate as monthly — annual billing charges 12 months upfront with no
    // built-in discount. Any discount is applied later via a coupon at checkout, not baked
    // into this price (see billing.service.ts computeSeatProration, which uses this value).
    slug: 'pro-annual',
    name: 'GenXCRM Pro',
    tier: 'pro',
    pricePerUser: 499,
    setupFee: 5000,
    billingInterval: BillingInterval.ANNUAL,
    razorpayPlanId: process.env.RAZORPAY_PRO_ANNUAL_PLAN_ID ?? null,
    minUsers: 3,
    maxUsers: null,
    features: {
      leads: 10000,
      teams: 10,
      users: -1,
      sequences: 10,
      emailCredits: 10000,
      advancedReports: true,
      whatsappCredits: 1000,
    },
  },
];

// Global, read-only default email templates (orgId null, isSystem true). Shared by every
// org; users copy them to get an editable version. Stable ids keep re-seeding idempotent.
// Bodies are HTML and use {{name}}/{{course}}/{{org}} placeholders ({{org}} = the org name,
// substituted by the nurturing engine at send time).
const DEFAULT_EMAIL_TEMPLATES = [
  {
    id: '00000000-0000-4000-a000-000000000001',
    channel: 'EMAIL' as const,
    name: 'Welcome / Enquiry Received',
    subject: "Welcome! We've received your enquiry",
    body:
      '<p>Hi {{name}},</p>' +
      "<p>Thank you for reaching out to us! We've received your enquiry about " +
      '<strong>{{course}}</strong> and one of our counselors will get in touch with you ' +
      'shortly.</p>' +
      '<p>Best regards,<br>{{org}}</p>',
  },
  {
    id: '00000000-0000-4000-a000-000000000002',
    channel: 'EMAIL' as const,
    name: 'Follow-up',
    subject: 'Following up on your enquiry',
    body:
      '<p>Hi {{name}},</p>' +
      "<p>I wanted to follow up on your interest in <strong>{{course}}</strong>. I'd be happy " +
      'to answer any questions and help you find the right fit.</p>' +
      '<p>When would be a good time for a quick call?</p>' +
      '<p>Best regards,<br>{{org}}</p>',
  },
  {
    id: '00000000-0000-4000-a000-000000000003',
    channel: 'EMAIL' as const,
    name: 'Demo Invitation',
    subject: 'Your {{course}} demo session',
    body:
      '<p>Hi {{name}},</p>' +
      "<p>We'd love to show you how <strong>{{course}}</strong> works with a free, " +
      'no-obligation demo session.</p>' +
      '<p>Reply to this email with a time that suits you and we’ll set it up.</p>' +
      '<p>Best regards,<br>{{org}}</p>',
  },
  // General-purpose payment reminder — for ad-hoc use from the lead composer or a nurturing
  // step (a rep fills in {{amount}}/{{payment_link}} for whatever's actually due). Distinct
  // from the WhatsApp-only "EMI Installment Reminder" below, which remindInstallment() sends
  // automatically with installment-specific variables it already has in hand.
  {
    id: '00000000-0000-4000-a000-000000000004',
    channel: 'EMAIL' as const,
    name: 'Payment Reminder',
    subject: 'Payment reminder — {{course}}',
    body:
      '<p>Hi {{name}},</p>' +
      '<p>This is a friendly reminder that a payment of <strong>₹{{amount}}</strong> for ' +
      '<strong>{{course}}</strong> is still pending.</p>' +
      '<p><a href="{{payment_link}}">Pay online</a></p>' +
      '<p>If you have any questions, just reply to this email.</p>' +
      '<p>Best regards,<br>{{org}}</p>',
  },
];

// Global, read-only default WhatsApp templates (orgId null, isSystem true). Free-form plain text
// (no subject) using the same {{name}}/{{course}}/{{org}} placeholders — sent within the 24h window
// via the free-form WhatsApp path. Stable ids keep re-seeding idempotent.
const DEFAULT_WHATSAPP_TEMPLATES = [
  {
    id: '00000000-0000-4000-b000-000000000001',
    channel: 'WHATSAPP' as const,
    name: 'Welcome',
    subject: null,
    body: 'Hi {{name}}, thanks for your interest in {{course}}! 🎓 A counselor from {{org}} will reach out shortly. Feel free to reply here with any questions.',
  },
  {
    id: '00000000-0000-4000-b000-000000000002',
    channel: 'WHATSAPP' as const,
    name: 'Follow-up',
    subject: null,
    body: "Hi {{name}}, just following up on {{course}}. When's a good time for a quick call? — {{org}}.",
  },
  {
    id: '00000000-0000-4000-b000-000000000003',
    channel: 'WHATSAPP' as const,
    name: 'Demo Reminder',
    subject: null,
    body: 'Hi {{name}}, a quick reminder about your {{course}} demo. Reply with a time that suits you and we’ll set it up. — {{org}}.',
  },
  // UTILITY, not MARKETING (unlike the three above, which fall back to MARKETING on copy —
  // see TemplatesService.copy) — a payment reminder is transactional and Meta scrutinizes
  // MARKETING-filed utility content much harder. remindInstallment() has all six variables
  // (lead name, installment number, amount, invoice number, formatted due date, Razorpay
  // link) in hand once this is copied, approved, and wired to sendWhatsAppTemplate().
  {
    id: '00000000-0000-4000-b000-000000000004',
    channel: 'WHATSAPP' as const,
    name: 'EMI Installment Reminder',
    subject: null,
    category: 'UTILITY',
    language: 'en_US',
    body: 'Hi {{name}}, this is a reminder that installment #{{installment_no}} of ₹{{amount}} for invoice {{invoice_no}} is due on {{due_date}}. Please use this link to pay online: {{payment_link}}. For any billing questions, just reply to this message. Regards, {{org}} team.',
  },
  // General-purpose payment reminder — same UTILITY reasoning as EMI Installment Reminder
  // above, but for ad-hoc use (composer/nurturing) rather than a specific installment.
  {
    id: '00000000-0000-4000-b000-000000000005',
    channel: 'WHATSAPP' as const,
    name: 'Payment Reminder',
    subject: null,
    category: 'UTILITY',
    language: 'en_US',
    body: 'Hi {{name}}, this is a reminder that a payment of ₹{{amount}} for {{course}} is still pending. Please use this link to pay online: {{payment_link}}. For any billing questions, just reply to this message. Regards, {{org}} team.',
  },
];

async function main() {
  console.log('Seeding subscription plans...');

  for (const plan of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      update: {
        pricePerUser: plan.pricePerUser,
        setupFee: plan.setupFee,
        razorpayPlanId: plan.razorpayPlanId,
        minUsers: plan.minUsers,
        maxUsers: plan.maxUsers,
        features: plan.features,
      },
      create: plan,
    });
  }

  console.log(`Seeded ${PLANS.length} subscription plans.`);

  console.log('Retiring old subscription plans...');
  await prisma.subscriptionPlan.updateMany({
    where: { slug: { in: RETIRED_PLAN_SLUGS } },
    data: { isActive: false },
  });

  console.log('Seeding demo coupons...');
  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: { discountType: coupon.discountType, discountValue: coupon.discountValue },
      create: coupon,
    });
  }
  console.log(`Seeded ${COUPONS.length} coupons.`);

  console.log('Seeding default templates...');
  for (const tpl of [...DEFAULT_EMAIL_TEMPLATES, ...DEFAULT_WHATSAPP_TEMPLATES]) {
    await prisma.messageTemplate.upsert({
      where: { id: tpl.id },
      update: { channel: tpl.channel, name: tpl.name, subject: tpl.subject, body: tpl.body },
      create: { ...tpl, isSystem: true, orgId: null },
    });
  }
  console.log(
    `Seeded ${DEFAULT_EMAIL_TEMPLATES.length} email + ${DEFAULT_WHATSAPP_TEMPLATES.length} WhatsApp default templates.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
