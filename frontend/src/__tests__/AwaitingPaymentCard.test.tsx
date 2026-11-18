import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AwaitingPaymentCard } from "../components/payments/AwaitingPaymentCard";
import * as paymentsHook from "../hooks/usePayments";
import type { Payment } from "../types";

vi.mock("../hooks/usePayments");

const emptyReturn = { data: null, loading: false, error: null, refetch: vi.fn() };

const mockPayment: Payment = {
  id: "pay-1",
  amount: 98000,
  currency: "INR",
  status: "LINK_SENT",
  gateway: "RAZORPAY",
  paymentLink: "https://rzp.io/l/abc123",
  installments: [],
  lead: { id: "lead-1", name: "Vikram Singh", course: "Cloud & DevOps" },
};

describe("AwaitingPaymentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there is no pending payment", () => {
    vi.mocked(paymentsHook.usePaymentsList).mockReturnValue({
      ...emptyReturn,
      data: { data: [], total: 0, page: 1, limit: 1, pages: 0 },
    });
    const { container } = render(<AwaitingPaymentCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the awaiting lead and payment link", () => {
    vi.mocked(paymentsHook.usePaymentsList).mockReturnValue({
      ...emptyReturn,
      data: { data: [mockPayment], total: 1, page: 1, limit: 1, pages: 1 },
    });
    render(<AwaitingPaymentCard />);
    expect(screen.getByText("Vikram Singh")).toBeInTheDocument();
    expect(screen.getByText("Open link")).toBeInTheDocument();
  });
});
