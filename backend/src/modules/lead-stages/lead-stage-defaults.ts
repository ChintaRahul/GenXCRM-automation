import { LeadStage } from '@prisma/client';
import type { StageColor } from '../../common/constants/lead.constants';

// Labels/colours mirror frontend StatusBadge.tsx (LABEL_MAP / STATUS_STYLES).
export const LEAD_STAGE_DEFAULTS: Record<LeadStage, { label: string; color: StageColor }> = {
  NEW: { label: 'New', color: 'blue' },
  CONTACTED: { label: 'Contacted', color: 'yellow' },
  INTERESTED: { label: 'Interested', color: 'green' },
  RINGING_NOT_REACHABLE: { label: 'Ringing, not reachable', color: 'slate' },
  FOLLOW_UP_REQUIRED: { label: 'Follow-up required', color: 'amber' },
  CALL_BACK: { label: 'Call back', color: 'amber' },
  CALL_NOT_RECEIVED: { label: 'Call not received', color: 'slate' },
  SWITCHED_OFF: { label: 'Switch off', color: 'red' },
  WHATSAPP_SENT: { label: 'Whatsapp sent', color: 'teal' },
  DEMO_SCHEDULED: { label: 'Demo Scheduled', color: 'indigo' },
  DEMO_ATTENDED: { label: 'Demo attended', color: 'indigo' },
  NEGOTIATION: { label: 'Negotiation', color: 'orange' },
  ENROLLMENT_PENDING: { label: 'Enrollment pending', color: 'orange' },
  ENROLLED: { label: 'Enrolled', color: 'green' },
  NOT_INTERESTED: { label: 'Not Interested', color: 'gray' },
  DROPPED: { label: 'Dropped', color: 'red' },
  CLOSED_WON: { label: 'Won', color: 'green' },
  CLOSED_LOST: { label: 'Lost', color: 'red' },
};

// Default order = enum declaration order x 10.
export const LEAD_STAGE_ORDER: LeadStage[] = Object.values(LeadStage);
