import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import BillingPage from "../pages/Billing";
import * as billingHook from "../hooks/useBilling";
import * as authCtx from "../context/AuthContext";
import type { User } from "../types";

vi.mock("../hooks/useBilling");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockUser: User = {
  id: "u1",
  name: "Dana Director",
  email: "dana@co.com",
  role: "DIRECTOR",
  teamId: null,
  orgId: "org-1",
};

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

function baseBillingValue(
  overrides: Partial<ReturnType<typeof billingHook.useBilling>> = {},
): ReturnType<typeof billingHook.useBilling> {
  return {
    plans: [mockPlan],
    subscription: mockSub,
    invoices: [],
    activeUserCount: 3,
    trialStatus: null,
    loading: false,
    error: null,
    pendingActivation: false,
    activationError: null,
    clearActivationError: vi.fn(),
    refetch: vi.fn(),
    subscribe: vi.fn(),
    initiateSeatUpdate: vi.fn(),
    payForSeatUpdate: vi.fn(),
    cancel: vi.fn(),
    purchaseAddon: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BillingPage />
    </MemoryRouter>,
  );
}

describe("BillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockUser,
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
  });

  it("never shows the Trial row (tier: 'trial') as a purchasable plan card", () => {
    const trialPlan = {
      ...mockPlan,
      id: "plan-trial",
      name: "Free Trial",
      slug: "trial",
      tier: "trial",
      razorpayPlanId: null,
    };
    vi.mocked(billingHook.useBilling).mockReturnValue(
      baseBillingValue({ plans: [trialPlan, mockPlan] }),
    );
    renderPage();

    expect(screen.queryByText("Free Trial")).not.toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
  });

  it("rejects a decimal seat count in the Update Seats dialog (integer enforcement)", () => {
    vi.mocked(billingHook.useBilling).mockReturnValue(baseBillingValue());
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update Seats" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "2.5" } });

    // Decimal input never gets committed as a valid integer seat count — the
    // Continue button stays disabled because the underlying value still equals
    // currentSeats (3), which is excluded by the "=== currentSeats" disable rule.
    const continueBtn = within(dialog).getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeDisabled();
  });

  it("cancel plan flow: opens confirm dialog, calls cancel only on confirm, and shows success toast only after it resolves", async () => {
    const { toast } = await import("sonner");
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.mocked(billingHook.useBilling).mockReturnValue(baseBillingValue({ cancel }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Cancel Plan" }));
    expect(screen.getByText("Cancel subscription?")).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /cancel plan…?/i }));

    await waitFor(() => expect(cancel).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("cancel plan flow: shows an error toast, not a success toast, when cancel() rejects", async () => {
    const { toast } = await import("sonner");
    const cancel = vi.fn().mockRejectedValue(new Error("server error"));
    vi.mocked(billingHook.useBilling).mockReturnValue(baseBillingValue({ cancel }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Cancel Plan" }));
    fireEvent.click(screen.getByRole("button", { name: /cancel plan…?/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("addon card: shows a per-card 'Processing…' label while purchasing, independent of other actions", async () => {
    let resolvePurchase: (link: string) => void = () => {};
    const purchaseAddon = vi.fn(
      () => new Promise<string>((resolve) => (resolvePurchase = resolve)),
    );
    vi.mocked(billingHook.useBilling).mockReturnValue(baseBillingValue({ purchaseAddon }));
    renderPage();

    const buyButtons = screen.getAllByRole("button", { name: /^buy ₹/i });
    fireEvent.click(buyButtons[0]);

    await waitFor(() => expect(screen.getAllByText("Processing…").length).toBeGreaterThan(0));
    // The Cancel Plan button is unaffected — it's not disabled by the addon purchase in flight.
    expect(screen.getByRole("button", { name: "Cancel Plan" })).not.toBeDisabled();

    resolvePurchase("https://rzp.io/l/addon");
    await waitFor(() => expect(purchaseAddon).toHaveBeenCalled());
  });
});
