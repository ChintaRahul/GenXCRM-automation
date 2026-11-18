import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpcomingEmisCard } from "../components/payments/UpcomingEmisCard";
import * as paymentsHook from "../hooks/usePayments";

vi.mock("../hooks/usePayments");

const emptyReturn = { data: null, loading: false, error: null, refetch: vi.fn() };

describe("UpcomingEmisCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no upcoming installments", () => {
    vi.mocked(paymentsHook.useUpcomingInstallments).mockReturnValue({
      ...emptyReturn,
      data: [],
    });
    render(<UpcomingEmisCard />);
    expect(
      screen.getByText("No installments due in the next 14 days"),
    ).toBeInTheDocument();
  });

  it("renders a row per installment with the EMI count", () => {
    vi.mocked(paymentsHook.useUpcomingInstallments).mockReturnValue({
      ...emptyReturn,
      data: [
        {
          id: "inst-1",
          paymentId: "pay-1",
          amount: 17250,
          dueDate: new Date().toISOString(),
          lead: { id: "lead-1", name: "Riya Bansal", course: "Data Science" },
          emiNumber: 3,
          totalEmis: 6,
        },
      ],
    });
    render(<UpcomingEmisCard />);
    expect(screen.getByText("Riya Bansal")).toBeInTheDocument();
    expect(screen.getByText("EMI 3 of 6")).toBeInTheDocument();
  });
});
