import { LeadStage, Prisma } from '@prisma/client';
import { SYSTEM_ACTIVITY_TYPES } from '../constants/lead.constants';

// A lead only counts as "active" in a range because of real work by someone on the team
// (sales rep, manager, director). None of these count: auto-assignment, reassignment, a
// customer submitting again, a CSV re-import, user deactivation, backfill jobs.
//
// Deliberately NOT `Lead.updatedAt` or `Lead.activityAt`: updatedAt is bumped by all of the
// above (on prod ~70% of leads had an updatedAt moved only by system writes), and activityAt
// is set by customer resubmissions — neither says a person worked the lead.

// A timeline entry authored by a person: stage change, note, call log, call alert. The
// system/customer types (ASSIGNED, REASSIGN, ASSIGNMENT_FAILED, RESUBMITTED) are excluded
// even when a user id is attached (e.g. the rep who received the auto-assignment).
const teamActivityIn = (range: Prisma.DateTimeFilter): Prisma.LeadWhereInput => ({
  activities: { some: { createdAt: range, userId: { not: null }, type: { notIn: SYSTEM_ACTIVITY_TYPES } } },
});

// A call logged by a person (Communication.calledById is only set by logCall()).
const callIn = (range: Prisma.DateTimeFilter): Prisma.LeadWhereInput => ({
  communications: { some: { sentAt: range, calledById: { not: null } } },
});

// An email/SMS/WhatsApp a person sent — those record `metadata.sentBy` (the sending user).
// Inbound messages and any automated send carry no sender, so they do not count.
const messageIn = (range: Prisma.DateTimeFilter): Prisma.LeadWhereInput => ({
  communications: {
    some: {
      sentAt: range,
      direction: 'outbound',
      metadata: { path: ['sentBy'], string_contains: '' },
    },
  },
});

// Explicitly typed: letting TS infer these array literals against Prisma's recursive
// LeadWhereInput blows ts-jest's memory ("Zone" out of memory).
export const leadActivityInRange = (range: Prisma.DateTimeFilter): Prisma.LeadWhereInput => {
  const legs: Prisma.LeadWhereInput[] = [teamActivityIn(range), callIn(range), messageIn(range)];
  return { OR: legs };
};

// The one date-range rule shared by the Leads list and every report count, so a card's
// number always equals the list it drills into: created in the range, or — for ENROLLED
// leads only — a team member did real work on it in the range (e.g. moved it to ENROLLED
// this month after it was created last month). Every other stage counts by createdAt alone.
export const leadInRange = (range: Prisma.DateTimeFilter): Prisma.LeadWhereInput => {
  const enrolledWorked: Prisma.LeadWhereInput = {
    stage: LeadStage.ENROLLED,
    OR: [teamActivityIn(range), callIn(range), messageIn(range)],
  };
  const legs: Prisma.LeadWhereInput[] = [{ createdAt: range }, enrolledWorked];
  return { OR: legs };
};
