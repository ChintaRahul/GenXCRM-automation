import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DealValueCard } from "../components/leadDetail/DealValueCard";
import type { Lead } from "../types";

const baseLead: Lead = {
  id: "lead-1",
  name: "Sneha Patel",
  phone: "+919876543210",
  source: "INSTAGRAM",
  stage: "INTERESTED",
  score: 80,
  interestedCount: 1,
  tags: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  activities: [{ id: "a1", type: "NOTE", createdAt: "2026-08-01", user: { name: "Rep" } }],
};

describe("DealValueCard", () => {
  it("shows an empty state when there is no payment", () => {
    render(<DealValueCard lead={baseLead} />);
    expect(screen.getByText("No payment created yet")).toBeInTheDocument();
  });

  it("renders the payment amount and 'Full payment' when there is one installment", () => {
    const lead: Lead = {
      ...baseLead,
      payments: [
        {
          id: "p1",
          amount: 98000,
          currency: "INR",
          status: "PAID",
          gateway: "RAZORPAY",
          installments: [],
        },
      ],
    };
    render(<DealValueCard lead={lead} />);
    expect(screen.getByText("₹98,000")).toBeInTheDocument();
    expect(screen.getByText("Full payment")).toBeInTheDocument();
  });

  it("renders an EMI breakdown when there are multiple installments", () => {
    const lead: Lead = {
      ...baseLead,
      payments: [
        {
          id: "p1",
          amount: 60000,
          currency: "INR",
          status: "PARTIAL",
          gateway: "RAZORPAY",
          installments: [
            { id: "i1", amount: 30000, dueDate: "2026-09-01", status: "PENDING" },
            { id: "i2", amount: 30000, dueDate: "2026-10-01", status: "PENDING" },
          ],
        },
      ],
    };
    render(<DealValueCard lead={lead} />);
    expect(screen.getByText(/2 × ₹30,000/)).toBeInTheDocument();
  });

  it("clamps win probability at 95%", () => {
    const lead: Lead = { ...baseLead, score: 100, activities: Array(50).fill({
      id: "a", type: "NOTE", createdAt: "2026-08-01", user: { name: "Rep" },
    }) };
    render(<DealValueCard lead={lead} />);
    expect(screen.getByText("95%")).toBeInTheDocument();
  });
});
