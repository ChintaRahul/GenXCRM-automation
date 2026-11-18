import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import {
  RegistrationFeeCard,
  computeEmiPreview,
} from "../components/invoices/RegistrationFeeCard";
import * as client from "../api/client";
import type { PaymentGatewayStatus } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockGateways: PaymentGatewayStatus[] = [{ gateway: "RAZORPAY", connected: true }];

const baseProps = {
  fee: 5000,
  onFeeChange: vi.fn(),
  screenshotFileName: null,
  onScreenshotFileSelected: vi.fn(),
  note: "",
  onNoteChange: vi.fn(),
  subtotal: 45000,
};

function renderCard(props: Partial<React.ComponentProps<typeof RegistrationFeeCard>> = {}) {
  return render(<RegistrationFeeCard {...baseProps} {...props} />);
}

describe("computeEmiPreview", () => {
  it("does not gross up for GST when gstEnabled is false (the Register flow's default)", () => {
    const rows = computeEmiPreview({
      subtotal: 45000,
      registrationFee: 5000,
      negotiatedAmount: undefined,
      tenureMonths: 4,
      startDate: "2026-09-01",
      gstEnabled: false,
      gstRate: 18,
    });
    // No GST gross-up: emiBase = 45000 - 5000 = 40000; /4 = 10000
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.amount)).toEqual([10000, 10000, 10000, 10000]);
    expect(rows[0].installmentNumber).toBe(1);
    expect(rows[0].dueDate.getMonth()).toBe(new Date("2026-09-01").getMonth());
    expect(rows[3].dueDate.getMonth()).toBe((new Date("2026-09-01").getMonth() + 3) % 12);
  });

  it("matches the documented formula when GST is explicitly enabled", () => {
    const rows = computeEmiPreview({
      subtotal: 45000,
      registrationFee: 5000,
      negotiatedAmount: undefined,
      tenureMonths: 4,
      startDate: "2026-09-01",
      gstEnabled: true,
      gstRate: 18,
    });
    // The backend bases EMIs on the invoice's GST-inclusive grandTotal — so the preview
    // grosses the subtotal up the same way: 45000 * 1.18 = 53100; emiBase = 53100 - 5000 =
    // 48100; /4 = 12025.
    expect(rows.map((r) => r.amount)).toEqual([12025, 12025, 12025, 12025]);
  });

  it("uses negotiatedAmount instead of subtotal when positive", () => {
    const rows = computeEmiPreview({
      subtotal: 45000,
      registrationFee: 5000,
      negotiatedAmount: 35000,
      tenureMonths: 3,
      startDate: "2026-09-01",
      gstEnabled: true,
      gstRate: 18,
    });
    // A negotiated amount is the final agreed figure and is used as-is (no GST gross-up),
    // matching the backend: emiBase = 35000 - 5000 = 30000; perEmi = round2(30000/3) = 10000
    expect(rows.map((r) => r.amount)).toEqual([10000, 10000, 10000]);
  });

  it("clamps emiBase at 0 when the fee exceeds the base amount", () => {
    const rows = computeEmiPreview({
      subtotal: 1000,
      registrationFee: 5000,
      negotiatedAmount: undefined,
      tenureMonths: 2,
      startDate: "2026-09-01",
      gstEnabled: false,
      gstRate: 18,
    });
    expect(rows.map((r) => r.amount)).toEqual([0, 0]);
  });

  it("returns an empty schedule when tenure or start date is missing", () => {
    expect(
      computeEmiPreview({
        subtotal: 1000,
        registrationFee: 0,
        tenureMonths: 0,
        startDate: "2026-09-01",
        gstEnabled: false,
        gstRate: 18,
      }),
    ).toEqual([]);
    expect(
      computeEmiPreview({
        subtotal: 1000,
        registrationFee: 0,
        tenureMonths: 3,
        startDate: "",
        gstEnabled: false,
        gstRate: 18,
      }),
    ).toEqual([]);
  });
});

describe("RegistrationFeeCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue(mockGateways);
    vi.mocked(client.getInvoice).mockResolvedValue({ id: "inv-1", registrationFeePaidAt: null } as never);
  });

  it("has no payment-link tab when ensurePaymentLinkInvoiceId is omitted", () => {
    renderCard();
    expect(screen.queryByText("Payment link")).toBeNull();
    expect(screen.getByText("Drop payment screenshot")).toBeInTheDocument();
  });

  it("shows a Screenshot/Payment link tab switcher when a gateway is connected", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderCard({ ensurePaymentLinkInvoiceId: async () => "inv-1" });
    expect(screen.getByText("Screenshot")).toBeInTheDocument();
    expect(screen.getByText("Payment link")).toBeInTheDocument();
    expect(screen.getByText("Drop payment screenshot")).toBeInTheDocument();

    await user.click(screen.getByText("Payment link"));
    await waitFor(() => expect(screen.getByText("Use payment gateway")).toBeInTheDocument());
  });

  it("resolves the invoice id lazily via ensurePaymentLinkInvoiceId when sending from the tab", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const ensurePaymentLinkInvoiceId = vi.fn().mockResolvedValue("inv-lazy");
    renderCard({ ensurePaymentLinkInvoiceId });
    await user.click(screen.getByText("Payment link"));
    await waitFor(() => expect(screen.getByText("Send Link")).toBeInTheDocument());

    await user.click(screen.getByText("Send Link"));

    await waitFor(() =>
      expect(client.sendRegistrationPaymentLink).toHaveBeenCalledWith("inv-lazy", {
        source: "GATEWAY",
        gateway: "RAZORPAY",
        amount: 5000,
      }),
    );
    expect(ensurePaymentLinkInvoiceId).toHaveBeenCalledTimes(1);
  });

  it("disables Send Link on the payment-link tab when the fee is still zero", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderCard({ ensurePaymentLinkInvoiceId: async () => "inv-1", fee: 0 });
    await user.click(screen.getByText("Payment link"));
    await waitFor(() => expect(screen.getByText("Send Link")).toBeInTheDocument());

    expect(screen.getByText("Send Link").closest("button")).toBeDisabled();
    expect(
      screen.getByText("Enter a registration fee above before sending a payment link."),
    ).toBeInTheDocument();
  });

  it("shows a paid badge on the payment-link tab once marked paid", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.mocked(client.markRegistrationFeePaid).mockResolvedValue({
      id: "inv-1",
      registrationFeePaidAt: "2026-09-18T00:00:00.000Z",
    } as never);
    renderCard({ ensurePaymentLinkInvoiceId: async () => "inv-1" });
    await user.click(screen.getByText("Payment link"));
    await waitFor(() => expect(screen.getByText("Mark as paid")).toBeInTheDocument());

    await user.click(screen.getByText("Mark as paid"));

    await waitFor(() => expect(client.markRegistrationFeePaid).toHaveBeenCalledWith("inv-1"));
    expect(await screen.findByText(/Paid on/)).toBeInTheDocument();
    expect(screen.queryByText("Send Link")).toBeNull();
  });

  it("always shows the screenshot upload slot — payment proof is mandatory", () => {
    renderCard();
    expect(screen.getByText("Drop payment screenshot")).toBeInTheDocument();
  });

  it("calls onScreenshotFileSelected when a file is chosen", () => {
    const onScreenshotFileSelected = vi.fn();
    renderCard({ onScreenshotFileSelected });
    const file = new File(["x"], "proof.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(onScreenshotFileSelected).toHaveBeenCalledWith(file);
  });

  it("calls onFeeChange when the fee input changes", () => {
    const onFeeChange = vi.fn();
    renderCard({ onFeeChange });
    fireEvent.change(screen.getByDisplayValue("5000"), { target: { value: "7500" } });
    expect(onFeeChange).toHaveBeenCalledWith(7500);
  });

  it("shows the course fee total reminder", () => {
    renderCard({ subtotal: 45000 });
    expect(screen.getByText("Course fee total")).toBeInTheDocument();
    expect(screen.getByText("₹45,000")).toBeInTheDocument();
  });
});
