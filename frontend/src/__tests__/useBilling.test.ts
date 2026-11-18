import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useBilling } from "../hooks/useBilling";
import * as client from "../api/client";
import { Messages } from "../lib/messages";
import type { RazorpayCheckoutOptions, RazorpayInstance } from "../lib/razorpay";

vi.mock("../api/client");

const mockPlan = {
  id: "plan-1",
  name: "Starter",
  slug: "starter-monthly",
  tier: "starter",
  pricePerUser: 499,
  setupFee: 0,
  billingInterval: "MONTHLY" as const,
  razorpayPlanId: "plan_rzp_123",
  minUsers: 1,
  maxUsers: 5,
  features: {} as never,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const mockSub = {
  id: "sub-1",
  orgId: "org-1",
  planId: "plan-1",
  plan: mockPlan,
  status: "ACTIVE" as const,
  razorpaySubId: "sub_rzp_123",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  userCount: 3,
  addons: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockRazorpayConstructor(
  onOpen: (opts: RazorpayCheckoutOptions) => void,
) {
  window.Razorpay = vi.fn().mockImplementation((opts: RazorpayCheckoutOptions) => {
    const instance: RazorpayInstance = {
      open: () => onOpen(opts),
      close: () => {},
    };
    return instance;
  }) as unknown as typeof window.Razorpay;
}

describe("useBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error -- test cleanup between cases
    delete window.Razorpay;
  });

  const mockFetchAllSuccess = () => {
    vi.mocked(client.getBillingPlans).mockResolvedValue([mockPlan]);
    vi.mocked(client.getSubscription).mockResolvedValue(mockSub);
    vi.mocked(client.getBillingInvoices).mockResolvedValue([]);
    vi.mocked(client.getActiveUserCount).mockResolvedValue(0);
    vi.mocked(client.getTrialStatus).mockResolvedValue({
      planStatus: "ACTIVE",
      trialEndsAt: "2026-01-01T00:00:00.000Z",
      daysRemaining: 0,
      isExpired: false,
      limits: { leads: 0, users: 0, sequences: 0, teams: 0 },
      usage: { leads: 0, users: 0, sequences: 0, teams: 0 },
    });
  };

  it("fetches plans/subscription/invoices/active users on mount", async () => {
    mockFetchAllSuccess();
    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans).toHaveLength(1);
    expect(result.current.subscription).toEqual(mockSub);
    expect(result.current.error).toBeNull();
    // clamps 0 active users to a minimum of 1
    expect(result.current.activeUserCount).toBe(1);
  });

  it("sets load error when fetchAll fails", async () => {
    vi.mocked(client.getBillingPlans).mockRejectedValue(new Error("network"));
    vi.mocked(client.getSubscription).mockResolvedValue(null);
    vi.mocked(client.getBillingInvoices).mockResolvedValue([]);
    vi.mocked(client.getActiveUserCount).mockResolvedValue(1);

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.billing);
  });

  it("initiateSeatUpdate returns the checkout result and merges subscription on no-payment path", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.checkoutSeatUpdate).mockResolvedValue({
      requiresPayment: false,
      subscription: { ...mockSub, userCount: 4 },
    });

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let seatResult;
    await act(async () => {
      seatResult = await result.current.initiateSeatUpdate(4);
    });
    expect(seatResult).toEqual({ requiresPayment: false, subscription: { ...mockSub, userCount: 4 } });
    expect(result.current.subscription?.userCount).toBe(4);
  });

  it("initiateSeatUpdate throws (does not swallow) on failure — regression test for the shared-error bug", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.checkoutSeatUpdate).mockRejectedValue(new Error("out of range"));

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.initiateSeatUpdate(999)).rejects.toThrow();
  });

  it("cancel updates the subscription on success", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.cancelSubscription).mockResolvedValue({ ...mockSub, cancelAtPeriodEnd: true });

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.subscription?.cancelAtPeriodEnd).toBe(true);
  });

  it("cancel throws on failure — regression test for the unconditional success-toast bug", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.cancelSubscription).mockRejectedValue(new Error("server error"));

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.cancel()).rejects.toThrow();
  });

  it("purchaseAddon returns the payment link on success", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.purchaseAddon).mockResolvedValue({
      paymentLink: "https://rzp.io/l/addon",
      totalPrice: 500,
      totalCredits: 5000,
    });

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let link;
    await act(async () => {
      link = await result.current.purchaseAddon("EMAIL_CREDITS", 1);
    });
    expect(link).toBe("https://rzp.io/l/addon");
  });

  it("purchaseAddon throws on failure", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.purchaseAddon).mockRejectedValue(new Error("checkout failed"));

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.purchaseAddon("EMAIL_CREDITS", 1)).rejects.toThrow();
  });

  it("subscribe surfaces a failed confirm as activationError instead of swallowing it", async () => {
    mockFetchAllSuccess();
    vi.mocked(client.createSubscription).mockResolvedValue({
      subscriptionId: "sub_rzp_new",
      razorpayKeyId: "rzp_test",
    });
    vi.mocked(client.confirmSubscriptionPayment).mockRejectedValue(new Error("confirm failed"));

    mockRazorpayConstructor((opts) => {
      opts.handler({ razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_rzp_new" });
    });

    const { result } = renderHook(() => useBilling());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.subscribe(mockPlan, 3, "MONTHLY", "a@b.com");
    });

    await waitFor(() => expect(result.current.activationError).toBeTruthy());

    act(() => {
      result.current.clearActivationError();
    });
    expect(result.current.activationError).toBeNull();
  });
});
