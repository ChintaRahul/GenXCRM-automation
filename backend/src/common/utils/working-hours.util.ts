import type { RoutingSettings } from '../constants/org-defaults';

// Same technique as reports.service.ts's getTimeZoneOffsetMs — Intl.DateTimeFormat
// with an explicit IANA zone gives the wall-clock time in that zone without a
// date-library dependency; formatToParts avoids relying on locale-specific ordering.
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - date.getTime();
}

function zonedNow(date: Date, timeZone: string): { weekday: number; year: number; month: number; day: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    minutesOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

// UTC instant of `minutesOfDay` local time on the given zoned calendar date.
function zonedTimeToUtc(year: number, month: number, day: number, minutesOfDay: number, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, Math.floor(minutesOfDay / 60), minutesOfDay % 60));
  return new Date(utcGuess.getTime() - getTimeZoneOffsetMs(utcGuess, timeZone));
}

function parseHhMm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + (m || 0);
}

function addDaysUtc(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * How long (ms) to delay an automatic assignment so it lands inside the org's
 * configured working-hours window, honoring skipWeekends. Returns 0 if `now`
 * is already inside the window. When `routing.alwaysOn` is set the window
 * covers the full day — only skipWeekends (if also on) can still delay.
 * Pure (besides reading the system clock via the `now` param) so it's easy
 * to unit test directly.
 */
export function computeAssignmentDelayMs(now: Date, timezone: string, routing: RoutingSettings): number {
  const startMin = routing.alwaysOn ? 0 : parseHhMm(routing.workingHoursStart);
  const endMin = routing.alwaysOn ? 24 * 60 - 1 : parseHhMm(routing.workingHoursEnd);
  const today = zonedNow(now, timezone);

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const { year, month, day } = daysAhead === 0 ? today : addDaysUtc(today.year, today.month, today.day, daysAhead);
    const weekday = (today.weekday + daysAhead) % 7;
    if (routing.skipWeekends && (weekday === 0 || weekday === 6)) continue;

    if (daysAhead === 0) {
      if (today.minutesOfDay >= startMin && today.minutesOfDay <= endMin) return 0; // already inside the window
      if (today.minutesOfDay > endMin) continue; // today's window already passed
      // before today's window — delay to today's start
      return Math.max(0, zonedTimeToUtc(year, month, day, startMin, timezone).getTime() - now.getTime());
    }

    // A future valid day — delay to that day's start.
    return Math.max(0, zonedTimeToUtc(year, month, day, startMin, timezone).getTime() - now.getTime());
  }
  return 0; // no valid window found in a week (shouldn't happen with sane settings) — don't block forever
}
