import { computeAssignmentDelayMs } from './working-hours.util';
import { DEFAULT_ROUTING_SETTINGS } from '../constants/org-defaults';

const TZ = 'Asia/Kolkata'; // UTC+5:30, no DST — deterministic across the year

describe('computeAssignmentDelayMs', () => {
  it('returns 0 when inside the working-hours window', () => {
    // 2026-09-07 is a Monday. 12:00 IST is well inside 09:00-18:00.
    const now = new Date('2026-09-07T06:30:00.000Z'); // 12:00 IST
    expect(computeAssignmentDelayMs(now, TZ, DEFAULT_ROUTING_SETTINGS)).toBe(0);
  });

  it('delays to today\'s start when called before working hours', () => {
    // 07:00 IST — 2 hours before the 09:00 start.
    const now = new Date('2026-09-07T01:30:00.000Z');
    const delay = computeAssignmentDelayMs(now, TZ, DEFAULT_ROUTING_SETTINGS);
    expect(delay).toBe(2 * 60 * 60 * 1000);
  });

  it('delays to the next day\'s start when called after working hours', () => {
    // 20:00 IST Monday — after the 18:00 end. Next start: Tuesday 09:00 IST, 13h away.
    const now = new Date('2026-09-07T14:30:00.000Z');
    const delay = computeAssignmentDelayMs(now, TZ, DEFAULT_ROUTING_SETTINGS);
    expect(delay).toBe(13 * 60 * 60 * 1000);
  });

  it('skips the weekend and delays to Monday when skipWeekends is on', () => {
    // 2026-09-05 is a Saturday, 12:00 IST — inside hours, but it's the weekend.
    const now = new Date('2026-09-05T06:30:00.000Z');
    const routing = { ...DEFAULT_ROUTING_SETTINGS, skipWeekends: true };
    const delay = computeAssignmentDelayMs(now, TZ, routing);
    const expectedStart = new Date('2026-09-07T03:30:00.000Z'); // Monday 09:00 IST
    expect(now.getTime() + delay).toBe(expectedStart.getTime());
  });

  it('does not skip the weekend when skipWeekends is off', () => {
    // Saturday 12:00 IST, inside hours — allowed immediately.
    const now = new Date('2026-09-05T06:30:00.000Z');
    const delay = computeAssignmentDelayMs(now, TZ, { ...DEFAULT_ROUTING_SETTINGS, skipWeekends: false });
    expect(delay).toBe(0);
  });

  it('handles the default working-hours window unmodified', () => {
    expect(DEFAULT_ROUTING_SETTINGS.workingHoursStart).toBe('09:00');
    expect(DEFAULT_ROUTING_SETTINGS.workingHoursEnd).toBe('18:00');
  });

  it('returns 0 at any time of day when alwaysOn is set, ignoring the configured window', () => {
    // 02:00 IST — well outside the default 09:00-18:00 window.
    const now = new Date('2026-09-07T20:30:00.000Z');
    const routing = { ...DEFAULT_ROUTING_SETTINGS, alwaysOn: true };
    expect(computeAssignmentDelayMs(now, TZ, routing)).toBe(0);
  });

  it('still honors skipWeekends when alwaysOn is set', () => {
    // Saturday 12:00 IST — alwaysOn covers the full day, but it's still the weekend.
    const now = new Date('2026-09-05T06:30:00.000Z');
    const routing = { ...DEFAULT_ROUTING_SETTINGS, alwaysOn: true, skipWeekends: true };
    const delay = computeAssignmentDelayMs(now, TZ, routing);
    const expectedStart = new Date('2026-09-06T18:30:00.000Z'); // Monday 00:00 IST
    expect(now.getTime() + delay).toBe(expectedStart.getTime());
  });
});
