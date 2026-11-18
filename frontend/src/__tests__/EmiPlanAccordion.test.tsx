import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { EmiPlanAccordion } from "../components/invoices/EmiPlanAccordion";
import * as client from "../api/client";

vi.mock("../api/client");

const baseProps = {
  open: true,
  onToggle: vi.fn(),
  subtotal: 45000,
  registrationFee: 5000,
  tenureMonths: 4,
  onTenureMonthsChange: vi.fn(),
  emiStartDate: "2026-09-01",
  onEmiStartDateChange: vi.fn(),
  negotiatedAmount: undefined,
  onNegotiatedAmountChange: vi.fn(),
  gstEnabled: true,
  gstRate: 18,
  onCreateEmiPlan: vi.fn(),
  emiPaymentMode: "MANUAL" as const,
  emiMandateStatus: null,
  emiMandateShortUrl: null,
  onCreateEmiMandate: vi.fn(),
};

function renderAccordion(props: Partial<React.ComponentProps<typeof EmiPlanAccordion>> = {}) {
  return render(<EmiPlanAccordion {...baseProps} {...props} />);
}

describe("EmiPlanAccordion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getInvoice).mockResolvedValue({ id: "inv-1" } as never);
  });

  it("stays collapsed until open is true", () => {
    renderAccordion({ open: false });
    expect(screen.queryByText("Save EMI plan")).toBeNull();
  });

  it("recalculates the schedule preview when tenure changes", () => {
    const { rerender } = renderAccordion({ tenureMonths: 4 });
    expect(screen.getByText("EMI 4")).toBeInTheDocument();
    expect(screen.queryByText("EMI 5")).toBeNull();

    rerender(<EmiPlanAccordion {...baseProps} tenureMonths={5} />);
    expect(screen.getByText("EMI 5")).toBeInTheDocument();
  });

  it("recalculates the schedule preview when the negotiated amount changes", () => {
    const { rerender } = renderAccordion({ tenureMonths: 2, negotiatedAmount: undefined });
    // emiBase = 45000*1.18 - 5000 = 48100 => 24050/installment (both rows equal)
    expect(screen.getAllByText("₹24,050")).toHaveLength(2);

    rerender(<EmiPlanAccordion {...baseProps} tenureMonths={2} negotiatedAmount={25000} />);
    // emiBase = 25000 - 5000 = 20000 => 10000/installment (both rows equal)
    expect(screen.getAllByText("₹10,000")).toHaveLength(2);
  });

  it("does not gross up for GST, and drops the GST suffix, when gstEnabled is false", () => {
    renderAccordion({ tenureMonths: 2, gstEnabled: false });
    // emiBase = 45000 - 5000 = 40000 (no GST gross-up) => 20000/installment
    expect(screen.getAllByText("₹20,000")).toHaveLength(2);
    expect(screen.getByText("EMI schedule preview")).toBeInTheDocument();
    expect(screen.queryByText(/GST/)).toBeNull();
  });

  // Once a plan is persisted the accordion must show the rows the API actually returned, not
  // the client-side estimate — the two can differ (the backend applies GST/discount changes
  // made on the invoice form).
  it("renders the saved installments returned by the API instead of the preview", () => {
    renderAccordion({
      tenureMonths: 2,
      savedInstallments: [
        {
          id: "emi-1",
          installmentNumber: 1,
          amount: 31111,
          dueDate: "2026-09-01T00:00:00.000Z",
          status: "PENDING",
          paidAt: null,
          lastReminderAt: null,
          lastReminderChannel: null,
        },
      ],
    });

    expect(screen.getByText("Saved EMI schedule")).toBeInTheDocument();
    expect(screen.getByText("₹31,111")).toBeInTheDocument();
    expect(screen.queryByText("₹24,050")).toBeNull();
    expect(screen.getByText("Update EMI plan")).toBeInTheDocument();
  });

  it("shows a Manual / Auto-debit tab switcher", () => {
    renderAccordion();
    expect(screen.getByRole("tab", { name: "Manual" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Auto-debit (mandate)" })).toBeInTheDocument();
  });

  it("creates a mandate from the Auto-debit tab and shows the authorization link", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const onCreateEmiMandate = vi.fn();
    renderAccordion({ onCreateEmiMandate });

    await user.click(screen.getByRole("tab", { name: "Auto-debit (mandate)" }));
    await user.click(screen.getByRole("button", { name: "Create mandate" }));

    expect(onCreateEmiMandate).toHaveBeenCalled();
  });

  it("shows the mandate's authorization link and awaiting status once created", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderAccordion({
      emiPaymentMode: "SUBSCRIPTION",
      emiMandateStatus: "CREATED",
      emiMandateShortUrl: "https://rzp.io/i/sub-abc",
    });

    await user.click(screen.getByRole("tab", { name: "Auto-debit (mandate)" }));
    expect(screen.getByText("Awaiting authorization")).toBeInTheDocument();
    expect(screen.getByText("https://rzp.io/i/sub-abc")).toBeInTheDocument();
  });

  it("shows the mandate active once emiMandateStatus is ACTIVE", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderAccordion({
      emiPaymentMode: "SUBSCRIPTION",
      emiMandateStatus: "ACTIVE",
      emiMandateShortUrl: "https://rzp.io/i/sub-abc",
      savedInstallments: [
        {
          id: "emi-1",
          installmentNumber: 1,
          amount: 10000,
          dueDate: "2026-10-01T00:00:00.000Z",
          status: "PAID",
          paidAt: "2026-10-01T00:00:00.000Z",
          lastReminderAt: null,
          lastReminderChannel: null,
        },
        {
          id: "emi-2",
          installmentNumber: 2,
          amount: 10000,
          dueDate: "2026-11-01T00:00:00.000Z",
          status: "PENDING",
          paidAt: null,
          lastReminderAt: null,
          lastReminderChannel: null,
        },
      ],
    });

    await user.click(screen.getByRole("tab", { name: "Auto-debit (mandate)" }));
    expect(screen.getByText("✓ Auto-debit active — 1 of 2 installments charged")).toBeInTheDocument();
  });

  // Round-2 fix: onMandateStatusChange doesn't carry emiMandateShortUrl, so the component
  // must pick up a fresh short URL from its own poll of getInvoice, not just the prop.
  it("updates the rendered short URL from the poll, not just the initial prop", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.mocked(client.getInvoice).mockResolvedValue({
      id: "inv-1",
      emiMandateStatus: "CREATED",
      emiMandateShortUrl: "https://rzp.io/i/polled-new",
      emiInstallments: [],
    } as never);

    renderAccordion({
      invoiceId: "inv-1",
      emiPaymentMode: "SUBSCRIPTION",
      emiMandateStatus: "CREATED",
      emiMandateShortUrl: "https://rzp.io/i/sub-abc",
    });

    await user.click(screen.getByRole("tab", { name: "Auto-debit (mandate)" }));

    await waitFor(() => {
      expect(screen.getByText("https://rzp.io/i/polled-new")).toBeInTheDocument();
    });
    expect(screen.queryByText("https://rzp.io/i/sub-abc")).toBeNull();
  });

  it("locks both tabs' edit controls once a mandate already exists, but still shows the saved schedule", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderAccordion({
      tenureMonths: 2,
      emiPaymentMode: "SUBSCRIPTION",
      emiMandateStatus: "ACTIVE",
      emiMandateShortUrl: "https://rzp.io/i/sub-abc",
      savedInstallments: [
        {
          id: "emi-1",
          installmentNumber: 1,
          amount: 10000,
          dueDate: "2026-10-01T00:00:00.000Z",
          status: "PAID",
          paidAt: "2026-10-01T00:00:00.000Z",
          lastReminderAt: null,
          lastReminderChannel: null,
        },
      ],
    });

    expect(screen.getByRole("tab", { name: "Manual" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Auto-debit (mandate)" }));
    expect(screen.queryByRole("button", { name: "Create mandate" })).toBeNull();
    // Rule 5 fix: the saved schedule must remain visible once locked, not disappear behind
    // just the status text.
    expect(screen.getByText("EMI 1")).toBeInTheDocument();
    expect(screen.getByText("Saved EMI schedule")).toBeInTheDocument();
  });

  it("calls onMandateStatusChange with the polled status and installments", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const onMandateStatusChange = vi.fn();
    vi.mocked(client.getInvoice).mockResolvedValue({
      id: "inv-1",
      emiMandateStatus: "ACTIVE",
      emiMandateShortUrl: "https://rzp.io/i/sub-abc",
      emiInstallments: [
        {
          id: "emi-1",
          installmentNumber: 1,
          amount: 10000,
          dueDate: "2026-10-01T00:00:00.000Z",
          status: "PAID",
          paidAt: "2026-10-01T00:00:00.000Z",
          lastReminderAt: null,
          lastReminderChannel: null,
        },
      ],
    } as never);

    renderAccordion({
      invoiceId: "inv-1",
      emiPaymentMode: "SUBSCRIPTION",
      emiMandateStatus: "CREATED",
      emiMandateShortUrl: "https://rzp.io/i/sub-abc",
      onMandateStatusChange,
    });

    await user.click(screen.getByRole("tab", { name: "Auto-debit (mandate)" }));

    await waitFor(() => {
      expect(onMandateStatusChange).toHaveBeenCalledWith(
        "ACTIVE",
        expect.arrayContaining([expect.objectContaining({ installmentNumber: 1 })]),
      );
    });
  });

  describe("auto-debit gateway picker", () => {
    const connectedBoth = [
      { gateway: "RAZORPAY" as const, connected: true },
      { gateway: "CASHFREE" as const, connected: true },
    ];

    it("shows the picker in the Auto-debit tab and enables Create mandate for a connected gateway", async () => {
      renderAccordion({ gateways: connectedBoth, emiGateway: "CASHFREE" });
      await userEvent.click(screen.getByRole("tab", { name: /auto-debit/i }));
      expect(screen.getByLabelText("Payment gateway")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create mandate" })).toBeEnabled();
    });

    it("disables Create mandate when the chosen gateway is not connected", async () => {
      renderAccordion({
        gateways: [
          { gateway: "RAZORPAY" as const, connected: true },
          { gateway: "CASHFREE" as const, connected: false },
        ],
        emiGateway: "CASHFREE",
      });
      await userEvent.click(screen.getByRole("tab", { name: /auto-debit/i }));
      expect(screen.getByRole("button", { name: "Create mandate" })).toBeDisabled();
    });
  });
});
