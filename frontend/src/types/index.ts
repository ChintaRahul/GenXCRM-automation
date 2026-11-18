export type Role = "DIRECTOR" | "MANAGER" | "SALES_REP";

// Manufacturing-workspace-only granular role — see backend's MfgRole enum and
// Administration > Roles & Permissions, which keys its RolePermission matrix off this.
export type MfgRole =
  | "SUPER_ADMIN"
  | "DIRECTOR"
  | "SALES_HEAD"
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE"
  | "APPLICATION_ENGINEER"
  | "COMMERCIAL_ESTIMATION"
  | "OPERATIONS"
  | "ACCOUNTS"
  | "SERVICE_MANAGER"
  | "SERVICE_ENGINEER";

export type IntegrationProvider = "FACEBOOK" | "GOOGLE_ADS" | "WEBHOOK" | "WHATSAPP" | "EMAIL" | "RAZORPAY" | "GOOGLE_FORMS" | "CASHFREE" | "TRADEINDIA";
export type IntegrationStatus = "CONNECTED" | "DISCONNECTED" | "ERROR" | "PENDING";

export interface OrgIntegrationInfo {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountName?: string | null;
  maskedAccountId?: string | null;
  webhookUrl?: string | null;
  maskedSecret?: string | null;
  tokenExpiry?: string | null;
  adAccountName?: string | null;
  lastSyncedAt?: string | null;
  lastBackfillAt?: string | null;
  lastBackfillLeadsCount?: number | null;
  connectMethod?: "EMBEDDED_SIGNUP" | "MANUAL" | null;
}

export interface WebhookInfoDto {
  webhookUrl: string;
  webhookSecret: string | null;
}

export interface GoogleWebhookInfoDto {
  webhookUrl: string;
  webhookKey: string;
}

export interface WhatsAppWebhookInfoDto {
  webhookUrl: string;
  verifyToken: string;
}

export interface RazorpayWebhookInfoDto {
  webhookUrl: string;
  webhookSecret: string;
}

export interface WhatsAppEmbeddedSignupConfigDto {
  appId: string;
  configId: string;
}

export interface DnsRecordDto {
  type: string;
  name: string;
  value: string;
}

export interface EmailConfigDto {
  method: "SMTP" | "SES_DOMAIN" | null;
  status: IntegrationStatus;
  fromEmail?: string | null;
  fromName?: string | null;
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  maskedUsername?: string | null;
  domain?: string | null;
  dnsRecords?: DnsRecordDto[];
}

export type Industry =
  | "EDTECH"
  | "REAL_ESTATE"
  | "HEALTHCARE"
  | "FINANCIAL_SERVICES"
  | "ECOMMERCE"
  | "SAAS_TECHNOLOGY"
  | "CONSULTING"
  | "MANUFACTURING"
  | "HOSPITALITY"
  | "OTHER";

export type OrgSize = "MICRO" | "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE";

export type WorkspaceType = "EDTECH" | "MANUFACTURING";

export type PlanStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: Industry;
  workspaceType: WorkspaceType;
  size: OrgSize;
  website?: string;
  // True for GenXCRM's own org (its leads are CRM prospects) — set by /auth/me only.
  isPlatformOrg?: boolean;
  city?: string;
  state?: string;
  country: string;
  timezone: string;
  gstNumber?: string | null;
  notifyRepOnAssignment?: boolean;
  planStatus: PlanStatus;
  trialEndsAt: string;
  email?: string | null;
  phone?: string | null;
}

export type SsoProvider = "NONE" | "GOOGLE_WORKSPACE" | "MICROSOFT_ENTRA" | "OKTA_SAML";

export interface SecuritySettings {
  passwordMinLength: number;
  sessionTimeoutMinutes: number;
  requireNumber: boolean;
  requireSymbol: boolean;
  mfaEnabled: boolean;
  mfaEnforced: boolean;
  ssoProvider: SsoProvider;
  ssoConnected: boolean;
}

export interface NotificationToggle {
  email: boolean;
  inApp: boolean;
}

export interface FollowUpReminderSettings {
  enabled: boolean;
  sendHour: number;
  reps: boolean;
  managers: boolean;
  overdue: boolean;
  today: boolean;
  email: boolean;
  inApp: boolean;
  skipSundays: boolean;
}

export interface NotificationSettings {
  newLeadAssigned: NotificationToggle;
  dailyDigest: NotificationToggle;
  paymentReceived: NotificationToggle;
  leadIngestionFailures: NotificationToggle;
  trialEndingReminders: NotificationToggle;
  weeklyPerformanceSummary: NotificationToggle;
  followUpReminders: FollowUpReminderSettings;
}

export interface RoutingSettings {
  autoAssign: boolean;
  skipWeekends: boolean;
  alwaysOn: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  sourceRouting: {
    facebookInstagram: string;
    googleAds: string;
    website: string;
    referral: string;
    walkIn: string;
  };
}

export interface PaymentSettings {
  emiReminderTemplateId: string | null; // approved WhatsApp template
  emiReminderEmailTemplateId: string | null; // email template
}

export interface OrgSettings {
  security: SecuritySettings;
  notifications: NotificationSettings;
  routing: RoutingSettings;
  payments: PaymentSettings;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  aliases: string;
}

export interface FieldMappingConfig {
  coreFieldAliases: Record<string, string>;
  customFieldDefs: CustomFieldDef[];
  fieldOrder?: string[];
  detectedFields: string[];
}

export interface LeadBackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
}

export interface LeadBackfillRequest {
  sources: LeadSource[];
  fields: string[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  userName: string;
  time: string;
  ipAddress: string | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrialStatus {
  planStatus: PlanStatus;
  trialEndsAt: string;
  daysRemaining: number;
  isExpired: boolean;
  limits: { leads: number; users: number; sequences: number; teams: number };
  usage: { leads: number; users: number; sequences: number; teams: number };
}

export type LeadSource =
  | "FACEBOOK"
  | "GOOGLE_ADS"
  | "WEBSITE"
  | "INSTAGRAM"
  | "WALK_IN"
  | "REFERRAL"
  | "OUTBOUND_CALL"
  | "CHAT"
  | "API"
  | "OTHER";
export type LeadStage =
  | "NEW"
  | "CONTACTED"
  | "INTERESTED"
  | "RINGING_NOT_REACHABLE"
  | "FOLLOW_UP_REQUIRED"
  | "CALL_BACK"
  | "CALL_NOT_RECEIVED"
  | "SWITCHED_OFF"
  | "WHATSAPP_SENT"
  | "DEMO_SCHEDULED"
  | "DEMO_ATTENDED"
  | "NEGOTIATION"
  | "ENROLLMENT_PENDING"
  | "ENROLLED"
  | "NOT_INTERESTED"
  | "DROPPED"
  | "CLOSED_WON"
  | "CLOSED_LOST";
export type CommType = "EMAIL" | "SMS" | "WHATSAPP" | "CALL" | "NOTE" | "DEMO";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  mfgRole?: MfgRole | null;
  teamId: string | null;
  team?: { id: string; name: string };
  orgId?: string | null;
  org?: Organization;
  openLeads?: number;
  mustChangePassword?: boolean;
  monthlyTarget?: number;
  // Whether this user has completed TOTP enrollment — distinct from the
  // org-level securitySettings.mfaEnabled policy flag.
  mfaConfigured?: boolean;
  // True until this invited member sets their own password via the invite link.
  pending?: boolean;
}

// POST /auth/login's response is a discriminated union: a normal session, or a
// detour when MFA is involved (already enrolled -> challenge; org enforces it
// and the user hasn't enrolled yet -> forced setup).
export type LoginResult =
  | { token: string; user: User }
  | { mfaRequired: true; challengeToken: string }
  | { mustSetupMfa: true; setupToken: string; qrCodeDataUrl: string; secret: string };

// A user returned by the system-wide impersonation picker (not org-scoped).
export interface ImpersonatableUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: { id: string; name: string } | null;
}

export type TeamType = "MEMBER" | "MANAGER";

export interface Team {
  id: string;
  name: string;
  type: TeamType;
  managerId: string | null;
  manager: { id: string; name: string } | null;
  members: { id: string; name: string; role: Role }[];
  orgId: string;
  createdAt: string;
  monthlyTarget?: number;
}

export interface AssignmentChain {
  owner: { id: string; name: string; role?: string } | null;
  manager: { id: string; name: string } | null;
  director: { id: string; name: string } | null;
}

export interface CallRecording {
  id: string;
  durationSec?: number;
  recordedAt: string;
  mimeType?: string;
  // No raw URL is ever included (CLAUDE.md rule 6: never return raw storage URLs) — fetch a
  // short-lived signed playback URL on demand via getCallRecordingPlaybackUrl(id).
}

export interface Lead {
  id: string;
  name: string;
  email?: string;
  altEmail?: string;
  phone: string;
  altPhone?: string;
  course?: string;
  location?: string;
  language?: string;
  source: LeadSource;
  sourceCampaign?: string;
  sourceAdSet?: string;
  sourceAd?: string;
  campaign?: { name: string };
  adSet?: { name: string };
  ad?: { name: string };
  stage: LeadStage;
  score: number;
  interestedCount: number;
  tags: string[];
  notInterestedReason?: string;
  followUpAt?: string | null;
  followUpNote?: string | null;
  customFields?: Record<string, string>;
  assignedTo?: { id: string; name: string };
  team?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  _count?: { activities: number; communications: number };
  activities?: Activity[];
  communications?: Communication[];
  payments?: Payment[];
  callRecordings?: CallRecording[];
  enrollments?: NurturingEnrollment[];
  assignmentChain?: AssignmentChain;
  // True once a WhatsApp template has actually reached this lead. Meta only allows a
  // free-form (non-template) WhatsApp send within 24h of the lead's last inbound reply;
  // since that can't be tracked, a template having gone out is used as the safe proxy —
  // free-form stays disabled in the Composer until this is true.
  whatsappConversationOpen?: boolean;
}

export interface LeadFacets {
  stages: { value: LeadStage; count: number }[];
  sources: { value: LeadSource; count: number }[];
  courses: string[];
  cities: string[];
}

export interface Activity {
  id: string;
  type: string;
  note?: string;
  createdAt: string;
  user: { name: string };
}

export interface Communication {
  id: string;
  type: CommType;
  subject?: string;
  body?: string;
  status: string;
  sentAt: string;
  attachmentIds?: string[] | null;
  metadata?: { error?: string } | null;
}

export interface CallLogEntry {
  id: string;
  direction: string;
  status: string;
  durationSec: number | null;
  callOutcome: "CONNECTED" | "NOT_CONNECTED" | null;
  sentAt: string;
  lead: { id: string; name: string; phone: string };
  callRecording: {
    id: string;
    status: "PENDING" | "UPLOADED" | "FAILED";
  } | null;
}

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  paymentLink?: string;
  gatewayOrderId?: string | null;
  paidAt?: string;
  dueDate?: string;
  createdAt?: string;
  includeGstNumber?: boolean;
  installments: Installment[];
  lead?: { id: string; name: string; course?: string | null };
}

export interface Installment {
  id: string;
  amount: number;
  dueDate: string;
  status: string;
}

export interface RevenueMonth {
  month: string;
  revenue: number;
  isCurrent: boolean;
}

export interface UpcomingInstallment {
  id: string;
  paymentId: string;
  amount: number;
  dueDate: string;
  lead: { id: string; name: string; course?: string | null };
  emiNumber: number;
  totalEmis: number;
}

export interface PaymentGatewaySplit {
  gateway: string;
  total: number;
  pct: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface NurturingSequence {
  id: string;
  name: string;
  description?: string;
  triggerEvent: string;
  triggerStage?: LeadStage | null;
  isActive: boolean;
  steps: NurturingStep[];
  enrollments?: NurturingEnrollment[];
  _count?: { steps: number; enrollments: number };
  createdAt: string;
  updatedAt: string;
}

export interface NurturingStep {
  id: string;
  sequenceId: string;
  stepOrder: number;
  type: "email" | "whatsapp" | "sms" | "wait";
  subject?: string;
  body?: string;
  delayDays: number;
  // WhatsApp steps reference an approved Meta template instead of free-form body.
  templateName?: string | null;
  templateLang?: string | null;
  templateParams?: string[] | null;
  // Email steps only — ids of previously-uploaded attachments reused for every send.
  attachmentIds?: string[] | null;
  createdAt: string;
}

export interface NurturingEnrollment {
  id: string;
  sequenceId: string;
  leadId: string;
  lead?: Pick<Lead, "id" | "name" | "email" | "stage">;
  sequence?: Pick<NurturingSequence, "id" | "name" | "steps">;
  status: "active" | "completed" | "removed";
  currentStep: number;
  nextRunAt?: string;
  enrolledAt: string;
  completedAt?: string;
}

export type TemplateChannel = "EMAIL" | "WHATSAPP";

export type WhatsappTemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export interface MessageTemplate {
  id: string;
  channel: TemplateChannel;
  name: string;
  subject?: string | null;
  body: string;
  isSystem: boolean;
  // WhatsApp-only Meta approval fields (null for EMAIL templates).
  status?: WhatsappTemplateStatus | null;
  language?: string | null;
  category?: string | null;
  metaTemplateName?: string | null;
  rejectionReason?: string | null;
  variables?: string[] | null;
  createdBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
  warnings?: { row: number; reason: string }[];
}

export interface ImportMapping {
  id: string;
  name: string;
  mappings: Record<string, string>;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

// ─── Billing / Subscriptions ────────────────────────────────────────────────

export type BillingInterval = "MONTHLY" | "ANNUAL";

export type SubscriptionStatus =
  | "CREATED"
  | "AUTHENTICATED"
  | "ACTIVE"
  | "PENDING"
  | "HALTED"
  | "CANCELLED"
  | "COMPLETED"
  | "EXPIRED";

export type AddonType = "EMAIL_CREDITS" | "WHATSAPP_CREDITS";

export interface SubscriptionPlanFeatures {
  leads: number;
  users: number;
  sequences: number;
  teams: number;
  emailCredits: number;
  whatsappCredits: number;
  callRecording?: boolean;
  advancedReports: boolean;
  dedicatedSupport?: boolean;
  sso?: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  tier: string;
  pricePerUser: number;
  setupFee: number;
  billingInterval: BillingInterval;
  razorpayPlanId: string | null;
  minUsers: number;
  maxUsers: number | null;
  features: SubscriptionPlanFeatures;
  isActive: boolean;
  createdAt: string;
}

export interface SubscriptionAddon {
  id: string;
  subscriptionId: string;
  type: AddonType;
  quantity: number;
  usedCount: number;
  pricePaid: number;
  razorpayPaymentId: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface BillingEvent {
  id: string;
  subscriptionId: string;
  event: string;
  amount: number | null;
  currency: string;
  razorpayPaymentId: string | null;
  createdAt: string;
}

export interface OrgSubscription {
  id: string;
  orgId: string;
  planId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  razorpaySubId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  userCount: number;
  addons: SubscriptionAddon[];
  createdAt: string;
  updatedAt: string;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "CANCELLED";
export type GstType = "CGST_SGST" | "IGST";
export type DiscountType = "PERCENT" | "FLAT";
export type RegistrationPaymentMode = "SAVE" | "SCREENSHOT";
export type EmiInstallmentStatus = "PENDING" | "PAID";
export type EmiPaymentMode = "MANUAL" | "SUBSCRIPTION";
export type EmiMandateStatus =
  | "CREATED"
  | "AUTHENTICATED"
  | "ACTIVE"
  | "HALTED"
  | "CANCELLED"
  | "COMPLETED";
export type ReminderChannel = "WHATSAPP" | "EMAIL";
export type PaymentGatewayName = "RAZORPAY" | "CASHFREE";

export type CourseCategory =
  | "TEST_PREP"
  | "LANGUAGE"
  | "TEST_SERIES"
  | "PROFESSIONAL_SKILLS"
  | "OTHER";
export type CourseSource = "MANUAL" | "LEAD";

export interface Tutor {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Batch {
  id: string;
  courseId: string;
  label: string;
  schedule: string;
  tutorId?: string | null;
  tutor?: Tutor | null;
  capacity: number;
  seats: number;
}

export interface Course {
  id: string;
  name: string;
  category: CourseCategory;
  defaultPrice: number;
  isActive: boolean;
  source: CourseSource;
  leadName?: string | null;
  batches: Batch[];
}

export interface InvoiceLineItem {
  id: string;
  courseId?: string | null;
  courseName: string;
  batchId?: string | null;
  batchLabel?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

export interface EmiInstallment {
  id: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  status: EmiInstallmentStatus;
  paidAt?: string | null;
  lastReminderAt?: string | null;
  lastReminderChannel?: ReminderChannel | null;
}

export interface Invoice {
  id: string;
  leadId: string;
  lead?: { id: string; name: string };
  invoiceNumber: string;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate?: string | null;
  notes?: string | null;
  gstEnabled: boolean;
  gstType: GstType;
  gstRate: number;
  discountType: DiscountType;
  discountValue: number;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstAmount?: number | null;
  grandTotal: number;
  paymentLinkAttached: boolean;
  paymentGateway?: PaymentGatewayName | null;
  paymentLinkUrl?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  registeredAt?: string | null;
  registrationFee?: number | null;
  registrationPaymentMode?: RegistrationPaymentMode | null;
  // Raw storage key for an uploaded registration screenshot, if any — never render this
  // directly; fetch a short-lived signed URL via getRegistrationScreenshotUrl(id) instead
  // (CLAUDE.md rule 6).
  registrationScreenshotKey?: string | null;
  registrationNote?: string | null;
  // Set once a sent registration-fee payment link is confirmed paid (webhook or the
  // manual "Mark as paid" override) — independent of registeredAt/registrationFee.
  registrationFeePaidAt?: string | null;
  emiPaymentMode: EmiPaymentMode;
  // emiGatewaySubscriptionId (the raw Razorpay subscription id) is deliberately never sent
  // to the client — see InvoicesService.stripInternalFields (CLAUDE.md rule 6).
  emiMandateStatus?: EmiMandateStatus | null;
  emiMandateShortUrl?: string | null;
  generatedFromRegistration: boolean;
  lineItems: InvoiceLineItem[];
  emiInstallments: EmiInstallment[];
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentGatewayStatus {
  gateway: PaymentGatewayName;
  connected: boolean;
}

export interface GoogleFormDto {
  id: string;
  name: string;
  isActive: boolean;
  lastSubmissionAt: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  syncError: string | null;
  isLegacy: boolean;
}

export interface GoogleConnectionDto {
  status: IntegrationStatus;
  accountName: string | null;
  configured: boolean;
}

export interface GooglePickerConfigDto {
  accessToken: string;
  expiresAt: string;
  apiKey: string;
  appId: string;
}

export interface SyncResultDto {
  synced: number;
  skipped?: boolean;
  error?: string;
}

export interface ConnectGoogleFormInput {
  googleFormId: string;
  googleSheetId?: string;
  createSheet?: boolean;
}

export interface PickedFile {
  id: string;
  name: string;
}

// Posted by the frontend OAuth callback page (in the popup) to window.opener.
export interface GoogleFormsOAuthMessage {
  type: "genxcrm-google-forms";
  status: "success" | "error";
  message?: string;
}

export interface FormSubmissionDto {
  id: string;
  formId: string;
  leadId: string | null;
  status: "RECEIVED" | "PROCESSED" | "FAILED";
  answers: Record<string, string>;
  submittedAt: string;
  form: { name: string };
  lead: { id: string; name: string } | null;
}

export type FormChannel = "EMAIL" | "WHATSAPP" | "SMS" | "LINK";
