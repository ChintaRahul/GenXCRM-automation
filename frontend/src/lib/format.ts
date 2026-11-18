import type { Lead, Invoice, InvoiceStatus } from "../types";
import type { ProductivityRow } from "../api/client";

export function rupeeShort(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
  return `₹${n.toLocaleString("en-IN")}`;
}

// Full (non-abbreviated) rupee amount with 2 decimals, e.g. ₹1,25,000.00 — used for
// exact invoice/line-item amounts per the design handoff's currency formatting rule
// (₹ + toLocaleString('en-IN'), 2 decimals, tabular numerals in mono).
export function rupeeFull(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// A SENT invoice past its due date reads as "Overdue" without a backend cron job
// mutating the row — computed at display time from status + dueDate. There is no
// separate stored transition, so this must be applied everywhere an invoice's status
// badge is rendered (InvoiceTable, etc.) rather than trusting `invoice.status` directly.
export function getInvoiceDisplayStatus(
  invoice: Pick<Invoice, "status" | "dueDate">,
): InvoiceStatus {
  if (invoice.status === "SENT" && invoice.dueDate && new Date(invoice.dueDate) < new Date()) {
    return "OVERDUE";
  }
  return invoice.status;
}

// Absolute date (no time) in the browser's local timezone, e.g. "3 Aug 2026" — or a
// dash when the date is missing (e.g. an invoice with no due date set).
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function leadsToCSV(leads: Lead[]): string {
  const headers = [
    "Name",
    "Phone",
    "Email",
    "Source",
    "Stage",
    "Score",
    "Course",
    "Created",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = leads.map((l) =>
    [
      l.name,
      l.phone,
      l.email ?? "",
      l.source,
      l.stage,
      String(l.score),
      l.course ?? "",
      l.createdAt,
    ]
      .map(escape)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

export function productivityToCSV(rows: ProductivityRow[]): string {
  const headers = [
    "Rep",
    "Total",
    "Not Engaged",
    "Untouched",
    "Followup Overdue",
    "Revenue Collected",
    "Target",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csvRows = rows.map((r) =>
    [
      r.repName,
      String(r.total),
      String(r.notEngaged),
      String(r.untouched),
      String(r.followupOverdue),
      String(r.revenueCollected),
      String(r.target),
    ]
      .map(escape)
      .join(","),
  );
  return [headers.join(","), ...csvRows].join("\n");
}
