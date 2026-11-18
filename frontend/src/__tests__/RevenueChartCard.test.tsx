import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RevenueChartCard } from "../components/payments/RevenueChartCard";
import * as paymentsHook from "../hooks/usePayments";

vi.mock("../hooks/usePayments");

const emptyReturn = { data: null, loading: false, error: null, refetch: vi.fn() };

describe("RevenueChartCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading", () => {
    vi.mocked(paymentsHook.useRevenueMonthly).mockReturnValue(emptyReturn);
    render(<RevenueChartCard />);
    expect(screen.getByText("Revenue · last 6 months")).toBeInTheDocument();
  });

  it("renders a bar per month and highlights the current month", () => {
    vi.mocked(paymentsHook.useRevenueMonthly).mockReturnValue({
      ...emptyReturn,
      data: [
        { month: "Jul 2026", revenue: 100000, isCurrent: false },
        { month: "Aug 2026", revenue: 200000, isCurrent: true },
      ],
    });
    render(<RevenueChartCard />);
    expect(screen.getByText("Jul")).toBeInTheDocument();
    expect(screen.getByText("Aug")).toBeInTheDocument();
  });

  it("shows an empty state when there is no revenue", () => {
    vi.mocked(paymentsHook.useRevenueMonthly).mockReturnValue({
      ...emptyReturn,
      data: [],
    });
    render(<RevenueChartCard />);
    expect(screen.getByText("No revenue yet")).toBeInTheDocument();
  });
});
