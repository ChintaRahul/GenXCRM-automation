import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Check,
  CreditCard,
  Mail,
  MessageSquare,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  X,
} from "lucide-react";
import { Header } from "../components/layout/Header";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useBilling } from "../hooks/useBilling";
import { useAuth } from "../context/AuthContext";
import { isNative, openExternal, webAppUrl } from "../lib/platform";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { validateCoupon, type CouponDetails } from "../api/client";
import type { SeatUpdateCheckoutResult } from "../api/client";
import type {
  SubscriptionPlan,
  BillingInterval,
  AddonType,
  TrialStatus,
} from "../types";

const FEATURE_LABELS: Record<string, string> = {
  leads: "Leads",
  users: "Users",
  sequences: "Nurturing sequences",
  teams: "Teams",
  emailCredits: "Email credits/mo",
  whatsappCredits: "WhatsApp credits (one-time)",
  callRecording: "Call recording",
  advancedReports: "Advanced reports",
  dedicatedSupport: "Dedicated support",
  sso: "SSO login",
};

function formatFeatureValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Included" : "Not included";
  if (typeof value === "number")
    return value === -1 ? "Unlimited" : value.toLocaleString();
  return String(value);
}

// Shared destructive-action confirm dialog — small, per-page local component
// (mirrors the pattern already used in Nurturing.tsx), not a new abstraction.
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={loading} onClick={onConfirm}>
            {loading ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  plan,
  isCurrentPlan,
  billingInterval,
  userCount,
  activeUserCount,
  onSubscribe,
  subscribing,
}: {
  plan: SubscriptionPlan;
  isCurrentPlan: boolean;
  billingInterval: BillingInterval;
  userCount: number;
  activeUserCount: number;
  onSubscribe: (plan: SubscriptionPlan) => void;
  subscribing: boolean;
}) {
  // No annual discount is built into pricing — the per-seat rate is the same either
  // way; annual billing just charges 12 months upfront instead of monthly. Any
  // discount is applied later via a coupon, not baked into the plan's price.
  const monthlyEquivalent = plan.pricePerUser;
  const totalPerMonth = monthlyEquivalent * userCount;
  const minRequired = Math.max(plan.minUsers, activeUserCount);
  const outOfRange =
    userCount < minRequired || (plan.maxUsers != null && userCount > plan.maxUsers);
  const features = plan.features as unknown as Record<string, unknown>;
  const tierColor = isCurrentPlan
    ? "border-green-500 ring-1 ring-green-500"
    : "border-primary ring-1 ring-primary";

  return (
    <div
      className={`relative rounded-xl border bg-card p-6 flex flex-col gap-4 transition-shadow ${
        isCurrentPlan ? "" : "hover:shadow-sm"
      } ${tierColor}`}
    >
      {isCurrentPlan && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-green-500 text-white text-xs px-3">
            Current Plan
          </Badge>
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        <p
          className={`text-xs mt-0.5 ${
            outOfRange
              ? "text-destructive font-medium"
              : "text-muted-foreground"
          }`}
        >
          {plan.maxUsers
            ? `${plan.minUsers}–${plan.maxUsers} users`
            : `${plan.minUsers}+ users`}
        </p>
      </div>

      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold">
            ₹{monthlyEquivalent.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">/user/mo</span>
        </div>
        {billingInterval === "ANNUAL" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            billed annually
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          ₹{totalPerMonth.toLocaleString()}/mo for {userCount} seat
          {userCount > 1 ? "s" : ""}
        </p>
        {plan.setupFee > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            + ₹{plan.setupFee.toLocaleString()} one-time setup fee
          </p>
        )}
      </div>

      <ul className="space-y-2 flex-1 text-sm">
        {Object.entries(features)
          .filter(([k]) => k in FEATURE_LABELS)
          .map(([key, value]) => {
            const isIncluded = value !== false && value !== 0;
            const formatted = formatFeatureValue(key, value);
            return (
              <li key={key} className="flex items-start gap-2 min-w-0">
                <Check
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    isIncluded
                      ? "text-primary"
                      : "text-muted-foreground opacity-30"
                  }`}
                />
                <span
                  className={`truncate block ${
                    isIncluded ? "" : "text-muted-foreground opacity-50"
                  }`}
                  title={formatted}
                >
                  <span className="font-medium">{FEATURE_LABELS[key]}: </span>
                  {formatted}
                </span>
              </li>
            );
          })}
      </ul>

      <Button
        className="w-full"
        variant={isCurrentPlan ? "outline" : "default"}
        disabled={
          isCurrentPlan || subscribing || !plan.razorpayPlanId || outOfRange
        }
        onClick={() => onSubscribe(plan)}
      >
        {isCurrentPlan
          ? "Current Plan"
          : !plan.razorpayPlanId
            ? "Coming Soon"
            : outOfRange
              ? plan.maxUsers && userCount > plan.maxUsers
                ? `Max ${plan.maxUsers} users`
                : `Min ${minRequired} users`
              : subscribing
                ? "Subscribing…"
                : "Subscribe"}
      </Button>
    </div>
  );
}

function SeatUpdateDialog({
  open,
  onOpenChange,
  currentSeats,
  plan,
  initiateSeatUpdate,
  payForSeatUpdate,
  userEmail,
  activeUserCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSeats: number;
  plan: SubscriptionPlan;
  initiateSeatUpdate: (
    userCount: number,
  ) => Promise<SeatUpdateCheckoutResult>;
  payForSeatUpdate: (
    userCount: number,
    orderId: string,
    razorpayKeyId: string,
    userEmail?: string,
  ) => Promise<boolean>;
  userEmail?: string;
  activeUserCount: number;
}) {
  const [newSeats, setNewSeats] = useState(currentSeats);
  const [newSeatsInput, setNewSeatsInput] = useState(String(currentSeats));
  const [checkout, setCheckout] = useState<Extract<
    SeatUpdateCheckoutResult,
    { requiresPayment: true }
  > | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNewSeats(currentSeats);
      setNewSeatsInput(String(currentSeats));
      setCheckout(null);
      setLocalError(null);
    }
  }, [open, currentSeats]);

  const handleSeatsChange = (raw: string) => {
    setNewSeatsInput(raw);
    const parsed = Number(raw);
    if (raw !== "" && Number.isInteger(parsed)) setNewSeats(parsed);
  };

  // Only rescues a blank/invalid field back to the last valid number on blur —
  // never overwrites a validly-typed value the user chose below the minimum.
  const handleSeatsBlur = () => {
    if (newSeatsInput === "" || !Number.isInteger(Number(newSeatsInput))) {
      setNewSeatsInput(String(newSeats));
    }
  };

  const minSeats = Math.max(plan.minUsers, activeUserCount);
  const maxSeats = plan.maxUsers ?? Infinity;
  const outOfRange = newSeats < minSeats || newSeats > maxSeats;

  const handleContinue = async () => {
    if (isNative()) {
      await openExternal(`${webAppUrl()}/billing`);
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      const result = await initiateSeatUpdate(newSeats);
      if (!result.requiresPayment) {
        toast.success(Messages.billing.seatsUpdated);
        onOpenChange(false);
        return;
      }
      setCheckout(result);
    } catch (err) {
      setLocalError(apiErrorMessage(err, Messages.billing.seatsUpdateFailed));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePay = async () => {
    if (!checkout) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const paid = await payForSeatUpdate(
        newSeats,
        checkout.orderId,
        checkout.razorpayKeyId,
        userEmail,
      );
      if (paid) {
        toast.success(Messages.billing.seatsUpdated);
        onOpenChange(false);
      }
    } catch (err) {
      setLocalError(apiErrorMessage(err, Messages.billing.seatsUpdateFailed));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Seats</DialogTitle>
        </DialogHeader>

        {localError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {localError}
          </div>
        )}

        {!checkout ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">
                Number of seats
              </label>
              <input
                type="number"
                min={minSeats}
                max={plan.maxUsers ?? undefined}
                step={1}
                value={newSeatsInput}
                onChange={(e) => handleSeatsChange(e.target.value)}
                onBlur={handleSeatsBlur}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
              <span
                className={`text-xs mt-1 block ${
                  outOfRange
                    ? "text-destructive font-medium"
                    : "text-muted-foreground"
                }`}
              >
                Minimum {minSeats}
                {plan.maxUsers ? `, maximum ${plan.maxUsers}` : ""} seats
              </span>
            </div>
            <Button
              className="w-full"
              disabled={submitting || outOfRange || newSeats === currentSeats}
              onClick={() => void handleContinue()}
            >
              {submitting ? "Checking…" : "Continue"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-4 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Additional seats
                </span>
                <span className="font-medium">{checkout.additionalSeats}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Days remaining this cycle
                </span>
                <span className="font-medium">{checkout.remainingDays}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-border">
                <span className="text-muted-foreground">Amount due now</span>
                <span className="font-semibold">
                  ₹{checkout.amount.toLocaleString()}
                </span>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={submitting}
              onClick={() => void handlePay()}
            >
              {submitting ? "Processing…" : `Pay ₹${checkout.amount.toLocaleString()}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CurrentPlanCard({
  subscription,
  initiateSeatUpdate,
  payForSeatUpdate,
  userEmail,
  cancel,
  activeUserCount,
}: {
  subscription: NonNullable<ReturnType<typeof useBilling>["subscription"]>;
  initiateSeatUpdate: (
    userCount: number,
  ) => Promise<SeatUpdateCheckoutResult>;
  payForSeatUpdate: (
    userCount: number,
    orderId: string,
    razorpayKeyId: string,
    userEmail?: string,
  ) => Promise<boolean>;
  userEmail?: string;
  cancel: () => Promise<void>;
  activeUserCount: number;
}) {
  const [seatDialogOpen, setSeatDialogOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const statusColors: Record<string, string> = {
    ACTIVE:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    HALTED:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    CREATED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    AUTHENTICATED:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  const handleConfirmCancel = async () => {
    setCancelling(true);
    try {
      await cancel();
      toast.success(Messages.billing.subscriptionCanceled);
      setConfirmCancelOpen(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.billing.cancelFailed));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-6 sm:p-7 mb-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {subscription.plan.name} Plan
            </h2>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                statusColors[subscription.status] ??
                "bg-muted text-muted-foreground"
              }`}
            >
              {subscription.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {subscription.userCount} seat{subscription.userCount > 1 ? "s" : ""}{" "}
            ·{" "}
            {subscription.plan.billingInterval === "ANNUAL"
              ? "Annual billing"
              : "Monthly billing"}
          </p>
          {subscription.currentPeriodEnd && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"}{" "}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          {subscription.cancelAtPeriodEnd && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              Subscription will cancel at end of billing period
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSeatDialogOpen(true)}
          >
            Update Seats
          </Button>
          {!subscription.cancelAtPeriodEnd &&
            subscription.status === "ACTIVE" && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive hover:bg-destructive/10"
                onClick={() => setConfirmCancelOpen(true)}
              >
                Cancel Plan
              </Button>
            )}
        </div>
      </div>

      <SeatUpdateDialog
        open={seatDialogOpen}
        onOpenChange={setSeatDialogOpen}
        currentSeats={subscription.userCount}
        plan={subscription.plan}
        initiateSeatUpdate={initiateSeatUpdate}
        payForSeatUpdate={payForSeatUpdate}
        userEmail={userEmail}
        activeUserCount={activeUserCount}
      />

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel subscription?"
        body="You'll retain access until the end of the billing period."
        confirmLabel="Cancel plan"
        loading={cancelling}
        onConfirm={() => void handleConfirmCancel()}
        onClose={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
}

function AddonCard({
  icon: Icon,
  title,
  description,
  pricePerBundle,
  creditsPerBundle,
  type,
  purchaseAddon,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  pricePerBundle: number;
  creditsPerBundle: number;
  type: AddonType;
  purchaseAddon: (type: AddonType, quantity: number) => Promise<string>;
}) {
  const [qty, setQty] = useState(1);
  const [purchasing, setPurchasing] = useState(false);

  const handleBuy = async () => {
    setPurchasing(true);
    try {
      const link = await purchaseAddon(type, qty);
      await openExternal(link);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.billing.addonFailed));
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-4 hover:border-primary/40 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="text-sm">
        <span className="font-bold text-lg">
          ₹{pricePerBundle.toLocaleString()}
        </span>
        <span className="text-muted-foreground">
          {" "}
          / {creditsPerBundle.toLocaleString()} credits
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs text-muted-foreground">Bundles:</label>
          <input
            type="number"
            min={1}
            max={100}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            className="w-20 h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <Button size="sm" disabled={purchasing} onClick={() => void handleBuy()}>
          {purchasing ? "Processing…" : `Buy ₹${(pricePerBundle * qty).toLocaleString()}`}
        </Button>
      </div>
    </div>
  );
}

function TrialCard({ trialStatus }: { trialStatus: TrialStatus | null }) {
  const isCurrent = trialStatus?.planStatus === "TRIAL";
  const isExpired = trialStatus?.isExpired ?? false;
  return (
    <div
      className={`relative rounded-xl border bg-card p-6 flex flex-col gap-4 ${
        isCurrent ? "border-green-500 ring-1 ring-green-500" : "border-border"
      }`}
    >
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-green-500 text-white text-xs px-3">
            Current Plan
          </Badge>
        </div>
      )}
      <div>
        <h3 className="text-lg font-semibold">Free Trial</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          No card required
        </p>
      </div>
      <div className="flex items-baseline gap-1">
        {isExpired ? (
          <span className="text-xl font-bold text-muted-foreground">
            Trial ended
          </span>
        ) : (trialStatus?.daysRemaining ?? 14) > 3650 ? (
          <span className="text-xl font-bold">No expiry</span>
        ) : (
          <>
            <span className="text-3xl font-bold">
              {trialStatus?.daysRemaining ?? 14}
            </span>
            <span className="text-sm text-muted-foreground">days left</span>
          </>
        )}
      </div>
      <ul className="space-y-2 flex-1 text-sm">
        {["Everything unlocked", "Cancel anytime", "No credit card needed"].map(
          (item) => (
            <li key={item} className="flex items-start gap-2 min-w-0">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ),
        )}
      </ul>
      <Button className="w-full" variant="outline" disabled>
        {isCurrent ? "Current Plan" : "Trial"}
      </Button>
    </div>
  );
}

export default function BillingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    plans,
    subscription,
    invoices,
    activeUserCount,
    trialStatus,
    loading,
    error,
    pendingActivation,
    activationError,
    clearActivationError,
    subscribe,
    initiateSeatUpdate,
    payForSeatUpdate,
    cancel,
    purchaseAddon,
  } = useBilling();

  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>("MONTHLY");
  const defaultSeats = subscription?.userCount ?? activeUserCount;
  const [seats, setSeats] = useState(defaultSeats);
  const [seatsInput, setSeatsInput] = useState(String(defaultSeats));
  const [seatsTouched, setSeatsTouched] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<CouponDetails | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "upi">("card");

  useEffect(() => {
    if (!seatsTouched) {
      setSeats(defaultSeats);
      setSeatsInput(String(defaultSeats));
    }
  }, [defaultSeats, seatsTouched]);

  const handleSeatsChange = (raw: string) => {
    setSeatsTouched(true);
    setSeatsInput(raw);
    const parsed = Number(raw);
    if (raw !== "" && !Number.isNaN(parsed)) setSeats(parsed);
  };

  // Only rescues a blank/invalid field back to the last valid number on blur —
  // never overwrites a validly-typed value the user chose below the minimum,
  // so typing e.g. "2" stays "2" instead of silently jumping to the minimum.
  const handleSeatsBlur = () => {
    if (seatsInput === "" || Number.isNaN(Number(seatsInput))) {
      setSeatsInput(String(seats));
    }
  };

  const seatsBelowMin = seats < activeUserCount;

  async function handleApplyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      const result = await validateCoupon(code);
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

  // The Trial row (tier: 'trial') isn't purchasable — it exists so Trial's limits
  // live in the DB, same as every paid plan, instead of a hardcoded constant.
  const filteredPlans = plans.filter(
    (p) => p.billingInterval === billingInterval && p.tier !== "trial",
  );

  const handleSubscribe = async (plan: SubscriptionPlan) => {
    // The embedded Razorpay checkout can't run inside the native shell (and keeps
    // in-app digital purchases out of the store build). Send the user to the web
    // billing page in the system browser to complete payment there.
    if (isNative()) {
      await openExternal(`${webAppUrl()}/billing`);
      return;
    }
    setSubscribing(true);
    try {
      const { paid } = await subscribe(
        plan,
        seats,
        billingInterval,
        user?.email,
        couponApplied?.code,
        couponApplied ? paymentMethod : undefined,
      );
      if (paid) {
        toast.success(Messages.billing.subscriptionActivating);
        setCouponApplied(null);
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.billing.subscriptionFailed));
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <Header title="Billing" subtitle="Manage your subscription and add-ons" />

      <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-8 sm:space-y-10">
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="hidden lg:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors -mt-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Pending activation banner */}
        {pendingActivation && (
          <div className="rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm px-4 py-3 flex items-center gap-3">
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
            <span>
              <span className="font-semibold">Activating your subscription…</span>{" "}
              This usually takes a few seconds. Hang tight!
            </span>
          </div>
        )}

        {/* Load-error state (initial fetch only) */}
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Background activation-confirmation failure (subscribe's Razorpay handler) */}
        {activationError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{activationError}</span>
            <button
              onClick={clearActivationError}
              className="flex-shrink-0 hover:opacity-70"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Current subscription */}
        {loading ? (
          <Skeleton className="h-36 rounded-xl" />
        ) : subscription ? (
          <CurrentPlanCard
            subscription={subscription}
            initiateSeatUpdate={initiateSeatUpdate}
            payForSeatUpdate={payForSeatUpdate}
            userEmail={user?.email}
            cancel={cancel}
            activeUserCount={activeUserCount}
          />
        ) : null}

        {/* Plan comparison */}
        <section>
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold">
                {subscription ? "Change Plan" : "Choose a Plan"}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Billed per user. Add seats as your team grows.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 sm:flex-wrap">
              {/* Seats selector */}
              <div className="flex flex-col gap-1 text-sm bg-muted/40 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <label className="text-muted-foreground">Users:</label>
                  <input
                    type="number"
                    min={activeUserCount}
                    value={seatsInput}
                    onChange={(e) => handleSeatsChange(e.target.value)}
                    onBlur={handleSeatsBlur}
                    className="w-20 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <span
                  className={`text-xs ${
                    seatsBelowMin
                      ? "text-destructive font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  Minimum {activeUserCount} — your active team size
                </span>
              </div>

              {/* Coupon code */}
              <div className="flex flex-col gap-1 text-sm bg-muted/40 rounded-lg px-3 py-2 sm:min-w-[220px]">
                <Label htmlFor="billing-coupon" className="text-muted-foreground">
                  Coupon code
                </Label>
                {couponApplied ? (
                  <div className="flex items-center justify-between rounded-md border border-green-500/40 bg-green-50 dark:bg-green-950/30 px-2 py-1.5 text-xs">
                    <span className="text-green-700 dark:text-green-400 font-medium truncate" title={`${couponApplied.code} — ${couponApplied.label}`}>
                      {couponApplied.code} — {couponApplied.label}
                    </span>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="flex-shrink-0 ml-2 text-muted-foreground hover:text-foreground underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="billing-coupon"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder="e.g. WELCOMEOFFER"
                      className="h-9 text-sm uppercase"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={couponLoading || !couponInput.trim()}
                      onClick={() => void handleApplyCoupon()}
                    >
                      {couponLoading ? "…" : "Apply"}
                    </Button>
                  </div>
                )}
                {couponError && !couponApplied && (
                  <p className="text-xs text-destructive">{couponError}</p>
                )}
                {couponApplied && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-xs text-muted-foreground">Pay via</span>
                    <div className="inline-flex rounded-md border border-input p-0.5">
                      {(["card", "upi"] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`px-2.5 py-1 text-xs font-medium rounded ${
                            paymentMethod === method
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          {method === "card" ? "Card" : "UPI"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Monthly / Annual toggle */}
              <div className="flex items-center rounded-lg border border-border overflow-hidden text-sm">
                <button
                  onClick={() => setBillingInterval("MONTHLY")}
                  className={`px-4 py-2 max-[767px]:min-h-11 transition-colors ${
                    billingInterval === "MONTHLY"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingInterval("ANNUAL")}
                  className={`px-4 py-2 max-[767px]:min-h-11 transition-colors ${
                    billingInterval === "ANNUAL"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Annual
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <Skeleton className="h-80 rounded-xl max-w-sm mx-auto" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(280px,320px))] justify-center gap-4 pt-3">
              {!subscription && <TrialCard trialStatus={trialStatus} />}
              {filteredPlans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrentPlan={
                    subscription?.planId === plan.id &&
                    subscription.status === "ACTIVE"
                  }
                  billingInterval={billingInterval}
                  userCount={seats}
                  activeUserCount={activeUserCount}
                  onSubscribe={(p) => void handleSubscribe(p)}
                  subscribing={subscribing}
                />
              ))}
            </div>
          )}
        </section>

        {/* Add-ons */}
        {(subscription?.status === "ACTIVE" ||
          subscription?.status === "AUTHENTICATED") && (
          <section>
            <h2 className="text-lg sm:text-xl font-semibold mb-1">Add-ons</h2>
            <p className="text-sm text-muted-foreground mb-4">
              One-time credit bundles. Credits never expire.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AddonCard
                icon={Mail}
                title="Email Credits"
                description="Send bulk emails to leads"
                pricePerBundle={200}
                creditsPerBundle={5000}
                type="EMAIL_CREDITS"
                purchaseAddon={purchaseAddon}
              />
              <AddonCard
                icon={MessageSquare}
                title="WhatsApp Credits"
                description="Send WhatsApp Business messages"
                pricePerBundle={1000}
                creditsPerBundle={1000}
                type="WHATSAPP_CREDITS"
                purchaseAddon={purchaseAddon}
              />
            </div>
          </section>
        )}

        {/* Billing history */}
        <section>
          <h2 className="text-lg sm:text-xl font-semibold mb-4">Billing History</h2>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              No billing events yet.
            </div>
          ) : (
            <>
              <div className="rounded-xl border overflow-hidden hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Event
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Payment ID
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="bg-card hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 capitalize">
                        {inv.event
                          .replace("subscription.", "")
                          .replace(".", " ")}
                      </td>
                      <td className="px-4 py-3 text-right font-medium font-mono">
                        {inv.amount != null
                          ? `₹${inv.amount.toLocaleString()}`
                          : "—"}
                      </td>
                      <td
                        className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[160px]"
                        title={inv.razorpayPaymentId ?? ""}
                      >
                        {inv.razorpayPaymentId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {/* Mobile invoice cards — same data as the table above */}
              <div className="md:hidden space-y-2">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="bg-card border border-card-border rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize">
                          {inv.event
                            .replace("subscription.", "")
                            .replace(".", " ")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-foreground flex-shrink-0">
                        {inv.amount != null
                          ? `₹${inv.amount.toLocaleString()}`
                          : "—"}
                      </span>
                    </div>
                    <p
                      className="text-xs text-muted-foreground font-mono truncate mt-2"
                      title={inv.razorpayPaymentId ?? ""}
                    >
                      {inv.razorpayPaymentId ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
