export type SlaCalendarType = 'Business hours' | 'Calendar days' | '24 x 7';
export type SlaDurationUnit = 'minutes' | 'hours' | 'days';

export interface BusinessCalendarDay {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  isOpen: boolean;
  from: string; // 'HH:mm'
  to: string; // 'HH:mm'
}

export interface BusinessCalendarShape {
  timezone: string;
  days: BusinessCalendarDay[];
}

const DAY_NAMES: BusinessCalendarDay['day'][] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function targetMinutes(val: number, unit: SlaDurationUnit): number {
  if (unit === 'minutes') return val;
  if (unit === 'hours') return val * 60;
  return val * 24 * 60;
}

const FALLBACK_BUSINESS_DAY_MINUTES = 8 * 60;

// Length of one "business day" for this calendar: the average open window across its open days
// (falls back to 8 h when no day is open). A '3 days' target on a Business-hours policy means three
// of these, not 3 x 24 h consumed from the open windows only.
export function businessDayMinutes(calendar: BusinessCalendarShape): number {
  const windows = calendar.days
    .filter((d) => d.isOpen)
    .map((d) => {
      const from = parseHm(d.from);
      const to = parseHm(d.to);
      return to.h * 60 + to.m - (from.h * 60 + from.m);
    })
    .filter((minutes) => minutes > 0);
  if (!windows.length) return FALLBACK_BUSINESS_DAY_MINUTES;
  return Math.round(windows.reduce((sum, minutes) => sum + minutes, 0) / windows.length);
}

function isHoliday(date: Date, holidayDates: ReadonlySet<string>): boolean {
  return holidayDates.has(date.toISOString().slice(0, 10));
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map(Number);
  return { h, m };
}

// Minutes of `date`'s calendar day that fall within its configured open window, ignoring
// holidays (callers check isHoliday separately — a holiday's whole day is treated as closed).
function dayWindowMinutes(date: Date, calendar: BusinessCalendarShape): { openFrom: Date; openTo: Date } | null {
  const dayName = DAY_NAMES[date.getUTCDay()];
  const config = calendar.days.find((d) => d.day === dayName);
  if (!config || !config.isOpen) return null;
  const from = parseHm(config.from);
  const to = parseHm(config.to);
  const openFrom = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), from.h, from.m));
  const openTo = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), to.h, to.m));
  return { openFrom, openTo };
}

// Business-hours-aware minutes elapsed between `from` and `to` (to >= from), skipping closed
// days/holidays and the portion of each day outside its open window. Dates are treated as UTC
// wall-clock instants — the calendar's `timezone` field is descriptive only (this codebase has
// no per-org timezone-aware business-hours engine elsewhere to build on); see manufacturing
// Phase 5 completion notes for this known simplification.
export function businessMinutesBetween(from: Date, to: Date, calendar: BusinessCalendarShape, holidayDates: ReadonlySet<string>): number {
  if (to.getTime() <= from.getTime()) return 0;
  let minutes = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const endDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= endDay.getTime()) {
    if (!isHoliday(cursor, holidayDates)) {
      const window = dayWindowMinutes(cursor, calendar);
      if (window) {
        const segmentStart = window.openFrom.getTime() > from.getTime() ? window.openFrom : from;
        const segmentEnd = window.openTo.getTime() < to.getTime() ? window.openTo : to;
        if (segmentEnd.getTime() > segmentStart.getTime()) {
          minutes += (segmentEnd.getTime() - segmentStart.getTime()) / 60_000;
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return minutes;
}

// Walks forward from `from` in business-hours windows until `minutesNeeded` of open time has
// elapsed, returning the resulting due date. Bounded to 3 years out to guarantee termination
// against a calendar with every day closed.
export function addBusinessMinutes(from: Date, minutesNeeded: number, calendar: BusinessCalendarShape, holidayDates: ReadonlySet<string>): Date {
  let remaining = minutesNeeded;
  const cursor = new Date(from);
  const hardStop = new Date(from.getTime() + 3 * 365 * 24 * 60 * 60_000);
  while (remaining > 0 && cursor.getTime() < hardStop.getTime()) {
    const dayStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
    if (!isHoliday(dayStart, holidayDates)) {
      const window = dayWindowMinutes(dayStart, calendar);
      if (window && window.openTo.getTime() > cursor.getTime()) {
        const segmentStart = window.openFrom.getTime() > cursor.getTime() ? window.openFrom : cursor;
        const availableMinutes = (window.openTo.getTime() - segmentStart.getTime()) / 60_000;
        if (availableMinutes > 0) {
          if (availableMinutes >= remaining) {
            return new Date(segmentStart.getTime() + remaining * 60_000);
          }
          remaining -= availableMinutes;
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return cursor;
}

// The due date and elapsed-percent-of-target for a timer, given its calendar type. Calendar
// days / 24 x 7 policies use plain wall-clock elapsed time (no window-skipping); Business hours
// policies skip closed days, holidays, and out-of-window time on both ends; on those a 'days'
// target counts business days (see businessDayMinutes), while hours/minutes stay literal.
export function computeSlaState(
  startedAt: Date,
  now: Date,
  target: { val: number; unit: SlaDurationUnit },
  calendarType: SlaCalendarType,
  calendar: BusinessCalendarShape,
  holidayDates: ReadonlySet<string>,
): { dueAt: Date; elapsedPct: number } {
  if (calendarType === 'Business hours') {
    const minutesTarget = target.unit === 'days' ? target.val * businessDayMinutes(calendar) : targetMinutes(target.val, target.unit);
    const dueAt = addBusinessMinutes(startedAt, minutesTarget, calendar, holidayDates);
    const elapsedMinutes = businessMinutesBetween(startedAt, now, calendar, holidayDates);
    return { dueAt, elapsedPct: minutesTarget > 0 ? (elapsedMinutes / minutesTarget) * 100 : 0 };
  }
  const minutesTarget = targetMinutes(target.val, target.unit);
  const dueAt = new Date(startedAt.getTime() + minutesTarget * 60_000);
  const elapsedMinutes = (now.getTime() - startedAt.getTime()) / 60_000;
  return { dueAt, elapsedPct: minutesTarget > 0 ? (elapsedMinutes / minutesTarget) * 100 : 0 };
}
