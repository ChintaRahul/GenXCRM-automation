import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Triggers a browser "Save As" for an already-fetched file — shared by every module's PDF/CSV
// export so the createObjectURL/anchor-click dance isn't duplicated per caller.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago".
export const timeAgo = (date: string | Date): string => {
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// ISO instant for the start of the current calendar month (local time), e.g. for
// "month to date" (MTD) filtering — shared by the Leads page default and the
// sidebar's MTD lead count.
export const startOfMonthISO = (): string => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
};

// Absolute date+time in the browser's local timezone, e.g. "3 Aug 2026, 2:30 pm".
export const formatDateTime = (date: string | Date): string => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// Today as YYYY-MM-DD in the user's local time (the value format of a date input).
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
