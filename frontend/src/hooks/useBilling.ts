import { useState, useEffect, useCallback, useRef } from "react";
import type {
  SubscriptionPlan,
  OrgSubscription,
  BillingEvent,
  BillingInterval,
  AddonType,
  TrialStatus,
} from "../types";
import * as api from "../api/client";
import { notifyPlanActivated } from "../lib/planEvents";
import { loadRazorpayScript } from "../lib/razorpay";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useBilling() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscription, setSubscription] = useState<OrgSubscription | null>(
    null,
  );
  const [invoices, setInvoices] = useState<BillingEvent[]>([]);
  const [activeUserCount, setActiveUserCount] = useState(1);
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActivation, setPendingActivation] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(
    null,
  );
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptsRef = useRef(0);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [plansData, subData, invoicesData, activeUsers, trial] = await Promise.all([
        api.getBillingPlans(),
        api.getSubscription(),
        api.getBillingInvoices(),
        api.getActiveUserCount(),
        api.getTrialStatus(),
      ]);
      setPlans(plansData);
      setSubscription(subData);
      setInvoices(invoicesData);
      setActiveUserCount(Math.max(1, activeUsers));
      setTrialStatus(trial);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.billing));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const startActivationPolling = useCallback(() => {
    setPendingActivation(true);
    pollAttemptsRef.current = 0;

    const poll = async () => {
      pollAttemptsRef.current += 1;
      try {
        const trialStatus = await api.getTrialStatus();
        if (trialStatus.planStatus === "ACTIVE") {
          setPendingActivation(false);
          notifyPlanActivated();
          await fetchAll();
          return;
        }
      } catch {
        // ignore poll errors
      }
      if (pollAttemptsRef.current < 10) {
        pollTimerRef.current = setTimeout(() => void poll(), 3000);
      } else {
        setPendingActivation(false);
      }
    };

    pollTimerRef.current = setTimeout(() => void poll(), 2000);
  }, [fetchAll]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const subscribe = useCallback(
    async (
      plan: SubscriptionPlan,
      userCount: number,
      billingInterval: BillingInterval,
      userEmail?: string,
      couponCode?: string,
      paymentMethod?: "card" | "upi",
    ): Promise<{ paid: boolean }> => {
      let paid = false;
      await loadRazorpayScript();
      const { subscriptionId, razorpayKeyId } = await api.createSubscription({
        planId: plan.id,
        userCount,
        billingInterval,
        couponCode,
        paymentMethod,
      });

      await new Promise<void>((resolve) => {
        const rzp = new window.Razorpay({
          key: razorpayKeyId,
          subscription_id: subscriptionId,
          name: "GenXCRM",
          description: `${plan.name} — ${userCount} seat${userCount > 1 ? "s" : ""}`,
          prefill: { email: userEmail },
          theme: { color: "#6366f1" },
          // A coupon's discount may have been resolved against a specific Razorpay
          // Offer scoped to this exact payment method (BillingService.getOfferId) —
          // lock checkout to it so the customer can't pick a different method the
          // Offer wasn't created for, which would silently drop the discount.
          ...(paymentMethod && {
            method: {
              card: paymentMethod === "card",
              upi: paymentMethod === "upi",
              netbanking: false,
              wallet: false,
              paylater: false,
            },
          }),
          handler: (response) => {
            paid = true;
            api
              .confirmSubscriptionPayment({
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySubscriptionId:
                  response.razorpay_subscription_id ?? subscriptionId,
              })
              .then(() => fetchAll())
              .catch((err) => {
                setActivationError(
                  apiErrorMessage(err, Messages.billing.subscriptionFailed),
                );
                void fetchAll();
              })
              .finally(() => resolve());
          },
          modal: { ondismiss: () => resolve() },
        });
        rzp.open();
      });

      if (paid) startActivationPolling();
      return { paid };
    },
    [fetchAll, startActivationPolling],
  );

  const initiateSeatUpdate = useCallback(
    async (userCount: number): Promise<api.SeatUpdateCheckoutResult> => {
      const result = await api.checkoutSeatUpdate(userCount);
      if (!result.requiresPayment) {
        setSubscription((prev) =>
          prev ? { ...prev, ...result.subscription } : result.subscription,
        );
      }
      return result;
    },
    [],
  );

  const payForSeatUpdate = useCallback(
    async (
      userCount: number,
      orderId: string,
      razorpayKeyId: string,
      userEmail?: string,
    ): Promise<boolean> => {
      let paid = false;
      let payError: unknown;
      await loadRazorpayScript();

      await new Promise<void>((resolve) => {
        const rzp = new window.Razorpay({
          key: razorpayKeyId,
          order_id: orderId,
          name: "GenXCRM",
          description: `Add seats — ${userCount} total`,
          prefill: { email: userEmail },
          theme: { color: "#6366f1" },
          method: { card: true, upi: true, netbanking: false, wallet: false, paylater: false },
          handler: (response) => {
            api
              .confirmSeatUpdate({
                userCount,
                razorpayOrderId: response.razorpay_order_id ?? orderId,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature ?? "",
              })
              .then((updated) => {
                paid = true;
                setSubscription((prev) =>
                  prev ? { ...prev, ...updated } : updated,
                );
              })
              .catch((err) => {
                payError = err;
              })
              .finally(() => resolve());
          },
          modal: { ondismiss: () => resolve() },
        });
        rzp.open();
      });

      if (payError) throw payError;
      return paid;
    },
    [],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const updated = await api.cancelSubscription();
    setSubscription((prev) => (prev ? { ...prev, ...updated } : updated));
  }, []);

  const purchaseAddon = useCallback(
    async (type: AddonType, quantity: number): Promise<string> => {
      const result = await api.purchaseAddon({ type, quantity });
      void fetchAll();
      return result.paymentLink;
    },
    [fetchAll],
  );

  const clearActivationError = useCallback(() => setActivationError(null), []);

  return {
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
    refetch: fetchAll,
    subscribe,
    initiateSeatUpdate,
    payForSeatUpdate,
    cancel,
    purchaseAddon,
  };
}
