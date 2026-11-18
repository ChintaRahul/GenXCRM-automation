// Seeds a fully-populated demo organization for a live client showcase, owned by
// genxcrm002+clientdemo@gmail.com. Same coverage as seed-demo.ts (hierarchy, leads across
// every stage/source, campaigns/ad sets/ads, communications + call recordings, payments,
// nurturing, templates, integrations, subscription) plus courses/tutors/batches/invoices,
// scaled up to ~400 leads for a richer walkthrough.
//
// Safe to re-run: it wipes and rebuilds everything under this one demo org each time, so
// the account always reflects the current shape of this script. It never touches any
// other organization.
//
// Nurturing sequences are deliberately created with isActive: false so the nurturing cron
// never picks them up and fires real emails/WhatsApp messages against the fake lead
// contacts seeded here.
//
// Run with:
//   npm run demo:seed:client        (uses .env — point DATABASE_URL at the target DB)

import {
  PrismaClient,
  LeadSource,
  LeadStage,
  CommType,
  CallOutcome,
  PaymentStatus,
  PaymentGateway,
  Role,
  Industry,
  OrgSize,
  PlanStatus,
  IntegrationProvider,
  IntegrationStatus,
  SubscriptionStatus,
  BillingInterval,
  AddonType,
  InvoiceStatus,
  GstType,
  DiscountType,
  EmiInstallmentStatus,
  CourseCategory,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { welcomeSequenceCreateData } from '../src/modules/nurturing/welcome-sequence';
import { computeInvoiceTotals } from '../src/modules/invoices/invoices.math';

const prisma = new PrismaClient();

const OWNER_EMAIL = 'genxcrm002+clientdemo@gmail.com';
const DEMO_PASSWORD = 'Demo@12345';
const ORG_SLUG = 'genx-learning-academy-client-demo';
const TOTAL_LEADS = 400;

const COURSES = [
  { name: 'Data Science Bootcamp', category: CourseCategory.PROFESSIONAL_SKILLS, price: 65000 },
  { name: 'Full Stack Web Development', category: CourseCategory.PROFESSIONAL_SKILLS, price: 55000 },
  { name: 'UI/UX Design Masterclass', category: CourseCategory.PROFESSIONAL_SKILLS, price: 40000 },
  { name: 'Digital Marketing Pro', category: CourseCategory.PROFESSIONAL_SKILLS, price: 30000 },
  { name: 'Cloud Computing (AWS)', category: CourseCategory.PROFESSIONAL_SKILLS, price: 48000 },
  { name: 'Data Analytics with Python', category: CourseCategory.TEST_SERIES, price: 35000 },
];

const CITIES = ['Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad'];

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Anika', 'Ira', 'Riya', 'Navya',
  'Rahul', 'Karthik', 'Suresh', 'Vikram', 'Manoj', 'Priya', 'Neha', 'Pooja', 'Sneha', 'Kavya',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Rao', 'Reddy', 'Nair', 'Gupta', 'Mehta', 'Singh', 'Kapoor',
  'Joshi', 'Desai', 'Pillai', 'Bose', 'Chatterjee', 'Malhotra', 'Bhatt', 'Menon', 'Kulkarni', 'Agarwal',
];

// Deliberately invalid format (not E.164, wrong digit count) so seeded leads can never
// be mistaken for real captured contact info and can never actually be dialed/texted.
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `INVALID-PHONE-${String(phoneCounter).padStart(4, '0')}`;
}

function nameFor(i: number): { name: string } {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
  return { name: `${first} ${last}` };
}

function daysAgo(n: number, hour = 10): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function wipeExistingDemoOrg(orgId: string) {
  const leadIds = (await prisma.lead.findMany({ where: { orgId }, select: { id: true } })).map((l) => l.id);
  const paymentIds = leadIds.length
    ? (await prisma.payment.findMany({ where: { leadId: { in: leadIds } }, select: { id: true } })).map((p) => p.id)
    : [];
  const invoiceIds = leadIds.length
    ? (await prisma.invoice.findMany({ where: { leadId: { in: leadIds } }, select: { id: true } })).map((inv) => inv.id)
    : [];
  const subscription = await prisma.orgSubscription.findUnique({ where: { orgId }, select: { id: true } });

  await prisma.$transaction([
    ...(paymentIds.length ? [prisma.installment.deleteMany({ where: { paymentId: { in: paymentIds } } })] : []),
    ...(invoiceIds.length
      ? [
          prisma.emiInstallment.deleteMany({ where: { invoiceId: { in: invoiceIds } } }),
          prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } }),
        ]
      : []),
    ...(leadIds.length
      ? [
          prisma.invoice.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.payment.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.callRecording.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.communication.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.activity.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.nurturingEnrollment.deleteMany({ where: { leadId: { in: leadIds } } }),
        ]
      : []),
    prisma.lead.deleteMany({ where: { orgId } }),
    prisma.nurturingStep.deleteMany({ where: { sequence: { orgId } } }),
    prisma.nurturingSequence.deleteMany({ where: { orgId } }),
    prisma.batch.deleteMany({ where: { course: { orgId } } }),
    prisma.course.deleteMany({ where: { orgId } }),
    prisma.tutor.deleteMany({ where: { orgId } }),
    prisma.ad.deleteMany({ where: { orgId } }),
    prisma.adSet.deleteMany({ where: { orgId } }),
    prisma.campaign.deleteMany({ where: { orgId } }),
    ...(subscription
      ? [
          prisma.billingEvent.deleteMany({ where: { subscriptionId: subscription.id } }),
          prisma.subscriptionAddon.deleteMany({ where: { subscriptionId: subscription.id } }),
          prisma.orgSubscription.deleteMany({ where: { orgId } }),
        ]
      : []),
    prisma.orgIntegration.deleteMany({ where: { orgId } }),
    prisma.messageTemplate.deleteMany({ where: { orgId, isSystem: false } }),
    prisma.assignmentState.deleteMany({ where: { orgId } }),
    prisma.user.deleteMany({ where: { orgId, email: { not: OWNER_EMAIL } } }),
    prisma.team.deleteMany({ where: { orgId } }),
  ]);
}

async function main() {
  console.log('Seeding client-demo data...');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── Owner + Org ─────────────────────────────────────────────────────────
  let owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  let org = owner?.orgId ? await prisma.organization.findUnique({ where: { id: owner.orgId } }) : null;

  const orgBaseData = {
    name: 'GenX Learning Academy',
    industry: Industry.EDTECH,
    size: OrgSize.SMALL,
    website: 'https://genxacademy.example.com',
    phone: '+91 98765 43210',
    email: 'hello@genxacademy.example.com',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    timezone: 'Asia/Kolkata',
    gstNumber: '29ABCDE1234F1Z5',
    planStatus: PlanStatus.ACTIVE,
    trialEndsAt: daysAgo(-365),
  };

  if (owner && org) {
    console.log(`Found existing org "${org.name}" (${org.id}) for ${OWNER_EMAIL} — wiping and rebuilding it...`);
    await wipeExistingDemoOrg(org.id);
    org = await prisma.organization.update({ where: { id: org.id }, data: orgBaseData });
    owner = await prisma.user.update({
      where: { id: owner.id },
      data: {
        name: 'Rahul Chinta',
        passwordHash,
        role: Role.DIRECTOR,
        isActive: true,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
        teamId: null,
      },
    });
  } else if (owner && !owner.orgId) {
    org = await prisma.organization.create({ data: { ...orgBaseData, slug: ORG_SLUG, ownerId: owner.id } });
    owner = await prisma.user.update({
      where: { id: owner.id },
      data: {
        orgId: org.id,
        name: 'Rahul Chinta',
        passwordHash,
        role: Role.DIRECTOR,
        isActive: true,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
      },
    });
  } else {
    owner = await prisma.user.create({
      data: {
        name: 'Rahul Chinta',
        email: OWNER_EMAIL,
        passwordHash,
        role: Role.DIRECTOR,
        isActive: true,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    org = await prisma.organization.create({ data: { ...orgBaseData, slug: ORG_SLUG, ownerId: owner.id } });
    owner = await prisma.user.update({ where: { id: owner.id }, data: { orgId: org.id } });
  }

  if (!org) throw new Error('Failed to resolve demo organization');
  const orgId = org.id;
  console.log(`Org ready: "${org.name}" (${orgId}), owner ${OWNER_EMAIL}`);

  // ── Managers + Teams ────────────────────────────────────────────────────
  const priya = await prisma.user.create({
    data: { name: 'Priya Sharma', email: 'priya.sharma@genxacademy-clientdemo.example', passwordHash, role: Role.MANAGER, orgId, emailVerified: true },
  });
  const arjun = await prisma.user.create({
    data: { name: 'Arjun Mehta', email: 'arjun.mehta@genxacademy-clientdemo.example', passwordHash, role: Role.MANAGER, orgId, emailVerified: true },
  });

  const teamAlpha = await prisma.team.create({ data: { name: 'Team Alpha', orgId, managerId: priya.id, monthlyTarget: 40 } });
  const teamBeta = await prisma.team.create({ data: { name: 'Team Beta', orgId, managerId: arjun.id, monthlyTarget: 35 } });

  await prisma.user.update({ where: { id: priya.id }, data: { teamId: teamAlpha.id } });
  await prisma.user.update({ where: { id: arjun.id }, data: { teamId: teamBeta.id } });

  // ── Sales Reps ──────────────────────────────────────────────────────────
  const repDefs = [
    { name: 'Neha Verma', email: 'neha.verma@genxacademy-clientdemo.example', teamId: teamAlpha.id },
    { name: 'Karan Singh', email: 'karan.singh@genxacademy-clientdemo.example', teamId: teamAlpha.id },
    { name: 'Ananya Iyer', email: 'ananya.iyer@genxacademy-clientdemo.example', teamId: teamBeta.id },
    { name: 'Vikram Rao', email: 'vikram.rao@genxacademy-clientdemo.example', teamId: teamBeta.id },
  ];
  const reps: Awaited<ReturnType<typeof prisma.user.create>>[] = [];
  for (const r of repDefs) {
    reps.push(
      await prisma.user.create({
        data: { name: r.name, email: r.email, passwordHash, role: Role.SALES_REP, orgId, teamId: r.teamId, emailVerified: true },
      }),
    );
  }
  console.log(`Created 2 managers + ${reps.length} sales reps.`);

  // ── Courses / Tutors / Batches ──────────────────────────────────────────
  const tutorNames = ['Dr. Meera Krishnan', 'Rohit Bansal', 'Sanjana Pillai'];
  const tutors = await Promise.all(tutorNames.map((name) => prisma.tutor.create({ data: { orgId, name } })));

  const courses = await Promise.all(
    COURSES.map((c) => prisma.course.create({ data: { orgId, name: c.name, category: c.category, defaultPrice: c.price } })),
  );

  const batches: Awaited<ReturnType<typeof prisma.batch.create>>[] = [];
  for (let i = 0; i < courses.length; i++) {
    for (const [slot, schedule] of [['Weekday Morning', 'Mon-Fri 8-10 AM'], ['Weekend', 'Sat-Sun 10 AM-1 PM']] as const) {
      batches.push(
        await prisma.batch.create({
          data: { courseId: courses[i].id, label: `${courses[i].name} – ${slot}`, schedule, tutorId: tutors[i % tutors.length].id, capacity: 30, seats: 12 + (i % 15) },
        }),
      );
    }
  }
  console.log(`Created ${tutors.length} tutors, ${courses.length} courses, ${batches.length} batches.`);

  // ── Campaigns / Ad Sets / Ads ───────────────────────────────────────────
  const campaignGoogle = await prisma.campaign.create({
    data: { name: 'Google Ads – Data Science Course', source: LeadSource.GOOGLE_ADS, orgId, spend: 145000, impressions: 420000, clicks: 12400, startDate: daysAgo(90), isActive: true },
  });
  const adSetSearch = await prisma.adSet.create({ data: { campaignId: campaignGoogle.id, orgId, name: 'Search – Data Science Keywords', spend: 95000, impressions: 280000, clicks: 8400 } });
  const adSetDisplay = await prisma.adSet.create({ data: { campaignId: campaignGoogle.id, orgId, name: 'Display – Retargeting', spend: 50000, impressions: 140000, clicks: 4000 } });
  const adSearchA = await prisma.ad.create({ data: { adSetId: adSetSearch.id, orgId, name: 'DS Search Ad A', spend: 55000, impressions: 160000, clicks: 5000 } });
  const adSearchB = await prisma.ad.create({ data: { adSetId: adSetSearch.id, orgId, name: 'DS Search Ad B', spend: 40000, impressions: 120000, clicks: 3400 } });
  const adDisplayBanner = await prisma.ad.create({ data: { adSetId: adSetDisplay.id, orgId, name: 'DS Display Banner', spend: 50000, impressions: 140000, clicks: 4000 } });

  const campaignFacebook = await prisma.campaign.create({
    data: { name: 'Facebook – Full Stack Bootcamp', source: LeadSource.FACEBOOK, orgId, spend: 110000, impressions: 350000, clicks: 9800, startDate: daysAgo(80), isActive: true },
  });
  const adSetFeed = await prisma.adSet.create({ data: { campaignId: campaignFacebook.id, orgId, name: 'Feed – Age 25-34', spend: 70000, impressions: 220000, clicks: 6200 } });
  const adSetStories = await prisma.adSet.create({ data: { campaignId: campaignFacebook.id, orgId, name: 'Stories – Age 18-24', spend: 40000, impressions: 130000, clicks: 3600 } });
  const adFeedA = await prisma.ad.create({ data: { adSetId: adSetFeed.id, orgId, name: 'FSB Feed Ad A', spend: 70000, impressions: 220000, clicks: 6200 } });
  const adStoryA = await prisma.ad.create({ data: { adSetId: adSetStories.id, orgId, name: 'FSB Story Ad A', spend: 40000, impressions: 130000, clicks: 3600 } });

  const campaignInstagram = await prisma.campaign.create({
    data: { name: 'Instagram – UI/UX Design Course', source: LeadSource.INSTAGRAM, orgId, spend: 60000, impressions: 200000, clicks: 5200, startDate: daysAgo(70), isActive: true },
  });
  const adSetReels = await prisma.adSet.create({ data: { campaignId: campaignInstagram.id, orgId, name: 'Reels – Design Enthusiasts', spend: 60000, impressions: 200000, clicks: 5200 } });
  const adReelA = await prisma.ad.create({ data: { adSetId: adSetReels.id, orgId, name: 'UIUX Reel Ad A', spend: 60000, impressions: 200000, clicks: 5200 } });

  console.log('Created 3 campaigns with ad sets and ads.');

  // ── Leads ───────────────────────────────────────────────────────────────
  // Every LeadStage and LeadSource is covered; ~400 leads spread evenly across all stages,
  // with a couple of stages getting one extra lead to land on the exact total.
  const stages = Object.values(LeadStage);
  const sources = Object.values(LeadSource);
  const baseLeadsPerStage = Math.floor(TOTAL_LEADS / stages.length);
  const remainder = TOTAL_LEADS - baseLeadsPerStage * stages.length;

  type LeadPlan = {
    stage: LeadStage;
    source: LeadSource;
    ageDays: number;
    assigned?: (typeof reps)[number];
    teamId?: string;
    campaignId?: string;
    adSetId?: string;
    adId?: string;
  };
  const plans: LeadPlan[] = [];
  let idx = 0;
  stages.forEach((stage, stageIdx) => {
    const countForStage = baseLeadsPerStage + (stageIdx < remainder ? 1 : 0);
    for (let k = 0; k < countForStage; k++) {
      const source = sources[idx % sources.length];
      const ageDays = 1 + (idx % 120); // spread across ~4 months
      const rep = idx % 5 === 0 ? undefined : reps[idx % reps.length]; // ~20% unassigned
      const teamId = rep?.teamId ?? undefined;

      let campaignId: string | undefined;
      let adSetId: string | undefined;
      let adId: string | undefined;
      if (source === LeadSource.GOOGLE_ADS) {
        campaignId = campaignGoogle.id;
        adSetId = idx % 2 === 0 ? adSetSearch.id : adSetDisplay.id;
        adId = adSetId === adSetSearch.id ? (idx % 4 === 0 ? adSearchA.id : adSearchB.id) : adDisplayBanner.id;
      } else if (source === LeadSource.FACEBOOK) {
        campaignId = campaignFacebook.id;
        adSetId = idx % 2 === 0 ? adSetFeed.id : adSetStories.id;
        adId = adSetId === adSetFeed.id ? adFeedA.id : adStoryA.id;
      } else if (source === LeadSource.INSTAGRAM) {
        campaignId = campaignInstagram.id;
        adSetId = adSetReels.id;
        adId = adReelA.id;
      }

      plans.push({ stage, source, ageDays, assigned: rep, teamId, campaignId, adSetId, adId });
      idx++;
    }
  });

  const enrolledLikeStages = new Set<LeadStage>([LeadStage.ENROLLED, LeadStage.CLOSED_WON]);
  const midPipelineStages = new Set<LeadStage>([
    LeadStage.INTERESTED,
    LeadStage.NEGOTIATION,
    LeadStage.ENROLLMENT_PENDING,
    LeadStage.DEMO_SCHEDULED,
  ]);

  const createdLeads: { id: string; stage: LeadStage; assignedToId: string | null }[] = [];

  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    const { name } = nameFor(i);
    const course = COURSES[i % COURSES.length].name;
    const city = CITIES[i % CITIES.length];
    const createdAt = daysAgo(p.ageDays, 8 + (i % 10));
    const isNotInterestedLike = p.stage === LeadStage.NOT_INTERESTED || p.stage === LeadStage.CLOSED_LOST;

    const lead = await prisma.lead.create({
      data: {
        name,
        // Deliberately invalid format (no @, no domain) so seeded leads can never be
        // mistaken for real captured contact info and can never actually be emailed.
        email: `invalid-email-${name.toLowerCase().replace(/\s+/g, '.')}${i}`,
        phone: nextPhone(),
        course,
        location: city,
        language: 'English',
        source: p.source,
        sourceCampaign: p.campaignId ? 'demo-campaign' : undefined,
        campaignId: p.campaignId,
        adSetId: p.adSetId,
        adId: p.adId,
        stage: p.stage,
        score: enrolledLikeStages.has(p.stage) ? 70 + (i % 30) : 10 + (i % 60),
        interestedCount: midPipelineStages.has(p.stage) || enrolledLikeStages.has(p.stage) ? 1 + (i % 3) : 0,
        tags: enrolledLikeStages.has(p.stage) ? ['hot-lead'] : i % 6 === 0 ? ['budget-conscious'] : [],
        assignedToId: p.assigned?.id,
        teamId: p.teamId,
        orgId,
        createdAt,
        updatedAt: createdAt,
        ...(isNotInterestedLike && { notInterestedAt: createdAt, notInterestedReason: 'Budget constraints this quarter' }),
      },
    });
    createdLeads.push({ id: lead.id, stage: lead.stage, assignedToId: lead.assignedToId });
  }
  console.log(`Created ${createdLeads.length} leads across ${stages.length} stages and ${sources.length} sources.`);

  // ── Activities + Communications + Call Recordings ──────────────────────
  const activityNotes = [
    'Called and discussed course fee structure.',
    'Sent brochure and syllabus via email.',
    'Lead requested a callback after 6 PM.',
    'Discussed EMI options for course fee.',
    'Scheduled a demo session for next week.',
    'Followed up — no response yet.',
  ];

  let commCount = 0;
  let callRecordingCount = 0;
  for (let i = 0; i < createdLeads.length; i++) {
    if (i % 2 !== 0) continue; // touch every other lead
    const lead = createdLeads[i];
    const rep = reps[i % reps.length];
    const baseDaysAgo = 1 + (i % 60);

    await prisma.activity.create({
      data: { leadId: lead.id, userId: rep.id, type: 'NOTE', note: activityNotes[i % activityNotes.length], createdAt: daysAgo(baseDaysAgo, 9) },
    });

    await prisma.communication.create({
      data: {
        leadId: lead.id,
        type: CommType.EMAIL,
        direction: 'outbound',
        subject: 'Following up on your enquiry',
        body: 'Hi, following up on your interest in our course. Let us know if you have questions!',
        status: 'sent',
        sentAt: daysAgo(baseDaysAgo, 10),
        openedAt: i % 3 === 0 ? daysAgo(baseDaysAgo, 12) : null,
      },
    });
    commCount++;

    if (i % 3 === 0) {
      const durationSec = 60 + (i % 8) * 45;
      const outcome = i % 4 === 0 ? CallOutcome.NOT_CONNECTED : CallOutcome.CONNECTED;
      const call = await prisma.communication.create({
        data: {
          leadId: lead.id,
          type: CommType.CALL,
          direction: 'outbound',
          status: 'completed',
          calledById: rep.id,
          callOutcome: outcome,
          durationSec: outcome === CallOutcome.CONNECTED ? durationSec : 0,
          sentAt: daysAgo(baseDaysAgo, 14),
        },
      });
      commCount++;

      if (outcome === CallOutcome.CONNECTED) {
        await prisma.callRecording.create({
          data: { leadId: lead.id, s3Key: `recordings/demo/${lead.id}/${call.id}.mp3`, durationSec, recordedAt: daysAgo(baseDaysAgo, 14) },
        });
        callRecordingCount++;
      }
    }

    if (i % 5 === 0) {
      await prisma.communication.create({
        data: {
          leadId: lead.id,
          type: CommType.WHATSAPP,
          direction: 'outbound',
          body: 'Hi! Just checking in about the course — happy to answer any questions over WhatsApp.',
          status: 'sent',
          sentAt: daysAgo(baseDaysAgo, 11),
        },
      });
      commCount++;
    }
  }
  console.log(`Created activities + ${commCount} communications + ${callRecordingCount} call recordings.`);

  // ── Payments ─────────────────────────────────────────────────────────────
  const enrolledLeads = createdLeads.filter((l) => l.stage === LeadStage.ENROLLED || l.stage === LeadStage.CLOSED_WON);
  const midPipelineLeads = createdLeads.filter((l) =>
    ([LeadStage.NEGOTIATION, LeadStage.ENROLLMENT_PENDING, LeadStage.INTERESTED] as LeadStage[]).includes(l.stage),
  );

  let paymentCount = 0;
  for (let i = 0; i < enrolledLeads.length; i++) {
    const lead = enrolledLeads[i];
    const amount = 25000 + (i % 5) * 8000;
    const gateway = i % 3 === 0 ? PaymentGateway.STRIPE : i % 3 === 1 ? PaymentGateway.PAYU : PaymentGateway.RAZORPAY;
    const paidAt = i % 2 === 0 ? daysAgo(3 + (i % 5)) : daysAgo(35 + (i % 5));

    const payment = await prisma.payment.create({
      data: { leadId: lead.id, gateway, amount, status: PaymentStatus.PAID, paidAt, invoiceNumber: `INV-DEMO-${1000 + i}`, invoiceSentAt: paidAt },
    });
    paymentCount++;

    if (i % 4 === 0) {
      await prisma.installment.createMany({
        data: [
          { paymentId: payment.id, amount: amount / 2, dueDate: daysAgo(40), paidAt: daysAgo(40), status: PaymentStatus.PAID },
          { paymentId: payment.id, amount: amount / 2, dueDate: daysAgo(3), paidAt, status: PaymentStatus.PAID },
        ],
      });
    }
  }

  for (let i = 0; i < midPipelineLeads.length; i++) {
    const lead = midPipelineLeads[i];
    const amount = 20000 + (i % 4) * 6000;
    const statusCycle = [PaymentStatus.PENDING, PaymentStatus.LINK_SENT, PaymentStatus.OVERDUE, PaymentStatus.PARTIAL];
    const status = statusCycle[i % statusCycle.length];

    await prisma.payment.create({
      data: { leadId: lead.id, gateway: PaymentGateway.RAZORPAY, amount, status, dueDate: status === PaymentStatus.OVERDUE ? daysAgo(5) : daysAgo(-7), gatewayOrderId: `order_demo_${i}` },
    });
    paymentCount++;
  }
  console.log(`Created ${paymentCount} payments.`);

  // ── Invoices (GST, EMI, registration flow) ──────────────────────────────
  const invoiceCandidates = [...enrolledLeads, ...midPipelineLeads];
  let invoiceCount = 0;
  let invoiceNo = 1;
  for (let i = 0; i < Math.min(30, invoiceCandidates.length); i++) {
    const lead = invoiceCandidates[i];
    const course = courses[i % courses.length];
    const batch = batches.find((b) => b.courseId === course.id) ?? batches[i % batches.length];
    const qty = 1;
    const unitPrice = course.defaultPrice;
    const discountType = i % 3 === 0 ? DiscountType.PERCENT : DiscountType.FLAT;
    const discountValue = discountType === DiscountType.PERCENT ? 10 : 2000;
    const gstType = i % 4 === 0 ? GstType.IGST : GstType.CGST_SGST;
    const totals = computeInvoiceTotals({
      lineItems: [{ quantity: qty, unitPrice }],
      discountType,
      discountValue,
      gstEnabled: true,
      gstType,
      gstRate: 18,
    });

    const statusCycle = [InvoiceStatus.PAID, InvoiceStatus.SENT, InvoiceStatus.DRAFT, InvoiceStatus.OVERDUE];
    const status = statusCycle[i % statusCycle.length];
    const invoiceDate = daysAgo(10 + (i % 50));

    const invoice = await prisma.invoice.create({
      data: {
        orgId,
        leadId: lead.id,
        invoiceNumber: `GXA-${String(invoiceNo++).padStart(4, '0')}`,
        status,
        invoiceDate,
        dueDate: status === InvoiceStatus.OVERDUE ? daysAgo(5) : daysAgo(-14),
        gstEnabled: true,
        gstType,
        gstRate: 18,
        discountType,
        discountValue,
        ...totals,
        paymentLinkAttached: status !== InvoiceStatus.DRAFT,
        paymentGateway: status !== InvoiceStatus.DRAFT ? PaymentGateway.RAZORPAY : undefined,
        sentAt: status !== InvoiceStatus.DRAFT ? invoiceDate : undefined,
        paidAt: status === InvoiceStatus.PAID ? daysAgo(2 + (i % 20)) : undefined,
        registeredAt: i % 2 === 0 ? invoiceDate : undefined,
        registeredById: i % 2 === 0 ? owner.id : undefined,
        registrationFee: i % 2 === 0 ? 5000 : undefined,
        registrationPaymentMode: i % 2 === 0 ? (i % 4 === 0 ? 'SCREENSHOT' : 'SAVE') : undefined,
        createdById: owner.id,
        lineItems: {
          create: [{ courseId: course.id, courseName: course.name, batchId: batch?.id, batchLabel: batch?.label, quantity: qty, unitPrice, lineTotal: qty * unitPrice, sortOrder: 0 }],
        },
      },
    });
    invoiceCount++;

    if (i % 5 === 0) {
      const tenure = 3 + (i % 4);
      const perEmi = Math.round((totals.grandTotal - 5000) / tenure);
      const emiData = Array.from({ length: tenure }, (_, n) => ({
        invoiceId: invoice.id,
        installmentNumber: n + 1,
        amount: n === tenure - 1 ? totals.grandTotal - 5000 - perEmi * (tenure - 1) : perEmi,
        dueDate: daysAgo(-30 * n),
        status: n === 0 ? EmiInstallmentStatus.PAID : EmiInstallmentStatus.PENDING,
        paidAt: n === 0 ? daysAgo(2) : undefined,
      }));
      await prisma.emiInstallment.createMany({ data: emiData });
    }
  }
  console.log(`Created ${invoiceCount} invoices with GST/discount/EMI variety.`);

  // ── Nurturing sequences + enrollments ───────────────────────────────────
  const welcomeSeq = await prisma.nurturingSequence.create({ data: welcomeSequenceCreateData(orgId) });

  const followUpSeq = await prisma.nurturingSequence.create({
    data: {
      name: 'Demo No-Show Follow-up',
      description: 'Nudges leads who missed their scheduled demo to reschedule.',
      triggerEvent: 'manual',
      isActive: false,
      orgId,
      steps: {
        create: [
          { stepOrder: 0, type: 'email', delayDays: 0, subject: 'Sorry we missed you!', body: '<p>Hi {{name}}, we missed you at the {{course}} demo — want to reschedule?</p>' },
          { stepOrder: 1, type: 'whatsapp', delayDays: 2, body: 'Hi {{name}}, just checking if you would like to pick a new time for your {{course}} demo?' },
          { stepOrder: 2, type: 'email', delayDays: 5, subject: 'Last chance to book your demo', body: '<p>Hi {{name}}, this is a final reminder to book your {{course}} demo — reply anytime!</p>' },
        ],
      },
    },
  });

  const reengagementSeq = await prisma.nurturingSequence.create({
    data: {
      name: 'Re-engagement – Cold Leads',
      description: 'Reaches back out to leads who have gone quiet for a while.',
      triggerEvent: 'manual',
      isActive: false,
      orgId,
      steps: {
        create: [
          { stepOrder: 0, type: 'email', delayDays: 0, subject: 'Still interested in {{course}}?', body: '<p>Hi {{name}}, checking in — is {{course}} still something you would like to explore?</p>' },
          { stepOrder: 1, type: 'email', delayDays: 7, subject: 'A special offer just for you', body: '<p>Hi {{name}}, we would love to have you join {{course}} — let us know if a limited-time discount would help.</p>' },
        ],
      },
    },
  });

  const nurturablePool = createdLeads.filter(
    (l) => !([LeadStage.ENROLLED, LeadStage.CLOSED_WON, LeadStage.CLOSED_LOST] as LeadStage[]).includes(l.stage),
  );
  let enrollmentCount = 0;
  for (let i = 0; i < Math.min(80, nurturablePool.length); i++) {
    const lead = nurturablePool[i];
    const seq = i % 3 === 0 ? welcomeSeq : i % 3 === 1 ? followUpSeq : reengagementSeq;
    const statusCycle = ['active', 'active', 'completed', 'removed'];
    const status = statusCycle[i % statusCycle.length];

    await prisma.nurturingEnrollment.create({
      data: {
        sequenceId: seq.id,
        leadId: lead.id,
        status,
        currentStep: status === 'completed' ? 2 : i % 2,
        nextRunAt: status === 'active' ? daysAgo(-2) : null,
        completedAt: status === 'completed' ? daysAgo(1) : null,
      },
    });
    enrollmentCount++;
  }
  console.log(`Created 3 nurturing sequences with ${enrollmentCount} enrollments (all inactive — no real sends).`);

  // ── Org message templates ───────────────────────────────────────────────
  await prisma.messageTemplate.createMany({
    data: [
      {
        channel: 'EMAIL',
        name: 'Fee Discount Offer',
        subject: 'A special offer on {{course}}',
        body: '<p>Hi {{name}},</p><p>As a valued lead, we would like to offer you 10% off {{course}} if you enroll this week.</p><p>— {{org}}</p>',
        orgId,
        createdById: owner.id,
      },
      {
        channel: 'WHATSAPP',
        name: 'Payment Reminder',
        subject: null,
        body: 'Hi {{name}}, this is a friendly reminder that your payment for {{course}} is pending. Reply here if you need help. — {{org}}',
        orgId,
        createdById: owner.id,
      },
    ],
  });
  console.log('Created 2 org-specific message templates.');

  // ── Integrations ─────────────────────────────────────────────────────────
  await prisma.orgIntegration.createMany({
    data: [
      { orgId, provider: IntegrationProvider.FACEBOOK, status: IntegrationStatus.CONNECTED, accountName: 'GenX Academy Page', accountId: 'demo-fb-page-id' },
      { orgId, provider: IntegrationProvider.GOOGLE_ADS, status: IntegrationStatus.CONNECTED, accountName: 'GenX Ads Account', accountId: 'demo-google-ads-id' },
    ],
  });
  console.log('Created 2 connected integrations (Facebook, Google Ads).');

  // ── Subscription / Billing ──────────────────────────────────────────────
  const plan = await prisma.subscriptionPlan.upsert({
    where: { slug: 'growth-monthly' },
    update: {},
    create: {
      slug: 'growth-monthly',
      name: 'Growth',
      tier: 'growth',
      pricePerUser: 799,
      billingInterval: BillingInterval.MONTHLY,
      minUsers: 6,
      maxUsers: 20,
      features: { leads: -1, users: 20, sequences: -1, teams: 10, emailCredits: 5000, whatsappCredits: 500, callRecording: true, advancedReports: true },
    },
  });

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const userCount = 2 + reps.length + 1;

  const subscription = await prisma.orgSubscription.create({
    data: { orgId, planId: plan.id, status: SubscriptionStatus.ACTIVE, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, userCount },
  });

  await prisma.subscriptionAddon.create({
    data: { subscriptionId: subscription.id, type: AddonType.EMAIL_CREDITS, quantity: 5000, usedCount: 1200, pricePaid: 999, validUntil: periodEnd },
  });

  await prisma.billingEvent.createMany({
    data: [
      { subscriptionId: subscription.id, event: 'subscription.activated', amount: userCount * 799, createdAt: daysAgo(28) },
      { subscriptionId: subscription.id, event: 'payment.captured', amount: userCount * 799, createdAt: daysAgo(28) },
    ],
  });
  console.log(`Created ACTIVE Growth subscription for ${userCount} users, with an add-on and billing events.`);

  console.log('\nClient demo seed complete.');
  console.log(`Log in at the Login page with: ${OWNER_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
