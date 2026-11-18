import { leadActivityInRange, leadInRange } from './lead-range.util';
import { SYSTEM_ACTIVITY_TYPES } from '../constants/lead.constants';

const range = { gte: new Date('2026-09-19'), lt: new Date('2026-09-27') };

describe('lead-range.util', () => {
  it('never uses Lead.updatedAt or Lead.activityAt (both moved by non-team writes)', () => {
    const json = JSON.stringify(leadInRange(range));
    expect(json).not.toContain('updatedAt');
    expect(json).not.toContain('activityAt');
    expect(JSON.stringify(leadActivityInRange(range))).not.toContain('activityAt');
  });

  it('counts created for every stage, and person work only for ENROLLED leads', () => {
    expect(leadInRange(range)).toEqual({
      OR: [
        { createdAt: range },
        {
          stage: 'ENROLLED',
          OR: [
            {
              activities: {
                some: { createdAt: range, userId: { not: null }, type: { notIn: SYSTEM_ACTIVITY_TYPES } },
              },
            },
            { communications: { some: { sentAt: range, calledById: { not: null } } } },
            {
              communications: {
                some: { sentAt: range, direction: 'outbound', metadata: { path: ['sentBy'], string_contains: '' } },
              },
            },
          ],
        },
      ],
    });
  });

  it('excludes assignment, reassignment and resubmission activity types', () => {
    expect(SYSTEM_ACTIVITY_TYPES).toEqual(
      expect.arrayContaining(['ASSIGNED', 'REASSIGN', 'ASSIGNMENT_FAILED', 'RESUBMITTED']),
    );
  });

  it('activity-only variant omits the createdAt leg', () => {
    const legs = leadActivityInRange(range).OR as Record<string, unknown>[];
    expect(legs).toHaveLength(3);
    expect(legs.some((l) => 'createdAt' in l)).toBe(false);
  });
});
