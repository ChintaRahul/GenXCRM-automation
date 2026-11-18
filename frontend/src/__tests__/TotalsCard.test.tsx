import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TotalsCard,
  computeInvoiceTotalsClient,
  type InvoiceTotals,
} from "../components/invoices/TotalsCard";
import * as client from "../api/client";
import type { DiscountType, GstType, PaymentGatewayName, PaymentGatewayStatus } from "../types";

vi.mock("../api/client");

const mockGateways: PaymentGatewayStatus[] = [{ gateway: "RAZORPAY", connected: true }];

describe("computeInvoiceTotalsClient", () => {
  // Fixtures mirror backend/src/modules/invoices/invoices.math.ts's
  // computeInvoiceTotals exactly.
  it("computes subtotal/discount/tax with a flat discount and CGST+SGST split", () => {
    const totals = computeInvoiceTotalsClient({
      lineItems: [{ quantity: 2, unitPrice: 5000 }], // subtotal 10000
      discountType: "FLAT",
      discountValue: 1000,
      gstEnabled: true,
      gstType: "CGST_SGST",
      gstRate: 18,
    });
    expect(totals.subtotal).toBe(10000);
    expect(totals.discountAmount).toBe(1000);
    expect(totals.taxableAmount).toBe(9000);
    expect(totals.taxAmount).toBe(1620); // 9000 * 0.18
    expect(totals.cgstAmount).toBe(810);
    expect(totals.sgstAmount).toBe(810);
    expect(totals.igstAmount).toBeNull();
    expect(totals.grandTotal).toBe(10620);
  });

  it("computes a percent discount and IGST as a single line", () => {
    const totals = computeInvoiceTotalsClient({
      lineItems: [{ quantity: 1, unitPrice: 20000 }],
      discountType: "PERCENT",
      discountValue: 10, // 10% of 20000 = 2000
      gstEnabled: true,
      gstType: "IGST",
      gstRate: 18,
    });
    expect(totals.discountAmount).toBe(2000);
    expect(totals.taxableAmount).toBe(18000);
    expect(totals.taxAmount).toBe(3240);
    expect(totals.igstAmount).toBe(3240);
    expect(totals.cgstAmount).toBeNull();
    expect(totals.sgstAmount).toBeNull();
    expect(totals.grandTotal).toBe(21240);
  });

  it("caps the discount at the subtotal", () => {
    const totals = computeInvoiceTotalsClient({
      lineItems: [{ quantity: 1, unitPrice: 1000 }],
      discountType: "FLAT",
      discountValue: 5000,
      gstEnabled: false,
      gstType: "CGST_SGST",
      gstRate: 18,
    });
    expect(totals.discountAmount).toBe(1000);
    expect(totals.taxableAmount).toBe(0);
    expect(totals.grandTotal).toBe(0);
  });

  it("charges no tax when GST is disabled", () => {
    const totals = computeInvoiceTotalsClient({
      lineItems: [{ quantity: 1, unitPrice: 1000 }],
      discountType: "FLAT",
      discountValue: 0,
      gstEnabled: false,
      gstType: "CGST_SGST",
      gstRate: 18,
    });
    expect(totals.taxAmount).toBe(0);
    expect(totals.cgstAmount).toBeNull();
    expect(totals.igstAmount).toBeNull();
    expect(totals.grandTotal).toBe(1000);
  });
});

function makeTotals(overrides: Partial<InvoiceTotals> = {}): InvoiceTotals {
  return {
    subtotal: 10000,
    discountAmount: 0,
    taxableAmount: 10000,
    taxAmount: 1800,
    cgstAmount: 900,
    sgstAmount: 900,
    igstAmount: null,
    grandTotal: 11800,
    ...overrides,
  };
}

const baseProps = {
  totals: makeTotals(),
  gstEnabled: true,
  gstType: "CGST_SGST" as GstType,
  gstRate: 18,
  discountType: "PERCENT" as DiscountType,
  discountValue: 0,
  onDiscountTypeChange: vi.fn(),
  onDiscountValueChange: vi.fn(),
  attachPaymentLink: false,
  onAttachPaymentLinkChange: vi.fn(),
  gateway: null as PaymentGatewayName | null,
  onGatewayChange: vi.fn(),
  mandateActive: false,
};

async function renderCard(props: Partial<typeof baseProps> = {}) {
  const result = render(<TotalsCard {...baseProps} {...props} />);
  await waitFor(() => expect(client.getConnectedPaymentGateways).toHaveBeenCalled());
  return result;
}

describe("TotalsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue(mockGateways);
  });

  it("clicking the discount %/₹ toggle calls the corresponding handler", async () => {
    const onDiscountTypeChange = vi.fn();
    await renderCard({ onDiscountTypeChange });
    fireEvent.click(screen.getByText("₹"));
    expect(onDiscountTypeChange).toHaveBeenCalledWith("FLAT");
  });

  it("shows the taxable amount row only when a discount is applied", async () => {
    const { rerender } = await renderCard({ totals: makeTotals({ discountAmount: 0 }) });
    expect(screen.queryByText("Taxable amount")).toBeNull();

    rerender(
      <TotalsCard
        {...baseProps}
        totals={makeTotals({ discountAmount: 500, taxableAmount: 9500 })}
      />,
    );
    expect(screen.getByText("Taxable amount")).toBeInTheDocument();
  });

  it("shows CGST + SGST lines for CGST_SGST type", async () => {
    await renderCard({ gstType: "CGST_SGST", gstRate: 18 });
    expect(screen.getByText("CGST (9%)")).toBeInTheDocument();
    expect(screen.getByText("SGST (9%)")).toBeInTheDocument();
    expect(screen.queryByText(/^IGST/)).toBeNull();
  });

  it("shows a single IGST line for IGST type", async () => {
    await renderCard({
      gstType: "IGST",
      gstRate: 18,
      totals: makeTotals({ cgstAmount: null, sgstAmount: null, igstAmount: 1800 }),
    });
    expect(screen.getByText("IGST (18%)")).toBeInTheDocument();
    expect(screen.queryByText(/^CGST/)).toBeNull();
  });

  it("shows the tax-free note and hides tax rows when GST is off", async () => {
    await renderCard({
      gstEnabled: false,
      totals: makeTotals({ taxAmount: 0, cgstAmount: null, sgstAmount: null, grandTotal: 10000 }),
    });
    expect(screen.getByText("Tax-free invoice — GST not applied.")).toBeInTheDocument();
    expect(screen.queryByText(/^CGST/)).toBeNull();
    expect(screen.queryByText(/^IGST/)).toBeNull();
  });

  it("hides the payment gateway rows until the switch is on", async () => {
    await renderCard({ attachPaymentLink: false });
    expect(screen.queryByText("Razorpay")).toBeNull();
  });

  it("shows a single, enabled Razorpay row when connected", async () => {
    await renderCard({ attachPaymentLink: true });
    const razorpayRow = screen.getByText("Razorpay").closest("button");

    expect(razorpayRow).not.toBeDisabled();
    expect(screen.queryByText("Not connected")).toBeNull();
  });

  it("disables the Attach payment link switch and hides the gateway list when nothing is connected", async () => {
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue([
      { gateway: "RAZORPAY", connected: false },
    ]);
    await renderCard({ attachPaymentLink: true });
    expect(screen.getByRole("switch", { name: "Attach payment link" })).toBeDisabled();
    expect(screen.queryByText("Razorpay")).toBeNull();
  });

  it("disables the Attach payment link switch and explains why when an auto-debit mandate is active", async () => {
    await renderCard({ attachPaymentLink: true, mandateActive: true });
    expect(screen.getByRole("switch", { name: "Attach payment link" })).toBeDisabled();
    expect(
      screen.getByText("Auto-debit mandate active — Razorpay already collects each installment"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Razorpay")).toBeNull();
  });

  it("clicking a connected gateway row calls onGatewayChange", async () => {
    const onGatewayChange = vi.fn();
    await renderCard({ attachPaymentLink: true, onGatewayChange });
    fireEvent.click(screen.getByText("Razorpay").closest("button")!);
    expect(onGatewayChange).toHaveBeenCalledWith("RAZORPAY");
  });

  it("toggling attach payment link calls onAttachPaymentLinkChange", async () => {
    const onAttachPaymentLinkChange = vi.fn();
    await renderCard({ onAttachPaymentLinkChange });
    fireEvent.click(screen.getByRole("switch", { name: "Attach payment link" }));
    expect(onAttachPaymentLinkChange).toHaveBeenCalledWith(true);
  });
});
