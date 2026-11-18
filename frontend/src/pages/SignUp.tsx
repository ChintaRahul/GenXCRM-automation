import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  register,
  getBillingPlans,
  confirmRegistrationPayment,
  checkEmailAvailable,
  resendVerification,
  type RegisterPayload,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
import { loadRazorpayScript } from "../lib/razorpay";
import { apiErrorMessage } from "../lib/apiError";
import { trackCompleteRegistration } from "../lib/metaPixel";
import { Messages } from "../lib/messages";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  PlanPaymentStep,
  type PlanSelection,
} from "../components/register/PlanPaymentStep";
import { WorkspaceStep } from "../components/register/WorkspaceStep";
import { SignUpLayout, ActionBar } from "../components/register/SignUpLayout";
import {
  ChevronRight,
  Check,
  LockKeyhole,
  Loader2,
  MailCheck,
} from "lucide-react";
import type {
  OrgSize,
  SubscriptionPlan,
  WorkspaceType,
} from "../types";

import { TRIAL_DAYS } from "../lib/trial";

// Product may want the old two-field confirmation back; the field, its state and its
// validation all stay wired up behind this flag instead of being deleted.
const REQUIRE_CONFIRM_PASSWORD = false;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MetaIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
    </svg>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_SIZE_CHIPS: { value: OrgSize; label: string }[] = [
  { value: "MICRO", label: "1–10" },
  { value: "SMALL", label: "11–50" },
  { value: "MEDIUM", label: "51–200" },
  { value: "LARGE", label: "201–500" },
  { value: "ENTERPRISE", label: "500+" },
];

const COUNTRIES = [
  "India", "United States", "United Kingdom", "United Arab Emirates", "Singapore",
  "Australia", "Canada", "Germany", "France", "Japan", "South Africa", "Malaysia",
  "Philippines", "Bangladesh", "Sri Lanka", "Other",
];

const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Kolkata", label: "India (IST, UTC+5:30)" },
  { value: "Asia/Dubai", label: "UAE (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore (SGT, UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia (MYT, UTC+8)" },
  { value: "Asia/Tokyo", label: "Japan (JST, UTC+9)" },
  { value: "Asia/Dhaka", label: "Bangladesh (BST, UTC+6)" },
  { value: "Asia/Colombo", label: "Sri Lanka (IST, UTC+5:30)" },
  { value: "Europe/London", label: "UK (GMT/BST)" },
  { value: "Europe/Berlin", label: "Germany (CET, UTC+1)" },
  { value: "Europe/Paris", label: "France (CET, UTC+1)" },
  { value: "America/New_York", label: "US Eastern (EST, UTC-5)" },
  { value: "America/Chicago", label: "US Central (CST, UTC-6)" },
  { value: "America/Los_Angeles", label: "US Pacific (PST, UTC-8)" },
  { value: "America/Toronto", label: "Canada Eastern (EST, UTC-5)" },
  { value: "Australia/Sydney", label: "Australia Eastern (AEST, UTC+10)" },
  { value: "Africa/Johannesburg", label: "South Africa (SAST, UTC+2)" },
];

function defaultTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.some((t) => t.value === detected)) return detected;
  } catch {
    // Intl unavailable — fall through to the default below.
  }
  return "Asia/Kolkata";
}

// ─── Validation ──────────────────────────────────────────────────────────────

interface PasswordChecks {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

function getPasswordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password),
  };
}

function passwordScore(checks: PasswordChecks): number {
  return Object.values(checks).filter(Boolean).length;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** Accepts a URL with or without a scheme and returns it with https:// prepended when missing. */
function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

type Step1Fields = "name" | "email" | "phone" | "password" | "confirmPassword";
type Step2Fields = "orgName" | "orgSize" | "website";

function validateStep1Field(
  field: Step1Fields,
  value: string,
  password: string,
): string {
  switch (field) {
    case "name":
      if (!value.trim()) return "Full name is required";
      if (value.trim().length < 2) return "Name must be at least 2 characters";
      return "";
    case "email":
      if (!value.trim()) return "Email is required";
      if (!isValidEmail(value)) return "Enter a valid email address";
      return "";
    case "phone":
      if (value && !isValidPhone(value))
        return "Enter a valid phone number (7–15 digits)";
      return "";
    case "password": {
      if (!value) return "Password is required";
      const checks = getPasswordChecks(value);
      if (passwordScore(checks) < 5) return "Password needs all 5 requirements below";
      return "";
    }
    case "confirmPassword":
      if (!REQUIRE_CONFIRM_PASSWORD) return "";
      if (!value) return "Please confirm your password";
      if (value !== password) return "Passwords do not match";
      return "";
    default:
      return "";
  }
}

function validateStep2Field(field: Step2Fields, value: string): string {
  switch (field) {
    case "orgName":
      if (!value.trim()) return "Organization name is required";
      if (value.trim().length < 2) return "Name must be at least 2 characters";
      return "";
    case "orgSize":
      if (!value) return "Please choose your team size";
      return "";
    case "website":
      if (value && !isValidUrl(normalizeWebsite(value)))
        return "Enter a valid website";
      return "";
    default:
      return "";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const strengthConfig = [
  { max: 1, label: "Weak", bar: "bg-destructive", width: "w-1/5" },
  { max: 2, label: "Weak", bar: "bg-destructive", width: "w-2/5" },
  { max: 3, label: "Fair", bar: "bg-warning", width: "w-3/5" },
  { max: 4, label: "Good", bar: "bg-info", width: "w-4/5" },
  { max: 5, label: "Strong", bar: "bg-success", width: "w-full" },
];

function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const checks = getPasswordChecks(password);
  const score = passwordScore(checks);
  const config = strengthConfig[score - 1] ?? strengthConfig[0];

  const checkItems: { key: keyof PasswordChecks; label: string }[] = [
    { key: "length", label: "8+ characters" },
    { key: "uppercase", label: "Uppercase" },
    { key: "lowercase", label: "Lowercase" },
    { key: "number", label: "Number" },
    { key: "special", label: "Symbol" },
  ];

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-300 ${i < score ? config.bar : ""}`} />
            </div>
          ))}
        </div>
        <span className={`text-xs font-medium w-12 text-right ${config.bar.replace("bg-", "text-")}`}>
          {config.label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checkItems.map(({ key, label }) => (
          <span
            key={key}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
              checks[key] ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {checks[key] && <Check className="w-2.5 h-2.5" />}
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function FieldError({ error, touched, id }: { error: string; touched: boolean; id?: string }) {
  if (!touched || !error) return null;
  return (
    <p id={id} role="alert" className="text-[12.5px] text-destructive mt-1">
      {error}
    </p>
  );
}

function fieldClass(error: string, touched: boolean, hasValue: boolean): string {
  if (touched && error) return "border-destructive focus-visible:ring-destructive";
  if (touched && !error && hasValue) return "border-success focus-visible:ring-success";
  return "";
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Step1 {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}
interface Step2 {
  orgName: string;
  orgSize: OrgSize | "";
  website: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
}

type Status = "form" | "processing" | "success";

export default function SignUpPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType | "">("");
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  const [step1, setStep1] = useState<Step1>({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [errors1, setErrors1] = useState<Partial<Record<Step1Fields, string>>>({});
  const [touched1, setTouched1] = useState<Partial<Record<Step1Fields, boolean>>>({});

  const [step2, setStep2] = useState<Step2>({
    orgName: "",
    orgSize: "",
    website: "",
    city: "",
    state: "",
    country: "India",
    timezone: defaultTimezone(),
  });
  const [errors2, setErrors2] = useState<Partial<Record<Step2Fields, string>>>({});
  const [touched2, setTouched2] = useState<Partial<Record<Step2Fields, boolean>>>({});
  const [editLocation, setEditLocation] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const [isPaidSignup, setIsPaidSignup] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  const navigate = useNavigate();
  const { signIn } = useAuth();

  const emailCheckIdRef = useRef(0);

  async function handleEmailBlur(value: string) {
    touchField1("email", value);
    if (validateStep1Field("email", value, step1.password)) return;

    const requestId = ++emailCheckIdRef.current;
    try {
      const available = await checkEmailAvailable(value.trim().toLowerCase());
      if (requestId !== emailCheckIdRef.current) return; // superseded by a later blur
      if (!available) {
        setErrors1((p) => ({ ...p, email: Messages.auth.emailExists }));
      }
    } catch {
      // Network/API failure — fall back silently, register() still catches duplicates.
    }
  }

  useEffect(() => {
    getBillingPlans()
      .then(setPlans)
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, []);

  // ── Step 1 handlers ──

  const touchField1 = useCallback(
    (field: Step1Fields, value: string, password?: string) => {
      setTouched1((p) => ({ ...p, [field]: true }));
      setErrors1((p) => ({
        ...p,
        [field]: validateStep1Field(field, value, password ?? step1.password),
      }));
    },
    [step1.password],
  );

  function handleS1Change(field: Step1Fields, value: string) {
    setStep1((p) => ({ ...p, [field]: value }));

    if (field === "password" && touched1.confirmPassword) {
      setErrors1((p) => ({
        ...p,
        confirmPassword: validateStep1Field("confirmPassword", step1.confirmPassword, value),
      }));
    }
    if (touched1[field]) {
      setErrors1((p) => ({
        ...p,
        [field]: validateStep1Field(field, value, field === "password" ? value : step1.password),
      }));
    }
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    const fields: Step1Fields[] = REQUIRE_CONFIRM_PASSWORD
      ? ["name", "email", "phone", "password", "confirmPassword"]
      : ["name", "email", "phone", "password"];
    const newErrors: Partial<Record<Step1Fields, string>> = {};
    fields.forEach((f) => {
      newErrors[f] = validateStep1Field(f, step1[f], step1.password);
    });
    setErrors1(newErrors);
    setTouched1((p) => ({ ...p, ...Object.fromEntries(fields.map((f) => [f, true])) }));

    const hasError = fields.some((f) => !!newErrors[f]);
    if (hasError) return;

    setSubmitError("");
    setStep(2);
  }

  // ── Workspace step handler ──

  function handleWorkspaceConfirm(type: WorkspaceType) {
    setWorkspaceType(type);
    setStep(3);
  }

  // ── Step 3 (organization) handlers ──

  function handleS2Change(field: keyof Step2, value: string) {
    setStep2((p) => ({ ...p, [field]: value }));
    if (
      ["orgName", "orgSize", "website"].includes(field) &&
      touched2[field as Step2Fields]
    ) {
      setErrors2((p) => ({
        ...p,
        [field]: validateStep2Field(field as Step2Fields, value),
      }));
    }
  }

  function touchField2(field: Step2Fields, value: string) {
    setTouched2((p) => ({ ...p, [field]: true }));
    setErrors2((p) => ({ ...p, [field]: validateStep2Field(field, value) }));
  }

  function handleOrgNext(e: React.FormEvent) {
    e.preventDefault();
    const fields: Step2Fields[] = ["orgName", "orgSize", "website"];
    const newErrors: Partial<Record<Step2Fields, string>> = {};
    fields.forEach((f) => {
      newErrors[f] = validateStep2Field(f, step2[f] as string);
    });
    setErrors2(newErrors);
    setTouched2({ orgName: true, orgSize: true, website: true });

    if (fields.some((f) => !!newErrors[f])) return;

    if (step2.website) {
      setStep2((p) => ({ ...p, website: normalizeWebsite(p.website) }));
    }

    setSubmitError("");
    setStep(4);
  }

  // ── Step 4 (plan & payment) handler ──

  async function handlePlanSubmit(selection: PlanSelection) {
    setSubmitError("");
    setIsPaidSignup(!!selection.plan);
    setStatus("processing");

    const payload: RegisterPayload = {
      name: step1.name,
      email: step1.email,
      phone: step1.phone || undefined,
      password: step1.password,
      orgName: step2.orgName,
      workspaceType: workspaceType as WorkspaceType,
      orgSize: step2.orgSize as OrgSize,
      website: step2.website || undefined,
      city: step2.city || undefined,
      state: step2.state || undefined,
      country: step2.country,
      timezone: step2.timezone,
      acceptedTerms: selection.acceptedTerms,
      selectedPlanId: selection.plan?.id ?? "trial",
      billingInterval: selection.plan ? selection.billingInterval : undefined,
      seats: selection.plan ? selection.seats : undefined,
      couponCode: selection.couponCode ?? undefined,
    };

    try {
      const result = await register(payload);

      if (!selection.plan) {
        trackCompleteRegistration();
        setStatus("success");
        return;
      }

      if (result.billingSetupFailed || !result.subscriptionId || !result.razorpayKeyId) {
        setSubmitError(Messages.billing.registrationPaymentFailed);
        setStatus("form");
        return;
      }

      const orgId = result.org.id;
      const subscriptionId = result.subscriptionId;
      const razorpayKeyId = result.razorpayKeyId;
      const plan = selection.plan;

      await loadRazorpayScript();
      await new Promise<void>((resolve) => {
        const rzp = new window.Razorpay({
          key: razorpayKeyId,
          subscription_id: subscriptionId,
          name: "GenXCRM",
          description: `${plan.name} — ${selection.seats} seat${selection.seats > 1 ? "s" : ""}`,
          prefill: { email: step1.email, name: step1.name },
          theme: { color: "#119C9C" },
          handler: (response) => {
            confirmRegistrationPayment({
              orgId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySubscriptionId: response.razorpay_subscription_id ?? subscriptionId,
              razorpaySignature: response.razorpay_signature ?? "",
            })
              .then(({ token, user }) => {
                trackCompleteRegistration();
                signIn(token, user);
                navigate("/");
              })
              .catch((err: unknown) => {
                setSubmitError(apiErrorMessage(err, Messages.billing.registrationPaymentFailed));
                setStatus("form");
              })
              .finally(() => resolve());
          },
          modal: {
            ondismiss: () => {
              setStatus("form");
              resolve();
            },
          },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setStep(1);
        setErrors1((p) => ({ ...p, email: Messages.auth.emailExists }));
        setTouched1((p) => ({ ...p, email: true }));
      } else {
        setSubmitError(Messages.auth.registrationFailed);
      }
      setStatus("form");
    }
  }

  async function handleResend() {
    setResendState("sending");
    try {
      await resendVerification(step1.email);
    } catch {
      // Best-effort — the original verification email is still valid either way.
    } finally {
      setResendState("sent");
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  if (status === "success") {
    return (
      <SignUpLayout step={4} trialDays={TRIAL_DAYS} onStepClick={() => {}}>
        <div className="text-center py-6">
          <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-5">
            <MailCheck className="w-7 h-7 text-success" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-foreground mb-2">
            Check your inbox
          </h1>
          <p className="text-sm text-muted-foreground mb-7 max-w-sm mx-auto">
            We sent a verification link to <strong className="text-foreground">{step1.email}</strong>.
            Verify your email to start your {TRIAL_DAYS}-day trial.
          </p>
          <div className="flex flex-col gap-3 max-w-xs mx-auto">
            <Button className="h-12" onClick={() => navigate("/login?registered=true")}>
              Go to sign in <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12"
              disabled={resendState !== "idle"}
              onClick={() => void handleResend()}
            >
              {resendState === "sending" ? "Sending…" : resendState === "sent" ? "Email sent" : "Resend email"}
            </Button>
          </div>
        </div>
      </SignUpLayout>
    );
  }

  return (
    <SignUpLayout step={step} trialDays={TRIAL_DAYS} onStepClick={(s) => s < step && setStep(s)}>
      {status === "processing" && step === 4 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Loader2 className="w-9 h-9 text-primary animate-spin mb-4" />
          <p className="text-sm font-medium text-foreground">
            {isPaidSignup ? "Opening secure checkout…" : "Setting up your workspace…"}
          </p>
        </div>
      ) : (
        <>
          {/* ── Step 1 ── */}
          {step === 1 && (
            <>
              <h1 className="font-display text-2xl min-[720px]:text-[1.875rem] font-semibold text-foreground mb-1">
                Create your account
              </h1>
              <p className="text-sm text-muted-foreground mb-5">
                Start with your details — we&apos;ll set up the workspace next.
              </p>

              {/* SSO buttons */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <a
                  href={`${API_BASE}/auth/google`}
                  className="flex items-center justify-center gap-1.5 h-11 rounded-md border border-input bg-background hover:bg-muted transition-colors text-xs font-medium text-foreground"
                >
                  <GoogleIcon /> Google
                </a>
                <a
                  href={`${API_BASE}/auth/twitter`}
                  className="flex items-center justify-center gap-1.5 h-11 rounded-md border border-input bg-background hover:bg-muted transition-colors text-xs font-medium text-foreground"
                >
                  <XIcon /> X
                </a>
                <a
                  href={`${API_BASE}/auth/facebook`}
                  className="flex items-center justify-center gap-1.5 h-11 rounded-md border border-input bg-background hover:bg-muted transition-colors text-xs font-medium text-foreground"
                >
                  <MetaIcon /> Meta
                </a>
              </div>

              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background px-2 text-muted-foreground flex-none whitespace-nowrap">
                    or sign up with email
                  </span>
                </div>
              </div>

              <form onSubmit={handleNext} className="space-y-4" noValidate>
                {/* Name + Phone */}
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
                >
                  <div className="space-y-1">
                    <Label htmlFor="name">
                      Full name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      type="text"
                      autoComplete="name"
                      value={step1.name}
                      onChange={(e) => handleS1Change("name", e.target.value)}
                      onBlur={(e) => touchField1("name", e.target.value)}
                      placeholder="Arjun Sharma"
                      aria-describedby={errors1.name ? "name-error" : undefined}
                      className={`h-11 text-base ${fieldClass(errors1.name ?? "", !!touched1.name, !!step1.name)}`}
                    />
                    <FieldError id="name-error" error={errors1.name ?? ""} touched={!!touched1.name} />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="phone">
                      Phone number{" "}
                      <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      value={step1.phone}
                      onChange={(e) => handleS1Change("phone", e.target.value)}
                      onBlur={(e) => touchField1("phone", e.target.value)}
                      placeholder="+91 98765 43210"
                      aria-describedby={errors1.phone ? "phone-error" : undefined}
                      className={`h-11 text-base ${fieldClass(errors1.phone ?? "", !!touched1.phone, !!step1.phone)}`}
                    />
                    <FieldError id="phone-error" error={errors1.phone ?? ""} touched={!!touched1.phone} />
                  </div>
                </div>

                {/* Work email */}
                <div className="space-y-1">
                  <Label htmlFor="email">
                    Work email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={step1.email}
                    onChange={(e) => handleS1Change("email", e.target.value)}
                    onBlur={(e) => void handleEmailBlur(e.target.value)}
                    placeholder="you@company.com"
                    aria-describedby={errors1.email ? "email-error" : undefined}
                    className={`h-11 text-base ${fieldClass(errors1.email ?? "", !!touched1.email, !!step1.email)}`}
                  />
                  <FieldError id="email-error" error={errors1.email ?? ""} touched={!!touched1.email} />
                  {touched1.email && errors1.email === Messages.auth.emailExists && (
                    <p className="text-xs text-muted-foreground">
                      Already have a workspace?{" "}
                      <Link to="/login" className="text-primary hover:underline font-medium">
                        Sign in instead
                      </Link>
                    </p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-1">
                  <Label htmlFor="password">
                    Password <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={step1.password}
                      onChange={(e) => handleS1Change("password", e.target.value)}
                      onBlur={(e) => touchField1("password", e.target.value)}
                      placeholder="At least 8 characters"
                      aria-describedby={errors1.password ? "password-error" : undefined}
                      className={`h-11 text-base pr-16 ${fieldClass(errors1.password ?? "", !!touched1.password, !!step1.password)}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  <FieldError id="password-error" error={errors1.password ?? ""} touched={!!touched1.password} />
                  <PasswordStrengthMeter password={step1.password} />
                </div>

                {REQUIRE_CONFIRM_PASSWORD && (
                  <div className="space-y-1">
                    <Label htmlFor="confirmPassword">
                      Confirm password <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        value={step1.confirmPassword}
                        onChange={(e) => handleS1Change("confirmPassword", e.target.value)}
                        onBlur={(e) => touchField1("confirmPassword", e.target.value, step1.password)}
                        placeholder="Re-enter password"
                        className={`h-11 text-base pr-16 ${fieldClass(errors1.confirmPassword ?? "", !!touched1.confirmPassword, !!step1.confirmPassword)}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        {showConfirm ? "Hide" : "Show"}
                      </button>
                    </div>
                    <FieldError error={errors1.confirmPassword ?? ""} touched={!!touched1.confirmPassword} />
                  </div>
                )}

                <ActionBar>
                  <Button type="submit" className="h-12 w-full">
                    Continue <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </ActionBar>

                <p className="text-xs text-muted-foreground text-center pt-1">
                  You&apos;ll be the Director (owner) of this workspace. Signing up with Google, X
                  or Meta means you accept our{" "}
                  <a
                    href="/terms#plan-limits"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Terms of Service
                  </a>
                  .
                </p>
              </form>
            </>
          )}

          {/* ── Step 2: Workspace ── */}
          {step === 2 && (
            <WorkspaceStep value={workspaceType} onConfirm={handleWorkspaceConfirm} onBack={() => setStep(1)} />
          )}

          {/* ── Step 3: Organization ── */}
          {step === 3 && (
            <>
              <h1 className="font-display text-2xl min-[720px]:text-[1.875rem] font-semibold text-foreground mb-1">
                Tell us about your organization
              </h1>
              <p className="text-sm text-muted-foreground mb-5">
                Used for your workspace name, invoices and reminders.
              </p>

              <form onSubmit={handleOrgNext} className="space-y-4" noValidate>
                {/* Org name */}
                <div className="space-y-1">
                  <Label htmlFor="orgName">
                    Organization name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="orgName"
                    type="text"
                    autoComplete="organization"
                    value={step2.orgName}
                    onChange={(e) => handleS2Change("orgName", e.target.value)}
                    onBlur={(e) => touchField2("orgName", e.target.value)}
                    placeholder="Acme Edu Pvt. Ltd."
                    aria-describedby={errors2.orgName ? "orgName-error" : undefined}
                    className={`h-11 text-base ${fieldClass(errors2.orgName ?? "", !!touched2.orgName, !!step2.orgName)}`}
                  />
                  <FieldError id="orgName-error" error={errors2.orgName ?? ""} touched={!!touched2.orgName} />
                </div>

                {/* Workspace type (locked) */}
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/10 text-primary rounded-full px-3 py-1">
                    <LockKeyhole className="w-3 h-3" />
                    {workspaceType === "MANUFACTURING" ? "Manufacturing" : "EdTech"} workspace
                  </span>
                </div>

                {/* Team size */}
                <div className="space-y-1">
                  <Label id="orgSize-label">
                    Team size <span className="text-destructive">*</span>
                  </Label>
                  <div
                    role="radiogroup"
                    aria-labelledby="orgSize-label"
                    className="grid gap-2"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))" }}
                  >
                    {ORG_SIZE_CHIPS.map((s) => {
                      const isSelected = step2.orgSize === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => {
                            handleS2Change("orgSize", s.value);
                            touchField2("orgSize", s.value);
                          }}
                          className={`h-11 rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
                            isSelected
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-input text-muted-foreground"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  <FieldError error={errors2.orgSize ?? ""} touched={!!touched2.orgSize} />
                </div>

                {/* Website */}
                <div className="space-y-1">
                  <Label htmlFor="website">
                    Website{" "}
                    <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="website"
                    type="text"
                    value={step2.website}
                    onChange={(e) => handleS2Change("website", e.target.value)}
                    onBlur={(e) => touchField2("website", e.target.value)}
                    placeholder="yourcompany.com"
                    aria-describedby={errors2.website ? "website-error" : undefined}
                    className={`h-11 text-base ${fieldClass(errors2.website ?? "", !!touched2.website, !!step2.website)}`}
                  />
                  <FieldError id="website-error" error={errors2.website ?? ""} touched={!!touched2.website} />
                </div>

                {/* Location & timezone */}
                <div className="rounded-lg border border-border p-3">
                  {!editLocation ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-foreground min-w-0 truncate">
                        {[step2.city, step2.state, step2.country].filter(Boolean).join(", ")}
                        {" · "}
                        {TIMEZONES.find((t) => t.value === step2.timezone)?.label ?? step2.timezone}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditLocation(true)}
                        className="text-xs font-medium text-primary hover:underline shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div
                        className="grid gap-3"
                        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
                      >
                        <div className="space-y-1">
                          <Label htmlFor="country">Country</Label>
                          <select
                            id="country"
                            value={step2.country}
                            onChange={(e) => handleS2Change("country", e.target.value)}
                            className="w-full h-11 text-base rounded-md border border-input bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            {COUNTRIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="timezone">Time zone</Label>
                          <select
                            id="timezone"
                            value={step2.timezone}
                            onChange={(e) => handleS2Change("timezone", e.target.value)}
                            className="w-full h-11 text-base rounded-md border border-input bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            {TIMEZONES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="city">
                            City <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                          </Label>
                          <Input
                            id="city"
                            type="text"
                            value={step2.city}
                            onChange={(e) => handleS2Change("city", e.target.value)}
                            placeholder="Bangalore"
                            className="h-11 text-base"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="state">
                            State <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                          </Label>
                          <Input
                            id="state"
                            type="text"
                            value={step2.state}
                            onChange={(e) => handleS2Change("state", e.target.value)}
                            placeholder="Karnataka"
                            className="h-11 text-base"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditLocation(false)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>

                <ActionBar>
                  <Button type="button" variant="outline" className="h-12 w-auto px-6" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" className="h-12 flex-1">
                    Continue <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </ActionBar>
              </form>
            </>
          )}

          {/* ── Step 4: Plan & payment ── */}
          {step === 4 && (
            <PlanPaymentStep
              plans={plans}
              plansLoading={plansLoading}
              trialDays={TRIAL_DAYS}
              submitting={false}
              submitError={submitError}
              onBack={() => {
                setSubmitError("");
                setStep(3);
              }}
              onSubmit={(selection) => void handlePlanSubmit(selection)}
            />
          )}
        </>
      )}
    </SignUpLayout>
  );
}
