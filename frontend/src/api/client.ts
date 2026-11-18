import axios from "axios";
import type {
  PaginatedResponse,
  Lead,
  LeadFacets,
  User,
  Team,
  TeamType,
  Organization,
  OrgSettings,
  FieldMappingConfig,
  LeadBackfillResult,
  LeadBackfillRequest,
  AuditLogPage,
  TrialStatus,
  Payment,
  RevenueMonth,
  UpcomingInstallment,
  Communication,
  CallLogEntry,
  NurturingSequence,
  NurturingStep,
  NurturingEnrollment,
  ImportResult,
  ImportMapping,
  MessageTemplate,
  TemplateChannel,
  Industry,
  OrgSize,
  WorkspaceType,
  OrgIntegrationInfo,
  IntegrationProvider,
  WebhookInfoDto,
  GoogleWebhookInfoDto,
  WhatsAppWebhookInfoDto,
  RazorpayWebhookInfoDto,
  WhatsAppEmbeddedSignupConfigDto,
  EmailConfigDto,
  SubscriptionPlan,
  OrgSubscription,
  LoginResult,
  BillingEvent,
  BillingInterval,
  AddonType,
  Role,
  MfgRole,
  ImpersonatableUser,
  Invoice,
  InvoiceStatus,
  Course,
  CourseCategory,
  Batch,
  Tutor,
  EmiInstallment,
  RegistrationPaymentMode,
  ReminderChannel,
  PaymentGatewayName,
  PaymentGatewayStatus,
  GoogleFormDto,
  GoogleConnectionDto,
  GooglePickerConfigDto,
  SyncResultDto,
  ConnectGoogleFormInput,
  FormSubmissionDto,
  FormChannel,
} from "../types";

export interface RegisterPayload {
  name: string;
  email: string;
  phone?: string;
  password: string;
  orgName: string;
  workspaceType: WorkspaceType;
  industry?: Industry;
  orgSize: OrgSize;
  website?: string;
  city?: string;
  state?: string;
  country: string;
  timezone: string;
  acceptedTerms: boolean;
  // Plan & payment (Step 3) — omitted or 'trial' behaves exactly as before.
  selectedPlanId?: string;
  billingInterval?: BillingInterval;
  seats?: number;
  couponCode?: string;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
  headers: import.meta.env.VITE_API_BASE_URL?.includes("ngrok")
    ? { "ngrok-skip-browser-warning": "true" }
    : {},
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      // Only force-logout when an authenticated session is rejected (token expired).
      // A 401 from a login attempt (wrong password, unverified email) carries no token —
      // let it propagate so the page can show the error instead of hard-reloading.
      if (localStorage.getItem("token")) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        localStorage.removeItem("originalToken");
        localStorage.removeItem("originalUser");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export default api;

// Auth
export const register = async (payload: RegisterPayload) => {
  // No token here by design for a trial signup — the user must verify their email
  // before they can sign in. A paid signup (selectedPlanId set) instead returns
  // subscriptionId/razorpayKeyId so the caller can open Razorpay checkout, then
  // call confirmRegistrationPayment() below.
  const { data } = await api.post<{
    user: User;
    org: Organization;
    subscriptionId?: string;
    razorpayKeyId?: string;
    billingSetupFailed?: boolean;
  }>("/auth/register", payload);
  return data;
};

export const confirmRegistrationPayment = async (payload: {
  orgId: string;
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
  razorpaySignature: string;
}): Promise<{ token: string; user: User }> => {
  const { data } = await api.post<{ token: string; user: User }>(
    "/auth/register/confirm-payment",
    payload,
  );
  return data;
};

export const checkEmailAvailable = async (email: string): Promise<boolean> => {
  const { data } = await api.get<{ available: boolean }>("/auth/check-email", {
    params: { email },
  });
  return data.available;
};

export const login = async (email: string, password: string): Promise<LoginResult> => {
  const { data } = await api.post<LoginResult>("/auth/login", { email, password });
  return data;
};

// ── Two-factor authentication (TOTP) ────────────────────────────────────────

export const initMfaSetup = async (): Promise<{ setupToken: string; qrCodeDataUrl: string; secret: string }> => {
  const { data } = await api.post<{ setupToken: string; qrCodeDataUrl: string; secret: string }>(
    "/auth/mfa/setup/init",
  );
  return data;
};

export const getMfaSetupInfo = async (
  setupToken: string,
): Promise<{ qrCodeDataUrl: string; secret: string }> => {
  const { data } = await api.get<{ qrCodeDataUrl: string; secret: string }>(
    "/auth/mfa/setup-info",
    { params: { token: setupToken } },
  );
  return data;
};

export const verifyMfaSetup = async (
  setupToken: string,
  code: string,
): Promise<{ enabled: true; token: string; user: User; recoveryCodes: string[] }> => {
  const { data } = await api.post<{ enabled: true; token: string; user: User; recoveryCodes: string[] }>(
    "/auth/mfa/setup/verify",
    { setupToken, code },
  );
  return data;
};

export const verifyMfaChallenge = async (
  challengeToken: string,
  code: string,
): Promise<{ token: string; user: User }> => {
  const { data } = await api.post<{ token: string; user: User }>(
    "/auth/mfa/challenge/verify",
    { challengeToken, code },
  );
  return data;
};

export const disableMfa = async (code: string): Promise<{ disabled: true }> => {
  const { data } = await api.post<{ disabled: true }>("/auth/mfa/disable", { code });
  return data;
};

export const getMe = async (): Promise<User> => {
  const { data } = await api.get<User>("/auth/me");
  return data;
};

export const impersonate = async (
  userId: string,
): Promise<{ token: string; user: User }> => {
  const { data } = await api.post<{ token: string; user: User }>(
    `/auth/impersonate/${userId}`,
  );
  return data;
};

export const exitImpersonation = async (): Promise<void> => {
  await api.post("/auth/impersonate/exit");
};

export const listImpersonatableUsers = async (): Promise<
  ImpersonatableUser[]
> => {
  const { data } = await api.get<ImpersonatableUser[]>(
    "/auth/impersonate/users",
  );
  return data;
};

export const getTrialStatus = async (): Promise<TrialStatus> => {
  const { data } = await api.get<TrialStatus>("/auth/trial");
  return data;
};

export interface CompleteProfilePayload {
  orgName: string;
  workspaceType: WorkspaceType;
  industry?: Industry;
  orgSize: OrgSize;
  website?: string;
  city?: string;
  state?: string;
  country: string;
  timezone: string;
  acceptedTerms: boolean;
}

export const completeProfile = async (
  payload: CompleteProfilePayload,
): Promise<{ token: string }> => {
  const { data } = await api.post<{ token: string }>(
    "/auth/complete-profile",
    payload,
  );
  return data;
};

// Email verification & password reset
export const verifyEmail = async (
  token: string,
): Promise<{ verified: true }> => {
  const { data } = await api.post<{ verified: true }>("/auth/verify-email", {
    token,
  });
  return data;
};

export const resendVerification = async (
  email: string,
): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>(
    "/auth/resend-verification",
    { email },
  );
  return data;
};

export const forgotPassword = async (
  email: string,
): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>(
    "/auth/forgot-password",
    { email },
  );
  return data;
};

export const resetPassword = async (
  token: string,
  password: string,
): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>("/auth/reset-password", {
    token,
    password,
  });
  return data;
};

export const requestMfaReset = async (
  email: string,
): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>(
    "/auth/mfa/reset/request",
    { email },
  );
  return data;
};

export const confirmMfaReset = async (
  token: string,
): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>(
    "/auth/mfa/reset/confirm",
    { token },
  );
  return data;
};

// Forced first-login password change — authenticated; returns a fresh token + user.
export const changePassword = async (
  password: string,
): Promise<{ token: string; user: User }> => {
  const { data } = await api.post<{ token: string; user: User }>(
    "/auth/change-password",
    { password },
  );
  return data;
};

// Leads
export const getLeads = async (
  params?: Record<string, unknown>,
): Promise<PaginatedResponse<Lead>> => {
  const { data } = await api.get<PaginatedResponse<Lead>>("/leads", { params });
  return data;
};

export const getLead = async (id: string): Promise<Lead> => {
  const { data } = await api.get<Lead>(`/leads/${id}`);
  return data;
};

export interface FollowUpLead {
  id: string;
  name: string;
  stage: string;
  followUpAt: string;
  followUpNote: string | null;
  assignedTo: { name: string } | null;
}

export const getFollowUps = async (): Promise<FollowUpLead[]> => {
  const { data } = await api.get<{ data: FollowUpLead[] }>("/leads/follow-ups");
  return data.data;
};

export const getLeadFacets = async (): Promise<LeadFacets> => {
  const { data } = await api.get<LeadFacets>("/leads/facets");
  return data;
};

export const createLead = async (
  payload: Record<string, unknown>,
): Promise<Lead> => {
  const { data } = await api.post<Lead>("/leads", payload);
  return data;
};

export const updateLead = async (
  id: string,
  payload: Record<string, unknown>,
): Promise<Lead> => {
  const { data } = await api.patch<Lead>(`/leads/${id}`, payload);
  return data;
};

export const addNote = async (
  id: string,
  note: string,
  type?: string,
): Promise<void> => {
  await api.post(`/leads/${id}/notes`, { note, type });
};

// Archive (soft-delete) a single lead.
export const archiveLead = async (id: string): Promise<void> => {
  await api.delete(`/leads/${id}`);
};

// Archive (soft-delete) the given leads. Returns how many were archived.
export const archiveLeads = async (
  leadIds: string[],
): Promise<{ archived: number }> => {
  const { data } = await api.post<{ archived: number }>("/leads/archive", {
    leadIds,
  });
  return data;
};

// Archive every lead matching the given list filters (across all pages).
export const archiveAllLeads = async (
  filters?: Record<string, unknown>,
): Promise<{ archived: number }> => {
  const { data } = await api.post<{ archived: number }>(
    "/leads/archive-all",
    null,
    { params: filters },
  );
  return data;
};

export const reassignLead = async (
  id: string,
  userId: string,
): Promise<Lead> => {
  const { data } = await api.patch<Lead>(`/leads/${id}/reassign`, { userId });
  return data;
};

// Distribute the given leads via round robin, each within its own team.
// Returns how many were actually queued (already-assigned / team-less leads are skipped).
export const distributeLeadsRoundRobin = async (
  leadIds: string[],
): Promise<{ queued: number }> => {
  const { data } = await api.post<{ queued: number }>(
    "/assignments/distribute",
    {
      leadIds,
    },
  );
  return data;
};

// One-click round robin: distribute every unassigned lead in the caller's scope.
// Returns how many were queued and how many active sales reps were in scope
// (reps === 0 means there was no one to assign to).
export const autoAssignAllLeads = async (): Promise<{
  queued: number;
  reps: number;
}> => {
  const { data } = await api.post<{ queued: number; reps: number }>(
    "/assignments/distribute-all",
    {},
  );
  return data;
};

export interface RecentLead {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

// New or resubmitted leads since `since` within the caller's scope. Powers the header
// notification badge. `count` is the true total; `leads` is capped server-side.
// `updatedAt` here is sourced from the backend's `activityAt` column (set only on
// genuine resubmission, not on routine edits like a stage change) — not the lead's
// generic last-modified timestamp.
export const getRecentLeads = async (
  since: string,
): Promise<{ count: number; leads: RecentLead[] }> => {
  const { data } = await api.get<{ count: number; leads: RecentLead[] }>(
    "/leads/recent",
    { params: { since } },
  );
  return data;
};

export const getStageStats = async (
  params?: Record<string, unknown>,
): Promise<{ stage: string; _count: { stage: number } }[]> => {
  const { data } = await api.get("/leads/stats/stage", { params });
  return data as { stage: string; _count: { stage: number } }[];
};

export const getSourceStats = async (): Promise<
  { source: string; _count: { source: number } }[]
> => {
  const { data } = await api.get("/leads/stats/source");
  return data as { source: string; _count: { source: number } }[];
};

// Communications
export const sendEmail = async (payload: {
  leadId: string;
  subject: string;
  body: string;
  attachmentIds?: string[];
}): Promise<Communication> => {
  const { data } = await api.post<Communication>(
    "/communications/email",
    payload,
  );
  return data;
};

export const sendSms = async (payload: {
  leadId: string;
  message: string;
}): Promise<Communication> => {
  const { data } = await api.post<Communication>(
    "/communications/sms",
    payload,
  );
  return data;
};

export const sendWhatsApp = async (payload: {
  leadId: string;
  message: string;
  attachmentIds?: string[];
}): Promise<Communication> => {
  const { data } = await api.post<Communication>(
    "/communications/whatsapp",
    payload,
  );
  return data;
};

export const sendWhatsAppTemplate = async (payload: {
  leadId: string;
  templateName: string;
  language: string;
  params: string[];
}): Promise<Communication> => {
  const { data } = await api.post<Communication>(
    "/communications/whatsapp/template",
    payload,
  );
  return data;
};

export const sendCallAlert = async (
  leadId: string,
): Promise<{ delivered: boolean; phone: string }> => {
  const { data } = await api.post<{ delivered: boolean; phone: string }>(
    `/communications/${leadId}/call-alert`,
  );
  return data;
};

export const registerPushToken = async (
  token: string,
): Promise<{ ok: true }> => {
  const { data } = await api.post<{ ok: true }>("/users/me/push-token", {
    token,
  });
  return data;
};

export const logCall = async (payload: {
  leadId: string;
  durationSec: number;
  notes: string;
  outcome?: "CONNECTED" | "NOT_CONNECTED";
  direction?: "inbound" | "outbound";
}): Promise<void> => {
  await api.post("/communications/call", payload);
};

// Feeds the Android call-log sync's on-device number → lead matcher (see native LeadMatcher
// under frontend/android/.../calllog/). Org + role scoped server-side (getPhoneIndex).
export const getLeadPhoneIndex = async (): Promise<
  { leadId: string; name: string; phone: string }[]
> => {
  const { data } = await api.get("/leads/phone-index");
  return data;
};

// Short-lived (15 min) presigned URL to play back a call recording — fetched fresh on
// every play, never cached, since the URL expires.
export const getCallRecordingPlaybackUrl = async (
  recordingId: string,
): Promise<{ url: string }> => {
  const { data } = await api.get<{ url: string }>(
    `/communications/call-recordings/${recordingId}/playback-url`,
  );
  return data;
};

export const initCallRecording = async (dto: {
  leadId: string;
  mimeType: string;
  durationSec?: number;
}): Promise<{ recordingId: string; uploadUrl: string }> => {
  const { data } = await api.post<{ recordingId: string; uploadUrl: string }>(
    "/communications/call-recordings/init",
    dto,
  );
  return data;
};

export const completeCallRecording = async (
  recordingId: string,
  dto: { durationSec: number; fileSize: number },
): Promise<{ id: string; status: string; durationSec: number }> => {
  const { data } = await api.post<{
    id: string;
    status: string;
    durationSec: number;
  }>(`/communications/call-recordings/${recordingId}/complete`, dto);
  return data;
};

export const getAttachmentsMeta = async (
  ids: string[],
): Promise<{ id: string; fileName: string; fileSize: number }[]> => {
  if (ids.length === 0) return [];
  const { data } = await api.get<
    { id: string; fileName: string; fileSize: number }[]
  >("/communications/attachments", { params: { ids: ids.join(",") } });
  return data;
};

export const initAttachment = async (dto: {
  fileName: string;
  mimeType: string;
  fileSize: number;
}): Promise<{ attachmentId: string; uploadUrl: string }> => {
  const { data } = await api.post<{ attachmentId: string; uploadUrl: string }>(
    "/communications/attachments/init",
    dto,
  );
  return data;
};

export const completeAttachment = async (
  attachmentId: string,
): Promise<void> => {
  await api.post(`/communications/attachments/${attachmentId}/complete`);
};

// Short-lived (15 min) presigned URL to download a past attachment — fetched fresh on
// every download, never cached, since the URL expires.
export const getAttachmentUrl = async (
  attachmentId: string,
): Promise<{ url: string }> => {
  const { data } = await api.get<{ url: string }>(
    `/communications/attachments/${attachmentId}/url`,
  );
  return data;
};

export const getCallLog = async (params?: {
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<CallLogEntry>> => {
  const { data } = await api.get<PaginatedResponse<CallLogEntry>>(
    "/communications/call-log",
    { params },
  );
  return data;
};

export const getCommHistory = async (
  leadId: string,
): Promise<Communication[]> => {
  const { data } = await api.get<Communication[]>(
    `/communications/${leadId}/history`,
  );
  return data;
};

// Payments
export const createPayment = async (
  payload: Record<string, unknown>,
): Promise<Payment> => {
  const { data } = await api.post<Payment>("/payments", payload);
  return data;
};

// Manually mark a payment as paid (e.g. cash/UPI collected offline). Fires the invoice.
export const markPaymentPaid = async (paymentId: string): Promise<Payment> => {
  const { data } = await api.patch<Payment>(
    `/payments/${paymentId}/mark-paid`,
    {
      gatewayPaymentId: "manual",
    },
  );
  return data;
};

export const getPaymentsByLead = async (leadId: string): Promise<Payment[]> => {
  const { data } = await api.get<Payment[]>(`/payments/lead/${leadId}`);
  return data;
};

export const getPaymentDashboard = async () => {
  const { data } = await api.get("/payments/dashboard");
  return data;
};

export const getRevenueMonthly = async (
  months = 6,
): Promise<RevenueMonth[]> => {
  const { data } = await api.get<RevenueMonth[]>("/payments/revenue/monthly", {
    params: { months },
  });
  return data;
};

export const getUpcomingInstallments = async (
  days = 14,
): Promise<UpcomingInstallment[]> => {
  const { data } = await api.get<UpcomingInstallment[]>(
    "/payments/upcoming-installments",
    { params: { days } },
  );
  return data;
};

export const getPayments = async (
  query: Record<string, unknown> = {},
): Promise<PaginatedResponse<Payment>> => {
  const { data } = await api.get<PaginatedResponse<Payment>>("/payments", {
    params: query,
  });
  return data;
};

export const getPayment = async (id: string): Promise<Payment> => {
  const { data } = await api.get<Payment>(`/payments/${id}`);
  return data;
};

// Reports
export const getOverview = async () => {
  const { data } = await api.get("/reports/overview");
  return data;
};

export const getPipeline = async (params?: { from?: string; to?: string }) => {
  const { data } = await api.get("/reports/pipeline", { params });
  return data;
};

export interface TeamPerformanceFilter {
  from?: string;
  to?: string;
  teamId?: string;
}

export interface ProductivityRow {
  repId: string;
  repName: string;
  total: number;
  notEngaged: number;
  untouched: number;
  followupOverdue: number;
  leaking: number;
  target: number;
  revenueCollected: number;
  trend: number[];
}

export interface SourcePerfRow {
  source: string;
  total: number;
  enrolled: number;
  conversionRate: number;
}

export interface LeaderboardRow {
  teamId: string;
  teamName: string;
  total: number;
  enrolled: number;
  conversionRate: number;
  target: number;
  revenueCollected: number;
}

export const getProductivity = async (
  filter: TeamPerformanceFilter = {},
): Promise<ProductivityRow[]> => {
  const { data } = await api.get("/reports/productivity", { params: filter });
  return data;
};

export const getSourcePerformance = async (
  filter: TeamPerformanceFilter = {},
): Promise<SourcePerfRow[]> => {
  const { data } = await api.get("/reports/source-performance", {
    params: filter,
  });
  return data;
};

export const getTeamLeaderboard = async (
  filter: TeamPerformanceFilter = {},
): Promise<LeaderboardRow[]> => {
  const { data } = await api.get("/reports/team-leaderboard", {
    params: filter,
  });
  return data;
};

// Daily Sales & Lead Management Report
export interface DailyReportFilter {
  from?: string;
  to?: string;
  teamMemberId?: string;
  campaignId?: string;
  page?: number;
  limit?: number;
}

export interface DailySummary {
  generated: number;
  newLeads: number;
  contacted: number;
  pending: number;
  // Exact UTC instants the counts above were computed against (org-timezone resolved
  // server-side). KPI-tile drill-through links should use these, not the raw `from`/`to`
  // filter strings, so the /leads list they link to always matches this tile's count —
  // leads.service.ts's own date parsing has no org-timezone awareness, so re-deriving the
  // boundary client-side can disagree with this by the org's UTC offset (SCRUM-61).
  rangeFrom?: string;
  rangeTo?: string;
}

export interface StatusReportRow {
  stage: string;
  count: number;
}

export interface EnrollmentReport {
  totalEnrollments: number;
  revenue: number;
  conversionRate: number;
  perRep: {
    repId: string;
    repName: string;
    enrolled: number;
    revenue: number;
    conversionRate: number;
  }[];
}

export interface CampaignPerformanceRow {
  campaignId: string;
  campaignName: string;
  leads: number;
  interested: number;
  followUp: number;
  demoScheduled: number;
  enrollments: number;
  conversionRate: number;
}

export interface AdSetPerformanceRow {
  adSetId: string;
  adSetName: string;
  leads: number;
  interested: number;
  enrollments: number;
  conversionRate: number;
}

export interface AdPerformanceRow {
  adId: string;
  adName: string;
  leads: number;
  interested: number;
  enrollments: number;
  /** null when this ad has never been matched against the connected Facebook ad account
   *  (e.g. it belongs to a different, inaccessible ad account) — impressions/clicks are
   *  unknown, not genuinely zero. */
  ctr: number | null;
  conversionRate: number;
}

export interface CampaignOption {
  id: string;
  name: string;
}

export interface LeadSourceRow {
  leadId: string;
  name: string;
  source: string;
  campaign: string | null;
  adSet: string | null;
  ad: string | null;
  owner: string | null;
  stage: string;
  enrollmentStatus: "enrolled" | "not_enrolled";
}

export interface DailyDashboard {
  totalLeads: number;
  interestedLeads: number;
  followUpLeads: number;
  demoScheduled: number;
  enrollments: number;
  revenue: number;
  avgTicketSize: number;
  totalCalls: number;
  totalCallsDelta: number | null;
  totalLeadsDelta: number | null;
  interestedLeadsDelta: number | null;
  followUpLeadsDelta: number | null;
  demoScheduledDelta: number | null;
  enrollmentsDelta: number | null;
  revenueDelta: number | null;
  campaignPerformance: CampaignPerformanceRow[];
  salesPersonPerformance: EnrollmentReport["perRep"];
}

export const getDailySummary = async (
  filter: DailyReportFilter,
): Promise<DailySummary> => {
  const { data } = await api.get("/reports/daily/summary", { params: filter });
  return data;
};

export const getStatusReport = async (
  filter: DailyReportFilter,
): Promise<StatusReportRow[]> => {
  const { data } = await api.get("/reports/daily/status", { params: filter });
  return data;
};

export const getEnrollmentReport = async (
  filter: DailyReportFilter,
): Promise<EnrollmentReport> => {
  const { data } = await api.get("/reports/daily/enrollment", {
    params: filter,
  });
  return data;
};

export const getCampaignPerformance = async (
  filter: DailyReportFilter,
): Promise<CampaignPerformanceRow[]> => {
  const { data } = await api.get("/reports/daily/campaigns", {
    params: filter,
  });
  return data;
};

export const getAdSetPerformance = async (
  filter: DailyReportFilter,
): Promise<AdSetPerformanceRow[]> => {
  const { data } = await api.get("/reports/daily/adsets", { params: filter });
  return data;
};

export const getAdPerformance = async (
  filter: DailyReportFilter,
): Promise<AdPerformanceRow[]> => {
  const { data } = await api.get("/reports/daily/ads", { params: filter });
  return data;
};

export interface LeadSourceTrackingResult {
  data: LeadSourceRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export const getLeadSourceTracking = async (
  filter: DailyReportFilter,
): Promise<LeadSourceTrackingResult> => {
  const { data } = await api.get("/reports/daily/lead-sources", {
    params: filter,
  });
  return data;
};

export const getDailyDashboard = async (
  filter: DailyReportFilter,
): Promise<DailyDashboard> => {
  const { data } = await api.get("/reports/daily/dashboard", {
    params: filter,
  });
  return data;
};

export const getCampaignOptions = async (): Promise<CampaignOption[]> => {
  const { data } = await api.get("/reports/daily/campaign-options");
  return data;
};

export interface DailyReportExportOptions {
  format: "csv" | "excel" | "pdf";
  includeCharts?: boolean; // pdf only
  includeCover?: boolean; // pdf only
  orientation?: "portrait" | "landscape"; // pdf only
  theme?: "light" | "dark"; // pdf only — matches the app theme active when exporting
  // subset of summary|status|enrollment|campaign|sources|dashboard|adsets|ads
  sections?: string[];
}

export const exportDailyReport = async (
  filter: DailyReportFilter,
  options: DailyReportExportOptions,
): Promise<Blob> => {
  const { format, includeCharts, includeCover, orientation, theme, sections } =
    options;
  const { data } = await api.get("/reports/daily/export", {
    params: {
      ...filter,
      format,
      ...(format === "pdf" && {
        includeCharts,
        includeCover,
        orientation,
        theme,
      }),
      ...(sections?.length && { sections: sections.join(",") }),
    },
    responseType: "blob",
  });
  return data;
};

// Facebook ad account connect + Insights sync (Director/Manager only)
export interface FacebookAdAccount {
  id: string;
  name: string;
  accountStatus: number;
}

export const listFacebookAdAccounts = async (): Promise<
  FacebookAdAccount[]
> => {
  const { data } = await api.get("/integrations/config/facebook/ad-accounts");
  return data;
};

export const connectFacebookAdAccount = async (
  adAccountId: string,
): Promise<{ adAccountName: string }> => {
  const { data } = await api.post("/integrations/config/facebook/ad-account", {
    adAccountId,
  });
  return data;
};

export const syncFacebookInsights = async (): Promise<{ queued: boolean }> => {
  const { data } = await api.post("/facebook-insights/sync");
  return data;
};

// Users
// Id + name (+ role) of everyone in the organisation, for owner / engineer pickers and name lookups.
export interface DirectoryUser {
  id: string;
  name: string;
  role: string;
  mfgRole?: string | null;
}
export const getUserDirectory = async (): Promise<DirectoryUser[]> => {
  const { data } = await api.get<DirectoryUser[]>("/users/directory");
  return data;
};

export const getUsers = async (includeOpenLeads = false): Promise<User[]> => {
  const { data } = await api.get<User[]>("/users", {
    params: includeOpenLeads ? { include: "openLeads" } : undefined,
  });
  return data;
};

export const createUser = async (
  payload: Record<string, unknown>,
): Promise<User> => {
  const { data } = await api.post<User>("/users", payload);
  return data;
};

export const updateMe = async (payload: {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<User & { token?: string }> => {
  const { data } = await api.patch<User & { token?: string }>(
    "/users/me",
    payload,
  );
  return data;
};

export const deleteUser = async (id: string): Promise<void> => {
  await api.delete(`/users/${id}`);
};

export const resetUserMfa = async (id: string): Promise<void> => {
  await api.post(`/users/${id}/mfa/reset`);
};

export const resendInvite = async (id: string): Promise<void> => {
  await api.post(`/users/${id}/resend-invite`);
};

export const getOrgProfile = async (): Promise<Organization> => {
  const { data } = await api.get<Organization>("/organizations/me");
  return data;
};

// Director-only: update the org's own profile (GST number, assignment notification setting, etc).
export const updateOrganization = async (payload: {
  gstNumber?: string | null;
  notifyRepOnAssignment?: boolean;
  name?: string;
  website?: string;
  industry?: Organization["industry"];
  size?: Organization["size"];
  city?: string;
  state?: string;
  timezone?: string;
  email?: string;
  phone?: string;
}): Promise<Organization> => {
  const { data } = await api.patch<Organization>("/organizations/me", payload);
  return data;
};

// Same pattern as getRegistrationScreenshotUploadUrl: the S3 key is built and persisted
// server-side at presign time and never returned to the client.
export const getOrgLogoUploadUrl = async (payload: {
  contentType: string;
}): Promise<{ uploadUrl: string }> => {
  const { data } = await api.post<{ uploadUrl: string }>("/organizations/me/logo/upload-url", payload);
  return data;
};

// Mints a fresh signed URL server-side on every call — never cached.
export const getOrgLogoDownloadUrl = async (): Promise<{ url: string | null }> => {
  const { data } = await api.get<{ url: string | null }>("/organizations/me/logo/download-url");
  return data;
};

export const getOrgSettings = async (): Promise<OrgSettings> => {
  const { data } = await api.get<OrgSettings>("/organizations/me/settings");
  return data;
};

export const updateOrgSettings = async (payload: {
  security?: OrgSettings["security"];
  notifications?: OrgSettings["notifications"];
  routing?: OrgSettings["routing"];
  payments?: OrgSettings["payments"];
}): Promise<OrgSettings> => {
  const { data } = await api.patch<OrgSettings>("/organizations/me/settings", payload);
  return data;
};

export const getFieldMappings = async (): Promise<FieldMappingConfig> => {
  const { data } = await api.get<FieldMappingConfig>("/organizations/me/field-mappings");
  return data;
};

export const updateFieldMappings = async (
  payload: Partial<FieldMappingConfig>,
): Promise<FieldMappingConfig> => {
  const { data } = await api.patch<FieldMappingConfig>("/organizations/me/field-mappings", payload);
  return data;
};

export const backfillLeads = async (payload: LeadBackfillRequest): Promise<LeadBackfillResult> => {
  const { data } = await api.post<LeadBackfillResult>("/lead-backfill", payload);
  return data;
};

export const getAuditLog = async (page: number, pageSize: number): Promise<AuditLogPage> => {
  const { data } = await api.get<AuditLogPage>("/organizations/me/audit-log", {
    params: { page, pageSize },
  });
  return data;
};

export const getApiKey = async (): Promise<{ apiKey: string }> => {
  const { data } = await api.get<{ apiKey: string }>("/organizations/me/api-key");
  return data;
};

export const regenerateApiKey = async (): Promise<{ apiKey: string }> => {
  const { data } = await api.post<{ apiKey: string }>("/organizations/me/api-key/regenerate");
  return data;
};

export const getTeams = async (): Promise<Team[]> => {
  const { data } = await api.get<Team[]>("/users/teams/all");
  return data;
};

export const createTeam = async (body: {
  name: string;
  managerId?: string;
  type?: TeamType;
}): Promise<Team> => {
  const { data } = await api.post<Team>("/users/teams", body);
  return data;
};

export const updateUser = async (
  id: string,
  patch: { role?: Role; mfgRole?: MfgRole | null; teamId?: string | null; monthlyTarget?: number },
): Promise<User> => {
  const { data } = await api.patch<User>(`/users/${id}`, patch);
  return data;
};

export const updateTeam = async (
  id: string,
  patch: { name?: string; managerId?: string | null; type?: TeamType; monthlyTarget?: number },
): Promise<Team> => {
  const { data } = await api.patch<Team>(`/users/teams/${id}`, patch);
  return data;
};

export const deleteTeam = async (id: string): Promise<void> => {
  await api.delete(`/users/teams/${id}`);
};

// Lead Import
export const importLeads = async (
  leads: Record<string, unknown>[],
): Promise<ImportResult> => {
  const { data } = await api.post<ImportResult>("/leads/import", { leads });
  return data;
};

// Nurturing — Sequences
export const getSequences = async (): Promise<NurturingSequence[]> => {
  const { data } = await api.get<NurturingSequence[]>("/nurturing/sequences");
  return data;
};

export const createSequence = async (
  payload: Record<string, unknown>,
): Promise<NurturingSequence> => {
  const { data } = await api.post<NurturingSequence>(
    "/nurturing/sequences",
    payload,
  );
  return data;
};

export const getSequence = async (id: string): Promise<NurturingSequence> => {
  const { data } = await api.get<NurturingSequence>(
    `/nurturing/sequences/${id}`,
  );
  return data;
};

export const updateSequence = async (
  id: string,
  payload: Record<string, unknown>,
): Promise<NurturingSequence> => {
  const { data } = await api.patch<NurturingSequence>(
    `/nurturing/sequences/${id}`,
    payload,
  );
  return data;
};

export const deleteSequence = async (id: string): Promise<void> => {
  await api.delete(`/nurturing/sequences/${id}`);
};

// Nurturing — Steps
export const addStep = async (
  sequenceId: string,
  payload: Record<string, unknown>,
): Promise<NurturingStep> => {
  const { data } = await api.post<NurturingStep>(
    `/nurturing/sequences/${sequenceId}/steps`,
    payload,
  );
  return data;
};

export const updateStep = async (
  stepId: string,
  payload: Record<string, unknown>,
): Promise<NurturingStep> => {
  const { data } = await api.patch<NurturingStep>(
    `/nurturing/steps/${stepId}`,
    payload,
  );
  return data;
};

export const deleteStep = async (stepId: string): Promise<void> => {
  await api.delete(`/nurturing/steps/${stepId}`);
};

// Nurturing — Enrollments
export const enrollLead = async (
  sequenceId: string,
  leadId: string,
): Promise<NurturingEnrollment> => {
  const { data } = await api.post<NurturingEnrollment>(
    `/nurturing/sequences/${sequenceId}/enroll`,
    { leadId },
  );
  return data;
};

export const getSequenceEnrollments = async (
  sequenceId: string,
  page: number,
  limit = 20,
): Promise<PaginatedResponse<NurturingEnrollment>> => {
  const { data } = await api.get<PaginatedResponse<NurturingEnrollment>>(
    `/nurturing/sequences/${sequenceId}/enrollments`,
    { params: { page, limit } },
  );
  return data;
};

export const removeEnrollment = async (enrollmentId: string): Promise<void> => {
  await api.delete(`/nurturing/enrollments/${enrollmentId}`);
};

// Templates (email + WhatsApp)
export const getTemplates = async (
  channel?: TemplateChannel,
): Promise<MessageTemplate[]> => {
  const { data } = await api.get<MessageTemplate[]>("/templates", {
    params: channel ? { channel } : undefined,
  });
  return data;
};

export const createTemplate = async (
  payload: Record<string, unknown>,
): Promise<MessageTemplate> => {
  const { data } = await api.post<MessageTemplate>("/templates", payload);
  return data;
};

export const updateTemplate = async (
  id: string,
  payload: Record<string, unknown>,
): Promise<MessageTemplate> => {
  const { data } = await api.patch<MessageTemplate>(
    `/templates/${id}`,
    payload,
  );
  return data;
};

export const deleteTemplate = async (id: string): Promise<void> => {
  await api.delete(`/templates/${id}`);
};

export const copyTemplate = async (id: string): Promise<MessageTemplate> => {
  const { data } = await api.post<MessageTemplate>(`/templates/${id}/copy`, {});
  return data;
};

// (Re)submit a DRAFT/REJECTED WhatsApp template to Meta for approval.
export const submitTemplate = async (id: string): Promise<MessageTemplate> => {
  const { data } = await api.post<MessageTemplate>(
    `/templates/${id}/submit`,
    {},
  );
  return data;
};

// Pull the latest WhatsApp approval statuses from Meta; returns the refreshed WhatsApp list.
export const refreshWhatsappTemplates = async (): Promise<
  MessageTemplate[]
> => {
  const { data } = await api.post<MessageTemplate[]>(
    "/templates/whatsapp/refresh",
    {},
  );
  return data;
};

// Import Mappings
export const getImportMappings = async (): Promise<ImportMapping[]> => {
  const { data } = await api.get<ImportMapping[]>("/import-mappings");
  return data;
};

export const createImportMapping = async (payload: {
  name: string;
  mappings: Record<string, string>;
}): Promise<ImportMapping> => {
  const { data } = await api.post<ImportMapping>("/import-mappings", payload);
  return data;
};

export const updateImportMapping = async (
  id: string,
  payload: { name?: string; mappings?: Record<string, string> },
): Promise<ImportMapping> => {
  const { data } = await api.patch<ImportMapping>(
    `/import-mappings/${id}`,
    payload,
  );
  return data;
};

export const deleteImportMapping = async (id: string): Promise<void> => {
  await api.delete(`/import-mappings/${id}`);
};

// Integration Config
export const getIntegrationStatuses = async (): Promise<
  OrgIntegrationInfo[]
> => {
  const { data } = await api.get<OrgIntegrationInfo[]>("/integrations/config");
  return data;
};

export const initFacebookOAuth = async (): Promise<{ url: string }> => {
  const { data } = await api.post<{ url: string }>(
    "/integrations/config/facebook/oauth/init",
  );
  return data;
};

export const initGoogleOAuth = async (): Promise<{ url: string }> => {
  const { data } = await api.post<{ url: string }>(
    "/integrations/config/google/oauth/init",
  );
  return data;
};

export const disconnectIntegration = async (
  provider: IntegrationProvider,
): Promise<void> => {
  await api.delete(`/integrations/config/${provider}`);
};

export const manualBackfillFacebook = async (since: string): Promise<void> => {
  await api.post("/integrations/config/facebook/backfill", { since });
};

export const getWebhookInfo = async (): Promise<WebhookInfoDto> => {
  const { data } = await api.get<WebhookInfoDto>(
    "/integrations/config/webhook/info",
  );
  return data;
};

export const getGoogleForms = async (): Promise<GoogleFormDto[]> => {
  const { data } = await api.get<GoogleFormDto[]>("/google-forms");
  return data;
};

export const connectGoogleForm = async (dto: ConnectGoogleFormInput): Promise<GoogleFormDto> => {
  const { data } = await api.post<GoogleFormDto>("/google-forms", dto);
  return data;
};

export const deleteGoogleForm = async (id: string): Promise<void> => {
  await api.delete(`/google-forms/${id}`);
};

export const updateGoogleForm = async (
  id: string,
  dto: Partial<{ name: string; isActive: boolean }>,
): Promise<GoogleFormDto> => {
  const { data } = await api.patch<GoogleFormDto>(`/google-forms/${id}`, dto);
  return data;
};

export const syncGoogleForm = async (id: string): Promise<SyncResultDto> => {
  const { data } = await api.post<SyncResultDto>(`/google-forms/${id}/sync`);
  return data;
};

export const getGoogleConnection = async (): Promise<GoogleConnectionDto> => {
  const { data } = await api.get<GoogleConnectionDto>("/google-forms/connection");
  return data;
};

export const initGoogleFormsConnection = async (): Promise<{ url: string }> => {
  const { data } = await api.post<{ url: string }>("/google-forms/connection/init");
  return data;
};

// Called by the frontend OAuth callback page with the code/state Google redirected back with.
export const completeGoogleConnection = async (
  code: string,
  state: string,
): Promise<{ accountName: string | null }> => {
  const { data } = await api.post<{ accountName: string | null }>("/google-forms/connection/complete", {
    code,
    state,
  });
  return data;
};

export const disconnectGoogleForms = async (): Promise<void> => {
  await api.delete("/google-forms/connection");
};

export const getGooglePickerConfig = async (): Promise<GooglePickerConfigDto> => {
  const { data } = await api.get<GooglePickerConfigDto>("/google-forms/picker-token");
  return data;
};

export const sendGoogleForm = async (
  leadId: string,
  dto: { formId: string; channel: FormChannel },
): Promise<{ link: string; sent: boolean }> => {
  const { data } = await api.post<{ link: string; sent: boolean }>(
    `/google-forms/send/${leadId}`,
    dto,
  );
  return data;
};

export const getFormSubmissions = async (query: {
  leadId?: string;
  formId?: string;
}): Promise<FormSubmissionDto[]> => {
  const { data } = await api.get<FormSubmissionDto[]>(
    "/google-forms/submissions",
    { params: query },
  );
  return data;
};

export const regenerateWebhookSecret = async (): Promise<WebhookInfoDto> => {
  const { data } = await api.post<WebhookInfoDto>(
    "/integrations/config/webhook/regenerate-secret",
  );
  return data;
};

export const getGoogleWebhookInfo = async (): Promise<GoogleWebhookInfoDto> => {
  const { data } = await api.get<GoogleWebhookInfoDto>(
    "/integrations/config/google/webhook/info",
  );
  return data;
};

export const regenerateGoogleWebhookKey =
  async (): Promise<GoogleWebhookInfoDto> => {
    const { data } = await api.post<GoogleWebhookInfoDto>(
      "/integrations/config/google/webhook/regenerate-key",
    );
    return data;
  };

export const connectWhatsApp = async (dto: {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  businessAccountId: string;
}): Promise<{ accountName: string; webhookUrl: string; verifyToken: string }> => {
  const { data } = await api.post<{ accountName: string; webhookUrl: string; verifyToken: string }>(
    "/integrations/config/whatsapp/connect",
    dto,
  );
  return data;
};

export const getWhatsAppWebhookInfo = async (): Promise<WhatsAppWebhookInfoDto> => {
  const { data } = await api.get<WhatsAppWebhookInfoDto>(
    "/integrations/config/whatsapp/webhook-info",
  );
  return data;
};

export const regenerateWhatsAppVerifyToken = async (): Promise<WhatsAppWebhookInfoDto> => {
  const { data } = await api.post<WhatsAppWebhookInfoDto>(
    "/integrations/config/whatsapp/regenerate-verify-token",
  );
  return data;
};

export const getWhatsAppEmbeddedSignupConfig = async (): Promise<WhatsAppEmbeddedSignupConfigDto> => {
  const { data } = await api.get<WhatsAppEmbeddedSignupConfigDto>(
    "/integrations/config/whatsapp/embedded-signup/config",
  );
  return data;
};

export const completeWhatsAppEmbeddedSignup = async (dto: {
  code: string;
  phoneNumberId: string;
  wabaId: string;
}): Promise<{ accountName: string }> => {
  const { data } = await api.post<{ accountName: string }>(
    "/integrations/config/whatsapp/embedded-signup/complete",
    dto,
  );
  return data;
};

export const getEmailConfig = async (): Promise<EmailConfigDto> => {
  const { data } = await api.get<EmailConfigDto>("/integrations/config/email/config");
  return data;
};

export const connectEmailSmtp = async (dto: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}): Promise<{ fromEmail: string }> => {
  const { data } = await api.post<{ fromEmail: string }>("/integrations/config/email/smtp", dto);
  return data;
};

export const connectEmailSesDomain = async (dto: {
  domain: string;
  fromEmail: string;
  fromName: string;
}): Promise<{ domain: string; dnsRecords: EmailConfigDto["dnsRecords"] }> => {
  const { data } = await api.post<{ domain: string; dnsRecords: EmailConfigDto["dnsRecords"] }>(
    "/integrations/config/email/ses-domain",
    dto,
  );
  return data;
};

export const checkEmailDomainStatus = async (): Promise<EmailConfigDto> => {
  const { data } = await api.post<EmailConfigDto>("/integrations/config/email/check-status");
  return data;
};

export const connectTradeIndia = async (dto: { apiLink: string }): Promise<{ saved: true }> => {
  const { data } = await api.post<{ saved: true }>("/integrations/config/tradeindia/connect", dto);
  return data;
};

export const connectCashfree = async (dto: {
  appId: string;
  secretKey: string;
}): Promise<{ appId: string }> => {
  const { data } = await api.post<{ appId: string }>("/integrations/config/cashfree/connect", dto);
  return data;
};

export const connectRazorpay = async (dto: {
  keyId: string;
  keySecret: string;
}): Promise<{ keyId: string }> => {
  const { data } = await api.post<{ keyId: string }>("/integrations/config/razorpay/connect", dto);
  return data;
};

export const getRazorpayWebhookInfo = async (): Promise<RazorpayWebhookInfoDto> => {
  const { data } = await api.get<RazorpayWebhookInfoDto>("/integrations/config/razorpay/webhook-info");
  return data;
};

export const regenerateRazorpayWebhookSecret = async (): Promise<RazorpayWebhookInfoDto> => {
  const { data } = await api.post<RazorpayWebhookInfoDto>(
    "/integrations/config/razorpay/regenerate-webhook-secret",
  );
  return data;
};

// ─── Billing ─────────────────────────────────────────────────────────────────

export const getBillingPlans = async (): Promise<SubscriptionPlan[]> => {
  const { data } = await api.get<SubscriptionPlan[]>("/billing/plans");
  return data;
};

export interface CouponDetails {
  code: string;
  discountType: "PERCENT" | "FLAT";
  discountValue: number;
  label: string;
}

// Public — no session exists yet during registration.
export const validateCoupon = async (
  code: string,
  planId?: string,
): Promise<CouponDetails> => {
  const { data } = await api.post<CouponDetails>("/billing/coupons/validate", {
    code,
    planId,
  });
  return data;
};

export const createSubscription = async (payload: {
  planId: string;
  userCount: number;
  billingInterval: BillingInterval;
  couponCode?: string;
  paymentMethod?: "card" | "upi";
}): Promise<{ subscriptionId: string; razorpayKeyId: string }> => {
  const { data } = await api.post<{
    subscriptionId: string;
    razorpayKeyId: string;
  }>("/billing/subscribe", payload);
  return data;
};

export const getSubscription = async (): Promise<OrgSubscription | null> => {
  const { data } = await api.get<OrgSubscription | null>(
    "/billing/subscription",
  );
  return data;
};

export const getActiveUserCount = async (): Promise<number> => {
  const { data } = await api.get<{ count: number }>("/billing/active-users");
  return data.count;
};

export type SeatUpdateCheckoutResult =
  | { requiresPayment: false; subscription: OrgSubscription }
  | {
      requiresPayment: true;
      orderId: string;
      amount: number;
      razorpayKeyId: string;
      additionalSeats: number;
      remainingDays: number;
    };

export const checkoutSeatUpdate = async (
  userCount: number,
): Promise<SeatUpdateCheckoutResult> => {
  const { data } = await api.post<SeatUpdateCheckoutResult>(
    "/billing/subscription/seats/checkout",
    { userCount },
  );
  return data;
};

export const confirmSeatUpdate = async (payload: {
  userCount: number;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<OrgSubscription> => {
  const { data } = await api.post<OrgSubscription>(
    "/billing/subscription/seats/confirm",
    payload,
  );
  return data;
};

export const cancelSubscription = async (): Promise<OrgSubscription> => {
  const { data } = await api.post<OrgSubscription>(
    "/billing/subscription/cancel",
  );
  return data;
};

export const confirmSubscriptionPayment = async (payload: {
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
}): Promise<{ status: "activated" | "already_active" }> => {
  const { data } = await api.post<{ status: "activated" | "already_active" }>(
    "/billing/subscription/confirm",
    payload,
  );
  return data;
};

export const purchaseAddon = async (payload: {
  type: AddonType;
  quantity: number;
}): Promise<{
  paymentLink: string;
  totalPrice: number;
  totalCredits: number;
}> => {
  const { data } = await api.post<{
    paymentLink: string;
    totalPrice: number;
    totalCredits: number;
  }>("/billing/addon", payload);
  return data;
};

export const getBillingInvoices = async (): Promise<BillingEvent[]> => {
  const { data } = await api.get<BillingEvent[]>("/billing/invoices");
  return data;
};

// Invoices
export const getInvoices = async (
  query: Record<string, unknown> = {},
): Promise<PaginatedResponse<Invoice>> => {
  const { data } = await api.get<PaginatedResponse<Invoice>>("/invoices", {
    params: query,
  });
  return data;
};

export const getInvoice = async (id: string): Promise<Invoice> => {
  const { data } = await api.get<Invoice>(`/invoices/${id}`);
  return data;
};

export const getNextInvoiceNumber = async (): Promise<{
  invoiceNumber: string;
}> => {
  const { data } = await api.get<{ invoiceNumber: string }>(
    "/invoices/next-number",
  );
  return data;
};

export const createInvoice = async (
  payload: Record<string, unknown>,
): Promise<Invoice> => {
  const { data } = await api.post<Invoice>("/invoices", payload);
  return data;
};

export const updateInvoice = async (
  id: string,
  payload: Record<string, unknown>,
): Promise<Invoice> => {
  const { data } = await api.patch<Invoice>(`/invoices/${id}`, payload);
  return data;
};

export const updateInvoiceStatus = async (
  id: string,
  status: InvoiceStatus,
): Promise<Invoice> => {
  const { data } = await api.patch<Invoice>(`/invoices/${id}/status`, {
    status,
  });
  return data;
};

export const deleteInvoice = async (id: string): Promise<void> => {
  await api.delete(`/invoices/${id}`);
};

export const sendInvoice = async (
  id: string,
  payload: { attachPaymentLink: boolean; gateway?: PaymentGatewayName },
): Promise<Invoice> => {
  const { data } = await api.post<Invoice>(`/invoices/${id}/send`, payload);
  return data;
};

export const generateInvoiceFromRegistration = async (
  payload: Record<string, unknown>,
): Promise<Invoice> => {
  const { data } = await api.post<Invoice>(
    "/invoices/generate-from-registration",
    payload,
  );
  return data;
};

// No screenshot key in the payload: the backend writes it itself when the upload URL is
// presigned, and ignores anything the client sends.
export const recordRegistrationPayment = async (
  id: string,
  payload: { amount: number; mode: RegistrationPaymentMode; note?: string },
): Promise<Invoice> => {
  const { data } = await api.post<Invoice>(
    `/invoices/${id}/registration-payment`,
    payload,
  );
  return data;
};

export const sendRegistrationPaymentLink = async (
  id: string,
  payload: Record<string, unknown>,
): Promise<unknown> => {
  const { data } = await api.post(
    `/invoices/${id}/registration-payment/send-link`,
    payload,
  );
  return data;
};

export const markRegistrationFeePaid = async (id: string): Promise<Invoice> => {
  const { data } = await api.post<Invoice>(`/invoices/${id}/registration-payment/mark-paid`);
  return data;
};

// The S3 key is built and persisted server-side at presign time and is never returned to
// the client (a client-supplied key would let a caller attach another tenant's object to
// their own invoice) — uploading to `uploadUrl` is all that's needed.
export const getRegistrationScreenshotUploadUrl = async (payload: {
  invoiceId: string;
  contentType: string;
}): Promise<{ uploadUrl: string }> => {
  const { data } = await api.post<{ uploadUrl: string }>(
    "/invoices/registration-screenshot/presign",
    payload,
  );
  return data;
};

export const getRegistrationScreenshotUrl = async (
  id: string,
): Promise<{ url: string }> => {
  const { data } = await api.get<{ url: string }>(
    `/invoices/${id}/registration-payment/screenshot-url`,
  );
  return data;
};

export const createEmiPlan = async (
  id: string,
  payload: {
    tenureMonths: number;
    startDate: string;
    negotiatedAmount?: number;
  },
): Promise<EmiInstallment[]> => {
  const { data } = await api.post<EmiInstallment[]>(
    `/invoices/${id}/emi-plan`,
    payload,
  );
  return data;
};

export const createEmiMandate = async (
  id: string,
  dto: { tenureMonths: number; startDate: string; negotiatedAmount?: number; gateway?: PaymentGatewayName },
): Promise<EmiInstallment[]> => {
  const { data } = await api.post<EmiInstallment[]>(`/invoices/${id}/emi-mandate`, dto);
  return data;
};

export const remindEmiInstallment = async (
  id: string,
  n: number,
  channel: ReminderChannel,
): Promise<void> => {
  await api.post(`/invoices/${id}/emi-installments/${n}/remind`, { channel });
};

export const markEmiInstallmentPaid = async (
  id: string,
  n: number,
): Promise<EmiInstallment> => {
  const { data } = await api.patch<EmiInstallment>(
    `/invoices/${id}/emi-installments/${n}`,
  );
  return data;
};

// GET /invoices/:id/pdf streams the PDF binary (Content-Disposition: attachment) behind
// JwtAuthGuard — not a presigned storage URL, so a bare `<a href>` can't carry the auth
// token (see getCallRecordingPlaybackUrl / getRegistrationScreenshotUrl for the presigned-URL
// precedent used elsewhere; this endpoint has no such precedent). Fetch as a blob instead,
// mirroring exportDailyReport's `responseType: "blob"` pattern; the caller (Task 9) turns
// the result into a download via `URL.createObjectURL`.
export const getInvoicePdf = async (id: string): Promise<Blob> => {
  const { data } = await api.get(`/invoices/${id}/pdf`, {
    responseType: "blob",
  });
  return data;
};

// Courses
export const getCourses = async (includeArchived = false): Promise<Course[]> => {
  const { data } = await api.get<Course[]>("/courses", {
    params: includeArchived ? { includeArchived: true } : undefined,
  });
  return data;
};

export const createCourse = async (payload: {
  name: string;
  defaultPrice: number;
  category?: CourseCategory;
}): Promise<Course> => {
  const { data } = await api.post<Course>("/courses", payload);
  return data;
};

export const updateCourse = async (
  id: string,
  payload: { name?: string; category?: CourseCategory; defaultPrice?: number; isActive?: boolean },
): Promise<Course> => {
  const { data } = await api.patch<Course>(`/courses/${id}`, payload);
  return data;
};

export const deleteCourse = async (id: string): Promise<void> => {
  await api.delete(`/courses/${id}`);
};

export const addBatch = async (
  courseId: string,
  payload: {
    label: string;
    schedule: string;
    tutorId?: string;
    capacity: number;
  },
): Promise<Batch> => {
  const { data } = await api.post<Batch>(
    `/courses/${courseId}/batches`,
    payload,
  );
  return data;
};

export const removeBatch = async (
  courseId: string,
  batchId: string,
): Promise<void> => {
  await api.delete(`/courses/${courseId}/batches/${batchId}`);
};

export const getTutors = async (includeArchived = false): Promise<Tutor[]> => {
  const { data } = await api.get<Tutor[]>("/tutors", {
    params: { includeArchived },
  });
  return data;
};

export const createTutor = async (payload: {
  name: string;
}): Promise<Tutor> => {
  const { data } = await api.post<Tutor>("/tutors", payload);
  return data;
};

export const updateTutor = async (
  id: string,
  payload: { isActive?: boolean },
): Promise<Tutor> => {
  const { data } = await api.patch<Tutor>(`/tutors/${id}`, payload);
  return data;
};

// Payment gateways
export const getConnectedPaymentGateways = async (): Promise<
  PaymentGatewayStatus[]
> => {
  const { data } = await api.get<PaymentGatewayStatus[]>(
    "/integrations/payment-gateways",
  );
  return data;
};
