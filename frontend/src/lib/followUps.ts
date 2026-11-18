import type { FollowUpLead } from "../api/client";

export type FollowUpBucket = "overdue" | "today" | "upcoming";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Which group a follow-up belongs to, judged by the viewer's own calendar day.
export const bucketOf = (followUpAt: string, now = new Date()): FollowUpBucket => {
  const due = new Date(followUpAt);
  const today = startOfDay(now);
  if (due < today) return "overdue";
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return due < tomorrow ? "today" : "upcoming";
};

export const groupFollowUps = (items: FollowUpLead[], now = new Date()) => {
  const groups: Record<FollowUpBucket, FollowUpLead[]> = { overdue: [], today: [], upcoming: [] };
  for (const item of items) groups[bucketOf(item.followUpAt, now)].push(item);
  return groups;
};

// Tomorrow at 9:00 local, as the ISO string the API expects (used by "Snooze").
export const tomorrowMorningISO = (now = new Date()): string =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0).toISOString();

// <input type="datetime-local"> works in local time without a zone suffix.
export const toLocalInputValue = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
