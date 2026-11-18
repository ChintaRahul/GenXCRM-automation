import { LeadStage } from '@prisma/client';

// Stages treated as "closed" across reporting and filtering — a lead in one of
// these is done, not awaiting followup. Shared by leads.service (list filtering)
// and reports.service (productivity metrics) so the two definitions can't drift.
export const CLOSED_LEAD_STAGES: LeadStage[] = [
  LeadStage.CLOSED_WON,
  LeadStage.CLOSED_LOST,
  LeadStage.NOT_INTERESTED,
];

// Built-in stages the reports/reminders code references directly: they can be renamed,
// recoloured and reordered per org, but never hidden or deleted.
export const MANDATORY_STAGES: LeadStage[] = [
  LeadStage.NEW,
  LeadStage.INTERESTED,
  LeadStage.FOLLOW_UP_REQUIRED,
  LeadStage.DEMO_SCHEDULED,
  LeadStage.ENROLLED,
  LeadStage.NOT_INTERESTED,
];

export const MAX_CUSTOM_STAGES = 30;

export const STAGE_COLORS = [
  'blue',
  'yellow',
  'green',
  'slate',
  'amber',
  'teal',
  'indigo',
  'orange',
  'red',
  'gray',
  'purple',
] as const;

export type StageColor = (typeof STAGE_COLORS)[number];

// Logged on the lead's timeline whenever the same person submits again (a duplicate is
// never a second record). It is the customer acting, not a rep engaging, so it counts
// neither as "touched" nor toward the date filters (see common/utils/lead-range.util.ts).
export const RESUBMITTED_ACTIVITY_TYPE = 'RESUBMITTED';

// Activity types that are NOT a rep engaging with the lead: written by the system
// (round-robin auto-assignment, reassignment, terminal assignment failure) or by the
// customer (a resubmission). "Untouched"/"Idle" checks must exclude these — otherwise the
// ASSIGNED activity created for every lead the instant it's auto-assigned
// (assignments.service.ts) makes it count as "touched" before a rep has ever contacted it.
// Shared by leads.service (list filtering) and reports.service (productivity metrics) so
// the two definitions can't drift.
export const SYSTEM_ACTIVITY_TYPES = ['ASSIGNED', 'REASSIGN', 'ASSIGNMENT_FAILED', RESUBMITTED_ACTIVITY_TYPE];

// Points added to Lead.score (capped at 100) each time a rep genuinely engages with a
// lead. Drives the "Not Engaged" report metric (score < 10) and the hot-lead/score
// filters in Leads — see common/utils/lead-score.util.ts for the increment helper.
export const ENGAGEMENT_SCORE_POINTS = {
  CALL: 15,
  EMAIL: 5,
  SMS: 5,
  WHATSAPP: 5,
  NOTE: 5,
  STAGE_CHANGE: 10,
} as const;
