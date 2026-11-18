import { cn } from "../../lib/utils";

const STATUS_STYLES: Record<string, string> = {
  // Lead stages (backend)
  NEW: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  CONTACTED:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  INTERESTED:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  RINGING_NOT_REACHABLE:
    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  FOLLOW_UP_REQUIRED:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  CALL_BACK:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  CALL_NOT_RECEIVED:
    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  SWITCHED_OFF: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  WHATSAPP_SENT:
    "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  DEMO_SCHEDULED:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  DEMO_ATTENDED:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  NEGOTIATION:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  ENROLLMENT_PENDING:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  ENROLLED:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  NOT_INTERESTED:
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  DROPPED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  CLOSED_WON:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  CLOSED_LOST: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  // Roles
  DIRECTOR:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  MANAGER: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SALES_REP: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  // Payment statuses
  PAID: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  PENDING:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  LINK_SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  OVERDUE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  PARTIAL:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  REFUNDED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  // Assignment state
  UNASSIGNED:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  // Invoice statuses (PAID/OVERDUE reused from Payment statuses above)
  DRAFT: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  CANCELLED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  // Communication send status
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const LABEL_MAP: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  INTERESTED: "Interested",
  RINGING_NOT_REACHABLE: "Ringing, not reachable",
  FOLLOW_UP_REQUIRED: "Follow-up required",
  CALL_BACK: "Call back",
  CALL_NOT_RECEIVED: "Call not received",
  SWITCHED_OFF: "Switch off",
  WHATSAPP_SENT: "Whatsapp sent",
  DEMO_SCHEDULED: "Demo Scheduled",
  DEMO_ATTENDED: "Demo attended",
  NEGOTIATION: "Negotiation",
  ENROLLMENT_PENDING: "Enrollment pending",
  ENROLLED: "Enrolled",
  NOT_INTERESTED: "Not Interested",
  DROPPED: "Dropped",
  CLOSED_WON: "Won",
  CLOSED_LOST: "Lost",
  DIRECTOR: "Director",
  MANAGER: "Manager",
  SALES_REP: "Sales Rep",
  PAID: "Paid",
  PENDING: "Pending",
  LINK_SENT: "Link Sent",
  OVERDUE: "Overdue",
  PARTIAL: "Partial",
  REFUNDED: "Refunded",
  UNASSIGNED: "Unassigned",
  FACEBOOK: "Facebook",
  GOOGLE_ADS: "Google Ads",
  WEBSITE: "Website",
  INSTAGRAM: "Instagram",
  WALK_IN: "Walk-in",
  REFERRAL: "Referral",
  OUTBOUND_CALL: "Outbound",
  CHAT: "Chat",
  API: "API",
  OTHER: "Other",
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  CALL: "Call",
  NOTE: "Note",
  DEMO: "Demo",
  DRAFT: "Draft",
  SENT: "Sent",
  CANCELLED: "Voided",
  failed: "Failed",
};

// Solid dot colors paired with each status's tint in STATUS_STYLES above —
// used for compact indicators (e.g. filter dropdown checklists) where the
// light badge background would be nearly invisible at a few pixels wide.
const DOT_TONES: Record<string, string> = {
  NEW: "bg-blue-500",
  CONTACTED: "bg-yellow-500",
  INTERESTED: "bg-green-500",
  RINGING_NOT_REACHABLE: "bg-slate-400",
  FOLLOW_UP_REQUIRED: "bg-amber-500",
  CALL_BACK: "bg-amber-500",
  CALL_NOT_RECEIVED: "bg-slate-400",
  SWITCHED_OFF: "bg-red-500",
  WHATSAPP_SENT: "bg-teal-500",
  DEMO_SCHEDULED: "bg-indigo-500",
  DEMO_ATTENDED: "bg-indigo-500",
  NEGOTIATION: "bg-orange-500",
  ENROLLMENT_PENDING: "bg-orange-500",
  ENROLLED: "bg-green-500",
  NOT_INTERESTED: "bg-gray-400",
  DROPPED: "bg-red-500",
  CLOSED_WON: "bg-green-500",
  CLOSED_LOST: "bg-red-500",
  // Lead sources
  FACEBOOK: "bg-blue-500",
  GOOGLE_ADS: "bg-green-500",
  WEBSITE: "bg-amber-500",
  INSTAGRAM: "bg-purple-500",
  WALK_IN: "bg-gray-400",
  REFERRAL: "bg-green-500",
  OUTBOUND_CALL: "bg-indigo-500",
  CHAT: "bg-teal-500",
  API: "bg-slate-400",
  OTHER: "bg-gray-400",
};

// Readable label for a status / source value (e.g. GOOGLE_ADS -> "Google Ads").
export const statusLabel = (status: string): string => LABEL_MAP[status] ?? status.replace(/_/g, " ");

export function statusDotClassName(status: string): string {
  return DOT_TONES[status] ?? "bg-gray-400";
}

// Generic tone map for registry-driven module pills (Manufacturing workspace
// framework) — keyed by tone name rather than a domain-specific enum string,
// so callers don't need a matching STATUS_STYLES entry.
const TONE_STYLES: Record<string, string> = {
  gray: "bg-muted text-muted-foreground",
  teal: "bg-primary-soft text-primary-text",
  blue: "bg-info-soft text-info",
  amber: "bg-warning-soft text-warning-text",
  green: "bg-success-soft text-success-text",
  red: "bg-destructive-soft text-destructive",
  violet: "bg-violet-soft text-violet",
};

export type BadgeTone =
  | "gray"
  | "teal"
  | "blue"
  | "amber"
  | "green"
  | "red"
  | "violet";

export function StatusBadge({
  status,
  className,
  title,
  tone,
}: {
  status: string;
  className?: string;
  title?: string;
  tone?: BadgeTone;
}) {
  if (tone) {
    const toneStyle = TONE_STYLES[tone] ?? TONE_STYLES.gray;
    const toneLabel = title ?? status.replace(/_/g, " ");
    return (
      <span
        title={title}
        className={cn(
          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
          toneStyle,
          className,
        )}
      >
        {toneLabel}
      </span>
    );
  }
  const style =
    STATUS_STYLES[status] ??
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  const label = LABEL_MAP[status] ?? status.replace(/_/g, " ");
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        style,
        className,
      )}
    >
      {label}
    </span>
  );
}
