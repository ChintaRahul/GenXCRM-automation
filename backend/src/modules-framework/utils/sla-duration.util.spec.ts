import { addBusinessMinutes, businessDayMinutes, businessMinutesBetween, computeSlaState, targetMinutes, type BusinessCalendarShape } from './sla-duration.util';

const STANDARD_CALENDAR: BusinessCalendarShape = {
  timezone: 'Asia/Kolkata',
  days: [
    { day: 'Mon', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Tue', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Wed', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Thu', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Fri', isOpen: true, from: '09:00', to: '18:00' },
    { day: 'Sat', isOpen: true, from: '09:00', to: '13:00' },
    { day: 'Sun', isOpen: false, from: '09:00', to: '18:00' },
  ],
};

// 2026-09-28 is a Monday.
const MON_10AM = new Date('2026-09-28T10:00:00.000Z');

describe('sla-duration.util', () => {
  describe('targetMinutes', () => {
    it('converts minutes/hours/days to minutes', () => {
      expect(targetMinutes(30, 'minutes')).toBe(30);
      expect(targetMinutes(2, 'hours')).toBe(120);
      expect(targetMinutes(1, 'days')).toBe(1440);
    });
  });

  describe('businessMinutesBetween', () => {
    it('returns 0 when to <= from', () => {
      expect(businessMinutesBetween(MON_10AM, MON_10AM, STANDARD_CALENDAR, new Set())).toBe(0);
    });

    it('counts only the open portion of a single business day', () => {
      const end = new Date('2026-09-28T12:00:00.000Z'); // Mon 12:00
      expect(businessMinutesBetween(MON_10AM, end, STANDARD_CALENDAR, new Set())).toBe(120);
    });

    it('skips the closed overnight/weekend gap between two business days', () => {
      // Mon 17:00 -> Tue 10:00: 1h left on Monday (17:00-18:00) + 1h on Tuesday (09:00-10:00) = 120 min
      const start = new Date('2026-09-28T17:00:00.000Z');
      const end = new Date('2026-09-29T10:00:00.000Z');
      expect(businessMinutesBetween(start, end, STANDARD_CALENDAR, new Set())).toBe(120);
    });

    it('excludes a holiday even though its weekday is normally open', () => {
      // Tue 2026-09-29 marked a holiday; Mon 17:00 -> Wed 10:00 should count only
      // Monday's last hour + Wednesday's first hour, skipping all of Tuesday.
      const start = new Date('2026-09-28T17:00:00.000Z');
      const end = new Date('2026-09-30T10:00:00.000Z');
      const minutes = businessMinutesBetween(start, end, STANDARD_CALENDAR, new Set(['2026-09-29']));
      expect(minutes).toBe(120);
    });

    it('excludes Sunday entirely', () => {
      const satMorning = new Date('2026-10-03T09:00:00.000Z'); // Sat open 09:00-13:00
      const monMorning = new Date('2026-10-05T10:00:00.000Z'); // Mon 09:00-18:00
      // Sat: 4h (09-13), Sun: 0, Mon: 1h (09:00-10:00) = 300 min
      expect(businessMinutesBetween(satMorning, monMorning, STANDARD_CALENDAR, new Set())).toBe(300);
    });
  });

  describe('addBusinessMinutes', () => {
    it('stays within the same open window when enough time remains', () => {
      const due = addBusinessMinutes(MON_10AM, 60, STANDARD_CALENDAR, new Set());
      expect(due.toISOString()).toBe('2026-09-28T11:00:00.000Z');
    });

    it('rolls over into the next open window when the current one runs out', () => {
      // Mon 17:30 + 90 min -> 30 min left Monday, 60 min into Tuesday morning (09:00-10:00)
      const start = new Date('2026-09-28T17:30:00.000Z');
      const due = addBusinessMinutes(start, 90, STANDARD_CALENDAR, new Set());
      expect(due.toISOString()).toBe('2026-09-29T10:00:00.000Z');
    });

    it('skips a holiday entirely when rolling over', () => {
      const start = new Date('2026-09-28T17:30:00.000Z');
      const due = addBusinessMinutes(start, 90, STANDARD_CALENDAR, new Set(['2026-09-29']));
      // Monday 30 min + Wednesday 60 min (skipping the Tuesday holiday)
      expect(due.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    });

    it('never returns a due date inside a closed window', () => {
      const due = addBusinessMinutes(MON_10AM, 600, STANDARD_CALENDAR, new Set()); // 10 hours of open time
      // From Mon 10:00, 8h remain open until 18:00; remaining 2h spills into Tue 09:00-11:00
      expect(due.toISOString()).toBe('2026-09-29T11:00:00.000Z');
    });
  });

  describe('computeSlaState', () => {
    it('uses plain wall-clock math for Calendar days', () => {
      const now = new Date('2026-09-29T10:00:00.000Z'); // 24h after MON_10AM
      const result = computeSlaState(MON_10AM, now, { val: 2, unit: 'days' }, 'Calendar days', STANDARD_CALENDAR, new Set());
      expect(result.dueAt.toISOString()).toBe('2026-09-30T10:00:00.000Z');
      expect(result.elapsedPct).toBeCloseTo(50, 5);
    });

    it('uses plain wall-clock math for 24 x 7', () => {
      const now = new Date('2026-09-28T11:00:00.000Z'); // 1h after MON_10AM
      const result = computeSlaState(MON_10AM, now, { val: 2, unit: 'hours' }, '24 x 7', STANDARD_CALENDAR, new Set());
      expect(result.elapsedPct).toBeCloseTo(50, 5);
    });

    it('uses business-hours-aware math for Business hours, skipping closed time in the elapsed percentage', () => {
      // Target: 2 hours. Now is 24h of wall-clock later (Tue 10:00) but only ~2h of business time
      // has actually elapsed (Mon 10:00-18:00 = 8h... wait target is only 2h so let's use a small window).
      const now = new Date('2026-09-28T12:00:00.000Z'); // 2h of open time elapsed
      const result = computeSlaState(MON_10AM, now, { val: 4, unit: 'hours' }, 'Business hours', STANDARD_CALENDAR, new Set());
      expect(result.elapsedPct).toBeCloseTo(50, 5);
    });

    it('counts a "days" target on Business hours as business days, not 24 h of open time', () => {
      // Mon-Fri 09:00-18:00 + Sat 09:00-13:00: average open day = (5 x 540 + 240) / 6 = 490 min.
      expect(businessDayMinutes(STANDARD_CALENDAR)).toBe(490);
      const mon9 = new Date('2026-09-28T09:00:00.000Z');
      const result = computeSlaState(mon9, mon9, { val: 3, unit: 'days' }, 'Business hours', STANDARD_CALENDAR, new Set());
      // 3 x 490 = 1470 min of open time: Mon 540 + Tue 540 + Wed 390 -> Wed 15:30.
      expect(result.dueAt.toISOString()).toBe('2026-09-30T15:30:00.000Z');
    });

    it('falls back to an 8 hour business day when no day is open', () => {
      const closed: BusinessCalendarShape = { timezone: 'UTC', days: STANDARD_CALENDAR.days.map((d) => ({ ...d, isOpen: false })) };
      expect(businessDayMinutes(closed)).toBe(480);
    });

    it('keeps hours targets on Business hours literal', () => {
      const result = computeSlaState(MON_10AM, MON_10AM, { val: 2, unit: 'hours' }, 'Business hours', STANDARD_CALENDAR, new Set());
      expect(result.dueAt.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    });

    it('shows 0% elapsed immediately at start and grows toward 100% at the due date', () => {
      const result = computeSlaState(MON_10AM, MON_10AM, { val: 1, unit: 'hours' }, 'Business hours', STANDARD_CALENDAR, new Set());
      expect(result.elapsedPct).toBe(0);
      const atDue = computeSlaState(MON_10AM, result.dueAt, { val: 1, unit: 'hours' }, 'Business hours', STANDARD_CALENDAR, new Set());
      expect(atDue.elapsedPct).toBeCloseTo(100, 5);
    });
  });
});
