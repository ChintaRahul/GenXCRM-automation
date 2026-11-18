// Minimal iCalendar (RFC 5545) writer for the "Add to calendar" download: one event per file.

export interface IcsEvent {
  readonly uid: string;
  readonly title: string;
  readonly start: Date;
  // "HH:mm" (24h). Without it the event is all-day.
  readonly time?: string | null;
  readonly durationMinutes?: number;
  readonly description?: string | null;
}

const pad = (value: number) => String(value).padStart(2, '0');
const stamp = (date: Date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const day = (date: Date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
// Text values escape backslashes, semicolons, commas and newlines; lines are folded by the caller.
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export const buildIcs = (event: IcsEvent, now = new Date()): string => {
  const [hours, minutes] = (event.time ?? '').split(':').map(Number);
  const timed = Number.isFinite(hours) && Number.isFinite(minutes);
  const start = new Date(Date.UTC(event.start.getUTCFullYear(), event.start.getUTCMonth(), event.start.getUTCDate(), timed ? hours : 0, timed ? minutes : 0));
  const end = new Date(start.getTime() + (event.durationMinutes ?? 60) * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GenXCRM//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid}@genxcrm`,
    `DTSTAMP:${stamp(now)}`,
    timed ? `DTSTART:${stamp(start)}` : `DTSTART;VALUE=DATE:${day(start)}`,
    timed ? `DTEND:${stamp(end)}` : `DTEND;VALUE=DATE:${day(new Date(start.getTime() + 86_400_000))}`,
    `SUMMARY:${text(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${text(event.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
};

// What each calendar-able module contributes, from its own record.
export const CALENDAR_SOURCES: Record<string, (record: Record<string, unknown>) => Omit<IcsEvent, 'uid'> | null> = {
  activities: (r) => (r.dueDate ? { title: String(r.subject), start: new Date(String(r.dueDate)), time: (r.dueTime as string | null) ?? null, description: (r.notes as string | null) ?? null } : null),
  visits: (r) => (r.visitDate ? { title: `Site visit: ${String(r.title)}`, start: new Date(String(r.visitDate)), time: (r.time as string | null) ?? null, durationMinutes: 120 } : null),
  demos: (r) => (r.plannedDate ? { title: `${String(r.type)}: ${String(r.title)}`, start: new Date(String(r.plannedDate)), durationMinutes: 120 } : null),
  tenders: (r) => (r.submissionDeadline ? { title: `Tender deadline: ${String(r.title)}`, start: new Date(String(r.submissionDeadline)), description: `Tender ${String(r.tenderNo)} (${String(r.authority)})` } : null),
};
