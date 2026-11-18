import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ActionBar } from "./SignUpLayout";
import { validateCoupon, type CouponDetails } from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { SubscriptionPlan, BillingInterval } from "../../types";

const TIER_DISPLAY_ORDER = ["pro"];
const GST_RATE = 0.18;

const FEATURE_ROWS: { key: string; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "teams", label: "Teams" },
  { key: "users", label: "Users" },
  { key: "sequences", label: "Nurturing sequences" },
  { key: "emailCredits", label: "Email credits/mo" },
  { key: "advancedReports", label: "Advanced reports" },
  { key: "whatsappCredits", label: "WhatsApp credits (one-time)" },
];

function formatFeatureValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Included" : "Not included";
  if (typeof value === "number")
    return value === -1 ? "Unlimited" : value.toLocaleString();
  return String(value);
}

function inr(n: number): string {
  return n.toLocaleString("en-IN");
}

function FeatureList({ features }: { features: Record<string, unknown> }) {
  return (
    <ul className="space-y-1 text-xs flex-1">
      {FEATURE_ROWS.map(({ key, label }) => {
        if (!(key in features)) return null;
        const formatted = formatFeatureValue(features[key]);
        return (
          <li key={key} className="flex items-start gap-1.5 min-w-0">
            <Check className="w-3 h-3 text-success shrink-0 mt-0.5" />
            <span className="min-w-0" title={`${label}: ${formatted}`}>
              {label}: {formatted}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export interface PlanSelection {
  plan: SubscriptionPlan | null; // null = free trial
  billingInterval: BillingInterval;
  seats: number;
  couponCode: string | null;
  acceptedTerms: boolean;
}

interface PlanPaymentStepProps {
  plans: SubscriptionPlan[];
  plansLoading: boolean;
  trialDays: number;
  submitting: boolean;
  submitError: string;
  onBack: () => void;
  onSubmit: (selection: PlanSelection) => void;
}

export function PlanPaymentStep({
  plans,
  plansLoading,
  trialDays,
  submitting,
  submitError,
  onBack,
  onSubmit,
}: PlanPaymentStepProps) {
  const [selectedTier, setSelectedTier] = useState<string>("trial");
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>("MONTHLY");
  const [seats, setSeats] = useState(1);
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<CouponDetails | null>(
    null,
  );
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsTouched, setTermsTouched] = useState(false);

  const trialPlan = plans.find((p) => p.tier === "trial");

  const tiers = useMemo(() => {
    const unique = Array.from(new Set(plans.filter((p) => p.tier !== "trial").map((p) => p.tier)));
    return unique.sort((a, b) => {
      const ai = TIER_DISPLAY_ORDER.indexOf(a);
      const bi = TIER_DISPLAY_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [plans]);
  // The recommended plan always renders second overall (first paid card, right after Trial).
  const recommendedTier = tiers[0];

  const selectedPlan = useMemo(
    () =>
      selectedTier === "trial"
        ? null
        : (plans.find(
            (p) => p.tier === selectedTier && p.billingInterval === billingInterval,
          ) ?? null),
    [plans, selectedTier, billingInterval],
  );

  useEffect(() => {
    if (!selectedPlan) return;
    setSeats((s) => {
      const clampedMin = Math.max(s, selectedPlan.minUsers);
      return selectedPlan.maxUsers ? Math.min(clampedMin, selectedPlan.maxUsers) : clampedMin;
    });
  }, [selectedPlan]);

  function selectTier(tier: string) {
    setSelectedTier(tier);
    const plan = plans.find(
      (p) => p.tier === tier && p.billingInterval === billingInterval,
    );
    if (plan) setSeats((s) => Math.max(s, plan.minUsers));
  }

  function changeSeats(next: number) {
    if (!selectedPlan) return;
    const clamped = Math.max(
      selectedPlan.minUsers,
      selectedPlan.maxUsers ? Math.min(next, selectedPlan.maxUsers) : next,
    );
    setSeats(clamped);
  }

  async function handleApplyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      const result = await validateCoupon(code, selectedPlan?.id);
      setCouponApplied(result);
      setCouponInput("");
    } catch (err) {
      setCouponApplied(null);
      setCouponError(apiErrorMessage(err, Messages.billing.invalidCoupon));
    } finally {
      setCouponLoading(false);
    }
  }

  function handleRemoveCoupon() {
    setCouponApplied(null);
    setCouponError("");
  }

  // No annual discount is built into pricing — the per-seat rate is the same either
  // way; annual billing just charges 12 months upfront instead of monthly. Any
  // discount is applied later via a coupon, not baked into the plan's price.
  const monthlyEquivalent = selectedPlan?.pricePerUser ?? 0;
  const subtotal = selectedPlan
    ? billingInterval === "ANNUAL"
      ? monthlyEquivalent * 12 * seats
      : monthlyEquivalent * seats
    : 0;
  const discount = couponApplied
    ? couponApplied.discountType === "PERCENT"
      ? Math.round(subtotal * (couponApplied.discountValue / 100))
      : Math.min(couponApplied.discountValue, subtotal)
    : 0;
  const setupFee = selectedPlan?.setupFee ?? 0;
  // Display only — the server quotes the authoritative amount when it confirms payment.
  const gst = Math.round((subtotal - discount + setupFee) * GST_RATE);
  const dueToday = subtotal - discount + setupFee + gst;

  const isTrial = selectedTier === "trial";
  const canSubmit =
    acceptedTerms && (isTrial || (selectedPlan != null && !plansLoading));
  const ctaLabel = isTrial
    ? `Start ${trialDays}-day free trial`
    : `Pay ₹${inr(dueToday)} & create workspace`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTermsTouched(true);
    if (!acceptedTerms) return;
    if (!canSubmit) return;
    onSubmit({
      plan: selectedPlan,
      billingInterval,
      seats,
      couponCode: couponApplied?.code ?? null,
      acceptedTerms,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="font-display text-2xl min-[720px]:text-[1.875rem] font-semibold text-foreground mb-1">
          Choose how to start
        </h1>
        <p className="text-sm text-muted-foreground">
          Try everything free, or go straight to a paid plan.
        </p>
      </div>

      {/* Plan cards */}
      <div
        role="radiogroup"
        aria-label="Plan"
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))" }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={isTrial}
          onClick={() => selectTier("trial")}
          className={`text-left rounded-xl border bg-card p-4 flex flex-col gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
            isTrial ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span
              aria-hidden="true"
              className={`w-4 h-4 rounded-full border-2 shrink-0 ${isTrial ? "border-primary bg-primary" : "border-input"}`}
            />
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              No card required
            </span>
          </div>
          <div>
            <p className="font-display text-[1.625rem] font-bold text-foreground leading-none">
              {trialDays} days
            </p>
            <p className="text-xs text-muted-foreground mt-1">free</p>
          </div>
          <p className="text-xs font-medium text-foreground">Everything unlocked</p>
          {trialPlan && (
            <FeatureList features={trialPlan.features as unknown as Record<string, unknown>} />
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="w-3 h-3 text-success shrink-0" />
            Cancel anytime
          </p>
        </button>

        {plansLoading &&
          [1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4 h-40 animate-pulse"
            />
          ))}

        {!plansLoading &&
          tiers.map((tier) => {
            const plan = plans.find(
              (p) => p.tier === tier && p.billingInterval === billingInterval,
            );
            if (!plan) return null;
            const isSelected = selectedTier === tier;
            const isRecommended = tier === recommendedTier;
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => selectTier(tier)}
                className={`relative text-left rounded-xl border bg-card p-4 flex flex-col gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
                  isSelected ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    aria-hidden="true"
                    className={`w-4 h-4 rounded-full border-2 shrink-0 ${isSelected ? "border-primary bg-primary" : "border-input"}`}
                  />
                  {isRecommended && (
                    <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                      Most popular
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-foreground truncate" title={plan.name}>
                    {plan.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {plan.maxUsers ? `${plan.minUsers}–${plan.maxUsers} users` : `${plan.minUsers}+ users`}
                  </p>
                </div>
                <p className="font-display text-[1.625rem] font-bold text-foreground leading-none">
                  ₹{inr(plan.pricePerUser)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}/ user / mo
                  </span>
                </p>
                {plan.setupFee > 0 && (
                  <p className="text-xs text-muted-foreground -mt-2">
                    + ₹{inr(plan.setupFee)} one-time setup
                  </p>
                )}
                <FeatureList features={plan.features as unknown as Record<string, unknown>} />
              </button>
            );
          })}
      </div>

      {isTrial && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <strong>Nothing to pay today.</strong> Your {trialDays}-day trial starts once
          you verify your email. Pick a plan from Billing whenever you&apos;re ready.
        </div>
      )}

      {!isTrial && selectedPlan && (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
          {/* Left column */}
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Billing</Label>
              <div className="inline-flex rounded-md bg-muted p-1">
                {(["MONTHLY", "ANNUAL"] as BillingInterval[]).map((interval) => (
                  <button
                    key={interval}
                    type="button"
                    onClick={() => setBillingInterval(interval)}
                    className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 ${
                      billingInterval === interval
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    {interval === "MONTHLY" ? "Monthly" : "Annual"}
                    {interval === "ANNUAL" && (
                      <span className="inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                        2 mo free
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="seats" className="mb-1.5 block">
                Users{" "}
                <span className="text-muted-foreground font-normal">
                  ({selectedPlan.maxUsers
                    ? `${selectedPlan.minUsers}–${selectedPlan.maxUsers}`
                    : `${selectedPlan.minUsers}+`})
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => changeSeats(seats - 1)}
                  disabled={seats <= selectedPlan.minUsers}
                  aria-label="Decrease users"
                  className="h-11 w-11 shrink-0 rounded-md border border-input flex items-center justify-center text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <Input
                  id="seats"
                  type="number"
                  inputMode="numeric"
                  min={selectedPlan.minUsers}
                  max={selectedPlan.maxUsers ?? undefined}
                  value={seats}
                  onChange={(e) => changeSeats(Number(e.target.value) || selectedPlan.minUsers)}
                  className="h-11 text-base text-center w-20"
                />
                <button
                  type="button"
                  onClick={() => changeSeats(seats + 1)}
                  disabled={selectedPlan.maxUsers != null && seats >= selectedPlan.maxUsers}
                  aria-label="Increase users"
                  className="h-11 w-11 shrink-0 rounded-md border border-input flex items-center justify-center text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="coupon">Coupon code</Label>
              {couponApplied ? (
                <div className="flex items-center justify-between rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                  <span className="text-success font-medium">
                    {couponApplied.code} &middot; {couponApplied.label}
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="coupon"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="e.g. WELCOME20"
                    className="h-11 text-base uppercase"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={couponLoading || !couponInput.trim()}
                    onClick={() => void handleApplyCoupon()}
                  >
                    {couponLoading ? "Checking…" : "Apply"}
                  </Button>
                </div>
              )}
              {couponError && !couponApplied && (
                <p className="text-xs text-destructive mt-1" role="alert">
                  {couponError}
                </p>
              )}
            </div>
          </div>

          {/* Right column — order summary */}
          <div className="rounded-xl bg-muted/50 p-5 space-y-2 h-fit">
            <p className="font-medium text-foreground">
              {selectedPlan.name} &middot; {seats} user{seats > 1 ? "s" : ""} &middot;{" "}
              {billingInterval === "ANNUAL" ? "Annual" : "Monthly"}
            </p>
            <div className="border-t border-border pt-2 space-y-1 text-sm tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>₹{inr(subtotal)}</span>
              </div>
              {couponApplied && (
                <div className="flex justify-between text-success">
                  <span>Coupon ({couponApplied.code})</span>
                  <span>−₹{inr(discount)}</span>
                </div>
              )}
              {setupFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">One-time setup fee</span>
                  <span>₹{inr(setupFee)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST (18%)</span>
                <span>₹{inr(gst)}</span>
              </div>
            </div>
            <div className="border-t border-border pt-2 flex justify-between items-baseline tabular-nums">
              <span className="font-medium text-foreground">Due today</span>
              <span className="font-display text-[1.375rem] font-bold text-foreground">
                ₹{inr(dueToday)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Renews at ₹{inr(subtotal)}/{billingInterval === "ANNUAL" ? "yr" : "mo"} + GST.
              Cancel anytime. Card, UPI and netbanking accepted at checkout.
            </p>
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          role="checkbox"
          aria-checked={acceptedTerms}
          aria-describedby={termsTouched && !acceptedTerms ? "terms-error" : undefined}
          onClick={() => setAcceptedTerms((v) => !v)}
          className="flex items-start gap-2 text-sm text-left focus-visible:outline-none"
        >
          <span
            className={`w-4 h-4 mt-0.5 shrink-0 rounded border flex items-center justify-center ${
              termsTouched && !acceptedTerms
                ? "border-destructive"
                : acceptedTerms
                  ? "bg-primary border-primary"
                  : "border-input bg-background"
            }`}
          >
            {acceptedTerms && <Check className="w-3 h-3 text-primary-foreground" />}
          </span>
          <span className="text-muted-foreground">
            I agree to the{" "}
            <a
              href="/terms#plan-limits"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Terms of Service
            </a>{" "}
            and Privacy Policy
          </span>
        </button>
        {termsTouched && !acceptedTerms && (
          <p id="terms-error" role="alert" className="text-xs text-destructive mt-1 ml-6">
            Please accept the terms to continue
          </p>
        )}
      </div>

      {submitError && (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <ActionBar>
        <Button type="button" variant="outline" className="h-12 w-auto px-6" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button type="submit" className="h-12 flex-1" disabled={!canSubmit || submitting}>
          {submitting ? "Processing…" : ctaLabel}
        </Button>
      </ActionBar>
    </form>
  );
}
