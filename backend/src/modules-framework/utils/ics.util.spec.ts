import { buildIcs, CALENDAR_SOURCES } from './ics.util';

describe('buildIcs', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  it('writes a timed event with a 60 minute default length', () => {
    const ics = buildIcs({ uid: 'a1', title: 'Call, Acme', start: new Date('2026-10-05T00:00:00Z'), time: '14:30' }, now);
    expect(ics).toContain('DTSTART:20261005T143000Z');
    expect(ics).toContain('DTEND:20261005T153000Z');
    expect(ics).toContain('SUMMARY:Call\\, Acme');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('writes an all-day event when there is no time', () => {
    const ics = buildIcs({ uid: 'a2', title: 'Deadline', start: new Date('2026-10-05T00:00:00Z') }, now);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005');
    expect(ics).toContain('DTEND;VALUE=DATE:20261006');
  });

  it('escapes newlines and semicolons in the description', () => {
    const ics = buildIcs({ uid: 'a3', title: 'x', start: now, description: 'line1\nline2; more' }, now);
    expect(ics).toContain('DESCRIPTION:line1\\nline2\\; more');
  });
});

describe('CALENDAR_SOURCES', () => {
  it('maps a tender to an all-day deadline event', () => {
    const event = CALENDAR_SOURCES.tenders({ title: 'Rail', tenderNo: 'T-9', authority: 'IR', submissionDeadline: '2026-11-02T00:00:00.000Z' });
    expect(event).toMatchObject({ title: 'Tender deadline: Rail', description: 'Tender T-9 (IR)' });
  });

  it('returns null for an activity with no due date', () => {
    expect(CALENDAR_SOURCES.activities({ subject: 'x', dueDate: null })).toBeNull();
  });
});
