// Adds 100 additional leads (spread across every LeadStage/LeadSource, and
// across the existing reps) to the org owned by the local demo account
// demo@genxcrm.local. Additive only — does not touch or wipe existing data.
//
// Run with:
//   npm run demo:seed:leads:local

import { PrismaClient, LeadSource, LeadStage } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@genxcrm.local';
const LEAD_COUNT = 100;

const COURSES = [
  'Data Science Bootcamp',
  'Full Stack Web Development',
  'UI/UX Design Masterclass',
  'Digital Marketing Pro',
  'Cloud Computing (AWS)',
  'Data Analytics with Python',
];

const CITIES = ['Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad'];

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Anika', 'Ira', 'Riya', 'Navya',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Rao', 'Reddy', 'Nair', 'Gupta', 'Mehta', 'Singh', 'Kapoor',
];

// Deliberately invalid format so seeded leads can never be mistaken for real
// contact info and can never actually be called/texted/emailed.
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `DEMO-PHONE-${String(phoneCounter).padStart(4, '0')}`;
}

function nameFor(i: number): string {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
  return `${first} ${last}`;
}

function daysAgo(n: number, hour = 10): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main() {
  const owner = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!owner?.orgId) {
    throw new Error(`No org found for ${DEMO_EMAIL} — log in / complete setup for this account first.`);
  }
  const orgId = owner.orgId;

  const reps = await prisma.user.findMany({ where: { orgId, role: 'SALES_REP' }, select: { id: true, teamId: true } });
  if (reps.length === 0) {
    console.warn('No sales reps found for this org — all seeded leads will be unassigned.');
  }

  const stages = Object.values(LeadStage);
  const sources = Object.values(LeadSource);
  const enrolledLikeStages = new Set<LeadStage>([LeadStage.ENROLLED, LeadStage.CLOSED_WON]);
  const midPipelineStages = new Set<LeadStage>([
    LeadStage.INTERESTED,
    LeadStage.NEGOTIATION,
    LeadStage.ENROLLMENT_PENDING,
    LeadStage.DEMO_SCHEDULED,
  ]);

  let created = 0;
  for (let i = 0; i < LEAD_COUNT; i++) {
    const stage = stages[i % stages.length];
    const source = sources[i % sources.length];
    const name = nameFor(i);
    const course = COURSES[i % COURSES.length];
    const city = CITIES[i % CITIES.length];
    const ageDays = 1 + (i % 42);
    const createdAt = daysAgo(ageDays, 8 + (i % 10));
    const rep = reps.length && i % 5 !== 0 ? reps[i % reps.length] : undefined; // ~20% unassigned
    const isNotInterestedLike = stage === LeadStage.NOT_INTERESTED || stage === LeadStage.CLOSED_LOST;

    await prisma.lead.create({
      data: {
        name,
        email: `demo-lead-${i}@example.invalid`,
        phone: nextPhone(),
        course,
        location: city,
        language: 'English',
        source,
        stage,
        score: enrolledLikeStages.has(stage) ? 70 + (i % 30) : 10 + (i % 60),
        interestedCount: midPipelineStages.has(stage) || enrolledLikeStages.has(stage) ? 1 + (i % 3) : 0,
        tags: enrolledLikeStages.has(stage) ? ['hot-lead'] : i % 6 === 0 ? ['budget-conscious'] : [],
        assignedToId: rep?.id,
        teamId: rep?.teamId ?? undefined,
        orgId,
        createdAt,
        updatedAt: createdAt,
        ...(isNotInterestedLike && { notInterestedAt: createdAt, notInterestedReason: 'Budget constraints this quarter' }),
      },
    });
    created++;
  }

  console.log(`Created ${created} leads for org ${orgId} (${DEMO_EMAIL}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
