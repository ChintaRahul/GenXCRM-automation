import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PlanPaymentStep } from "../components/register/PlanPaymentStep";
import type { SubscriptionPlan } from "../types";

vi.mock("../api/client", () => ({ validateCoupon: vi.fn() }));

const trialPlan: SubscriptionPlan = {
  id: "plan-trial",
  name: "Free Trial",
  slug: "trial",
  tier: "trial",
  pricePerUser: 0,
  setupFee: 0,
  billingInterval: "MONTHLY",
  razorpayPlanId: null,
  minUsers: 1,
  maxUsers: null,
  features: {
    leads: 100,
    teams: 1,
    users: 5,
    sequences: 2,
    emailCredits: 1000,
    advancedReports: true,
    whatsappCredits: 0,
  },
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const proPlan: SubscriptionPlan = {
  id: "plan-pro-monthly",
  name: "GenXCRM Pro",
  slug: "pro-monthly",
  tier: "pro",
  pricePerUser: 499,
  setupFee: 5000,
  billingInterval: "MONTHLY",
  razorpayPlanId: "plan_rzp_123",
  minUsers: 5,
  maxUsers: null,
  features: {
    leads: 10000,
    teams: 10,
    users: -1,
    sequences: 10,
    emailCredits: 10000,
    advancedReports: true,
    whatsappCredits: 1000,
  },
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const defaultProps = {
  plans: [trialPlan] as SubscriptionPlan[],
  plansLoading: false,
  trialDays: 14,
  submitting: false,
  submitError: "",
  onBack: vi.fn(),
  onSubmit: vi.fn(),
};

function renderStep(props: Partial<typeof defaultProps> = {}) {
  return render(
    <MemoryRouter>
      <PlanPaymentStep {...defaultProps} {...props} />
    </MemoryRouter>,
  );
}

describe("PlanPaymentStep", () => {
  it("disables the submit button until the terms checkbox is checked", () => {
    renderStep();
    const submit = screen.getByRole("button", { name: "Start 14-day free trial" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).not.toBeDisabled();
  });

  it("includes acceptedTerms: true in the submitted selection once checked and submitted", () => {
    const onSubmit = vi.fn();
    renderStep({ onSubmit });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day free trial" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedTerms: true }),
    );
  });

  it("links to the plan limits section of the Terms page", () => {
    renderStep();
    const link = screen.getByRole("link", { name: /terms of service/i });
    expect(link).toHaveAttribute("href", "/terms#plan-limits");
  });

  it("shows all 7 categories with the real trial values", () => {
    renderStep();
    expect(screen.getByText(/^leads: 100$/i)).toBeInTheDocument();
    expect(screen.getByText(/^teams: 1$/i)).toBeInTheDocument();
    expect(screen.getByText(/^users: 5$/i)).toBeInTheDocument();
    expect(screen.getByText(/^nurturing sequences: 2$/i)).toBeInTheDocument();
    expect(screen.getByText(/^email credits\/mo: 1,000$/i)).toBeInTheDocument();
    expect(screen.getByText(/^advanced reports: included$/i)).toBeInTheDocument();
    expect(screen.getByText(/^whatsapp credits \(one-time\): 0$/i)).toBeInTheDocument();
    expect(screen.queryByText(/call recording/i)).not.toBeInTheDocument();
  });

  it("shows all 7 categories with the real Pro plan values", () => {
    renderStep({ plans: [trialPlan, proPlan] });
    expect(screen.getByText(/^leads: 10,000$/i)).toBeInTheDocument();
    expect(screen.getByText(/^teams: 10$/i)).toBeInTheDocument();
    expect(screen.getByText(/^users: unlimited$/i)).toBeInTheDocument();
    expect(screen.getByText(/^nurturing sequences: 10$/i)).toBeInTheDocument();
    expect(screen.getByText(/^email credits\/mo: 10,000$/i)).toBeInTheDocument();
    expect(screen.getByText(/^whatsapp credits \(one-time\): 1,000$/i)).toBeInTheDocument();
    // Advanced reports is identical text on both the trial and Pro cards
    // ("Included" either way) — assert both instances render.
    expect(screen.getAllByText(/^advanced reports: included$/i)).toHaveLength(2);
    expect(screen.queryByText(/call recording/i)).not.toBeInTheDocument();
    // The Trial row (tier: 'trial') is a DB source for the special trial card's
    // features, not a purchasable tier — its plan name must never render as one.
    expect(screen.queryByText("Free Trial")).not.toBeInTheDocument();
  });
});
