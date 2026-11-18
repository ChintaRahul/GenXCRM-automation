import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmiScheduleCard } from "../components/invoices/EmiScheduleCard";
import * as client from "../api/client";
import type { EmiInstallment } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const installments: EmiInstallment[] = [
  {
    id: "emi-1",
    installmentNumber: 1,
    amount: 10000,
    dueDate: "2026-09-01T00:00:00.000Z",
    status: "PAID",
    paidAt: "2026-09-02T00:00:00.000Z",
    lastReminderAt: null,
    lastReminderChannel: null,
  },
  {
    id: "emi-2",
    installmentNumber: 2,
    amount: 10000,
    dueDate: "2026-10-01T00:00:00.000Z",
    status: "PENDING",
    paidAt: null,
    lastReminderAt: "2026-09-20T00:00:00.000Z",
    lastReminderChannel: "EMAIL",
  },
];

describe("EmiScheduleCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every installment with its amount and status", () => {
    render(
      <EmiScheduleCard invoiceId="inv-1" emiInstallments={installments} onChanged={vi.fn()} />,
    );

    expect(screen.getByText("EMI 1")).toBeInTheDocument();
    expect(screen.getByText("EMI 2")).toBeInTheDocument();
    expect(screen.getAllByText("₹10,000.00")).toHaveLength(2);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/Last reminded .* via Email/)).toBeInTheDocument();
  });

  it("offers row actions only for PENDING installments", () => {
    render(
      <EmiScheduleCard invoiceId="inv-1" emiInstallments={installments} onChanged={vi.fn()} />,
    );
    expect(screen.getAllByRole("button", { name: "Mark Paid" })).toHaveLength(1);
  });

  it("marks an installment paid and notifies the parent", async () => {
    const onChanged = vi.fn();
    vi.mocked(client.markEmiInstallmentPaid).mockResolvedValue(installments[1]);

    render(
      <EmiScheduleCard invoiceId="inv-1" emiInstallments={installments} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark Paid" }));

    await waitFor(() => expect(client.markEmiInstallmentPaid).toHaveBeenCalledWith("inv-1", 2));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("sends a WhatsApp reminder for the right installment and channel", async () => {
    const onChanged = vi.fn();
    vi.mocked(client.remindEmiInstallment).mockResolvedValue(undefined);

    render(
      <EmiScheduleCard invoiceId="inv-1" emiInstallments={installments} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remind · WhatsApp" }));

    await waitFor(() =>
      expect(client.remindEmiInstallment).toHaveBeenCalledWith("inv-1", 2, "WHATSAPP"),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("sends an Email reminder with the EMAIL channel", async () => {
    vi.mocked(client.remindEmiInstallment).mockResolvedValue(undefined);

    render(
      <EmiScheduleCard invoiceId="inv-1" emiInstallments={installments} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remind · Email" }));

    await waitFor(() =>
      expect(client.remindEmiInstallment).toHaveBeenCalledWith("inv-1", 2, "EMAIL"),
    );
  });

  it("does not call onChanged when the API rejects", async () => {
    const onChanged = vi.fn();
    vi.mocked(client.markEmiInstallmentPaid).mockRejectedValue(new Error("boom"));

    render(
      <EmiScheduleCard invoiceId="inv-1" emiInstallments={installments} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark Paid" }));

    await waitFor(() => expect(client.markEmiInstallmentPaid).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
