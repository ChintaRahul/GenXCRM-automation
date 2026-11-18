import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PaymentDetailPage from "../pages/PaymentDetail";
import * as client from "../api/client";
import * as authCtx from "../context/AuthContext";
import type { Payment, User } from "../types";

vi.mock("../api/client");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockUser: User = {
  id: "rep-1",
  name: "Rep One",
  email: "rep@t.com",
  role: "SALES_REP",
  teamId: "team-1",
};

const mockPayment: Payment = {
  id: "pay-1",
  amount: 98000,
  currency: "INR",
  status: "PAID",
  gateway: "RAZORPAY",
  paidAt: "2026-08-15T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  installments: [
    { id: "inst-1", amount: 49000, dueDate: "2026-09-01T00:00:00.000Z", status: "PENDING" },
  ],
  lead: { id: "lead-1", name: "Sneha Patel", course: "Digital Marketing" },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/payments/pay-1"]}>
      <Routes>
        <Route path="/payments/:id" element={<PaymentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PaymentDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("renders the payment summary and installment schedule once loaded", async () => {
    vi.mocked(client.getPayment).mockResolvedValue(mockPayment);
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sneha Patel" })).toBeInTheDocument(),
    );
    expect(screen.getByText("₹98,000.00")).toBeInTheDocument();
    expect(screen.getByText(/^EMI 1 · 1 Sept?\.? 2026$/)).toBeInTheDocument();
  });

  it("shows a not-found message when the payment fails to load", async () => {
    vi.mocked(client.getPayment).mockRejectedValue(new Error("not found"));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("This payment could not be found.")).toBeInTheDocument(),
    );
  });
});
