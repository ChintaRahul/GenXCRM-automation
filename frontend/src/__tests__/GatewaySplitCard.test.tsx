import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GatewaySplitCard } from "../components/payments/GatewaySplitCard";
import * as paymentsHook from "../hooks/usePayments";

vi.mock("../hooks/usePayments");

const emptyReturn = { data: null, loading: false, error: null, refetch: vi.fn() };

describe("GatewaySplitCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when no gateway data exists", () => {
    vi.mocked(paymentsHook.usePaymentDashboard).mockReturnValue({
      ...emptyReturn,
      data: { byGateway: [] },
    });
    render(<GatewaySplitCard />);
    expect(screen.getByText("No payments collected yet")).toBeInTheDocument();
  });

  it("renders a row per gateway with total and percentage", () => {
    vi.mocked(paymentsHook.usePaymentDashboard).mockReturnValue({
      ...emptyReturn,
      data: {
        byGateway: [
          { gateway: "RAZORPAY", total: 1180000, pct: 64 },
          { gateway: "STRIPE", total: 400000, pct: 22 },
        ],
      },
    });
    render(<GatewaySplitCard />);
    expect(screen.getByText("Razorpay")).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
  });
});
