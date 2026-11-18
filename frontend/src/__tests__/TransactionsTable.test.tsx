import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TransactionsTable } from "../components/payments/TransactionsTable";
import * as paymentsHook from "../hooks/usePayments";
import type { Payment } from "../types";

function renderTable() {
  return render(
    <MemoryRouter>
      <TransactionsTable />
    </MemoryRouter>,
  );
}

vi.mock("../hooks/usePayments");

const emptyReturn = { data: null, loading: false, error: null, refetch: vi.fn() };

const mockPayment: Payment = {
  id: "pay-1",
  amount: 98000,
  currency: "INR",
  status: "PAID",
  gateway: "RAZORPAY",
  installments: [],
  lead: { id: "lead-1", name: "Sneha Patel", course: "Digital Marketing" },
  createdAt: new Date().toISOString(),
};

describe("TransactionsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading", () => {
    vi.mocked(paymentsHook.usePaymentsList).mockReturnValue(emptyReturn);
    renderTable();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
  });

  it("renders a row for each payment", () => {
    vi.mocked(paymentsHook.usePaymentsList).mockReturnValue({
      ...emptyReturn,
      data: { data: [mockPayment], total: 1, page: 1, limit: 20, pages: 1 },
    });
    renderTable();
    // Desktop table and mobile card list both render in jsdom (no real viewport),
    // so the same data appears twice — assert on the pair rather than a single match.
    expect(screen.getAllByText("Sneha Patel")).toHaveLength(2);
    expect(screen.getAllByText("₹98,000")).toHaveLength(2);
  });

  it("shows an empty state when there are no payments", () => {
    vi.mocked(paymentsHook.usePaymentsList).mockReturnValue({
      ...emptyReturn,
      data: { data: [], total: 0, page: 1, limit: 20, pages: 0 },
    });
    renderTable();
    expect(screen.getByText("No payments yet")).toBeInTheDocument();
  });
});
