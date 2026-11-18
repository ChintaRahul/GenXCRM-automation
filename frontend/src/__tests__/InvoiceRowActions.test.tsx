import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvoiceRowActions } from "../components/invoices/InvoiceRowActions";
import * as client from "../api/client";
import type { Invoice } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseInvoice: Invoice = {
  id: "inv-1",
  leadId: "lead-1",
  lead: { id: "lead-1", name: "Sneha Patel" },
  invoiceNumber: "INV-2026-0144",
  status: "SENT",
  invoiceDate: "2026-08-01T00:00:00.000Z",
  dueDate: "2026-08-15T00:00:00.000Z",
  notes: null,
  gstEnabled: true,
  gstType: "CGST_SGST",
  gstRate: 18,
  discountType: "FLAT",
  discountValue: 0,
  subtotal: 50000,
  discountAmount: 0,
  taxableAmount: 50000,
  taxAmount: 9000,
  cgstAmount: 4500,
  sgstAmount: 4500,
  igstAmount: null,
  grandTotal: 59000,
  paymentLinkAttached: false,
  paymentGateway: null,
  paymentLinkUrl: null,
  sentAt: null,
  paidAt: null,
  registeredAt: null,
  registrationFee: null,
  registrationPaymentMode: null,
  registrationScreenshotKey: null,
  registrationNote: null,
  emiPaymentMode: "MANUAL",
  generatedFromRegistration: false,
  lineItems: [],
  emiInstallments: [],
  createdById: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function renderMenu(invoice: Invoice, onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <InvoiceRowActions invoice={invoice} onChanged={onChanged} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText(`Actions for invoice ${invoice.invoiceNumber}`));
}

describe("InvoiceRowActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Mark as Paid" for a non-PAID invoice', () => {
    renderMenu({ ...baseInvoice, status: "SENT" });
    expect(screen.getByText("Mark as Paid")).toBeInTheDocument();
  });

  it('hides "Mark as Paid" once the invoice is already PAID', () => {
    renderMenu({ ...baseInvoice, status: "PAID" });
    expect(screen.queryByText("Mark as Paid")).not.toBeInTheDocument();
  });

  it('hides "Mark as Paid" for a DRAFT invoice (never sent)', () => {
    renderMenu({ ...baseInvoice, status: "DRAFT" });
    expect(screen.queryByText("Mark as Paid")).not.toBeInTheDocument();
  });

  it('shows "Void invoice" for a SENT invoice and hides it once CANCELLED', () => {
    renderMenu({ ...baseInvoice, status: "SENT" });
    expect(screen.getByText("Void invoice")).toBeInTheDocument();
  });

  it('hides "Void invoice" once the invoice is already CANCELLED', () => {
    renderMenu({ ...baseInvoice, status: "CANCELLED" });
    expect(screen.queryByText("Void invoice")).not.toBeInTheDocument();
  });

  it('hides "Void invoice" once the invoice is PAID', () => {
    renderMenu({ ...baseInvoice, status: "PAID" });
    expect(screen.queryByText("Void invoice")).not.toBeInTheDocument();
  });

  it("calls updateInvoiceStatus with CANCELLED when Void invoice is confirmed", async () => {
    vi.mocked(client.updateInvoiceStatus).mockResolvedValue({ ...baseInvoice, status: "CANCELLED" });
    const onChanged = vi.fn();
    renderMenu({ ...baseInvoice, status: "SENT" }, onChanged);

    fireEvent.click(screen.getByText("Void invoice"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Void invoice"));

    await waitFor(() => {
      expect(client.updateInvoiceStatus).toHaveBeenCalledWith("inv-1", "CANCELLED");
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("does not call deleteInvoice until the confirm dialog's own Delete button is clicked", async () => {
    renderMenu(baseInvoice);

    fireEvent.click(screen.getByText("Delete"));
    // The confirm dialog is now open; deleteInvoice must not have been called yet.
    expect(client.deleteInvoice).not.toHaveBeenCalled();
    expect(
      screen.getByText(`Delete invoice ${baseInvoice.invoiceNumber}?`),
    ).toBeInTheDocument();

    vi.mocked(client.deleteInvoice).mockResolvedValue(undefined);
    // The dialog's own Delete button (distinct from the row menu's Delete item).
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Delete"));

    await waitFor(() => expect(client.deleteInvoice).toHaveBeenCalledWith("inv-1"));
  });

  it("calls updateInvoiceStatus with PAID when Mark as Paid is clicked", async () => {
    const onChanged = vi.fn();
    vi.mocked(client.updateInvoiceStatus).mockResolvedValue(baseInvoice);
    renderMenu({ ...baseInvoice, status: "SENT" }, onChanged);

    fireEvent.click(screen.getByText("Mark as Paid"));

    await waitFor(() =>
      expect(client.updateInvoiceStatus).toHaveBeenCalledWith("inv-1", "PAID"),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
