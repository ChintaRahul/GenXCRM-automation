// Shared default shapes for Organization JSON settings blobs. Lives here (not in
// organizations.service.ts) because AssignmentsService and PaymentReceiptsService
// also need to merge stored settings with these defaults, without a hard
// dependency on OrganizationsService for a single constant.

export const DEFAULT_SECURITY_SETTINGS = {
  passwordMinLength: 8,
  sessionTimeoutMinutes: 60,
  requireNumber: true,
  requireSymbol: false,
  mfaEnabled: false,
  mfaEnforced: false,
  ssoProvider: 'NONE' as const,
  ssoConnected: false,
};

export type SecuritySettings = typeof DEFAULT_SECURITY_SETTINGS;

// Session length bounds: at least 5 minutes (anything shorter is unusable —
// a rep would get logged out mid-task), at most 7 days (matches the old
// flat JWT_EXPIRES_IN default so orgs that never touch this setting see no
// change, and puts a hard ceiling on how long a token can possibly live).
export const SESSION_TIMEOUT_MIN_MINUTES = 5;
export const SESSION_TIMEOUT_MAX_MINUTES = 7 * 24 * 60; // 10080

export function clampSessionTimeoutMinutes(minutes: number): number {
  return Math.min(Math.max(minutes, SESSION_TIMEOUT_MIN_MINUTES), SESSION_TIMEOUT_MAX_MINUTES);
}

export function mergeSecuritySettings(stored: unknown): SecuritySettings {
  const merged = { ...DEFAULT_SECURITY_SETTINGS, ...((stored as object) ?? {}) };
  return { ...merged, sessionTimeoutMinutes: clampSessionTimeoutMinutes(merged.sessionTimeoutMinutes) };
}

export const DEFAULT_NOTIFICATION_SETTINGS = {
  newLeadAssigned: { email: true, inApp: true },
  dailyDigest: { email: true, inApp: false },
  paymentReceived: { email: true, inApp: true },
  leadIngestionFailures: { email: true, inApp: false },
  trialEndingReminders: { email: true, inApp: false },
  weeklyPerformanceSummary: { email: false, inApp: false },
  followUpReminders: {
    // Morning digest of each person's follow-ups. Off by default — an admin opts the org in.
    enabled: false,
    sendHour: 9, // org-local hour of day: 8, 9 or 10
    reps: true, // who receives it: sales reps (own leads) ...
    managers: true, // ... and managers (their team)
    overdue: true, // what it includes
    today: true,
    email: true,
    inApp: true,
    skipSundays: true,
  },
};

export type NotificationSettings = typeof DEFAULT_NOTIFICATION_SETTINGS;

// Automatic reassignment of already-assigned leads is intentionally not a routing
// feature: once round robin hands a lead to a rep, it stays theirs — no "idle" sweep
// ever takes it back. (Removed 2026-09-08: the sweep's opt-out default silently
// stripped leads mid-pipeline, e.g. DEMO_ATTENDED, from reps who were legitimately
// waiting on the client. See reassignment.processor.ts in git history.)
export const DEFAULT_ROUTING_SETTINGS = {
  autoAssign: true,
  skipWeekends: false,
  alwaysOn: false,
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  sourceRouting: {
    facebookInstagram: '',
    googleAds: '',
    website: '',
    referral: '',
    walkIn: '',
  },
};

export type RoutingSettings = typeof DEFAULT_ROUTING_SETTINGS;

export function mergeNotificationSettings(stored: unknown): NotificationSettings {
  const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...((stored as object) ?? {}) };
  // followUpReminders is a flat options object, so fill any missing option from its defaults.
  return {
    ...merged,
    followUpReminders: { ...DEFAULT_NOTIFICATION_SETTINGS.followUpReminders, ...merged.followUpReminders },
  };
}

export function mergeRoutingSettings(stored: unknown): RoutingSettings {
  return { ...DEFAULT_ROUTING_SETTINGS, ...((stored as object) ?? {}) };
}

// Which of the org's own templates to use for each proactive-reminder purpose — populated from
// Administration > Payments. Null means "not configured yet": WhatsApp falls back to free-form
// text (only deliverable inside Meta's 24h customer-service window) and email to a built-in
// message; see InvoicesService.remindInstallment.
export const DEFAULT_PAYMENT_SETTINGS = {
  emiReminderTemplateId: null as string | null, // an APPROVED WhatsApp template
  emiReminderEmailTemplateId: null as string | null, // an EMAIL template
};

export type PaymentSettings = typeof DEFAULT_PAYMENT_SETTINGS;

export function mergePaymentSettings(stored: unknown): PaymentSettings {
  return { ...DEFAULT_PAYMENT_SETTINGS, ...((stored as object) ?? {}) };
}
