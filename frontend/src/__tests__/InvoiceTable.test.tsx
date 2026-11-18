import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { InvoiceTable } from "../components/invoices/InvoiceTable";
import type { Invoice } from "../types";

// InvoiceRowActions does its own API calls (getInvoice/deleteInvoice/etc.) — not the
// concern of this spec, which only tests InvoiceTable's own column rendering. Stub it
// out so this test doesn't need to mock the api client too.
vi.mock("../components/invoices/InvoiceRowActions", () => ({
  InvoiceRowActions: () => <button aria-label="row actions">⋯</button>,
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

function renderTable(invoices: Invoice[]) {
  return render(
    <MemoryRouter>
      <InvoiceTable invoices={invoices} onChanged={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("InvoiceTable", () => {
  it("renders correct column values for each invoice", () => {
    renderTable([baseInvoice]);
    // Desktop table AND mobile card list both render in jsdom (no real viewport), so
    // the same data appears twice — assert on the pair rather than a single match.
    expect(screen.getAllByText("INV-2026-0144")).toHaveLength(2);
    expect(screen.getAllByText("Sneha Patel")).toHaveLength(2);
    expect(screen.getAllByText("₹59,000.00")).toHaveLength(2);
  });

  it("shows a dash for a null due date", () => {
    const { container } = renderTable([{ ...baseInvoice, dueDate: null }]);
    // Desktop table renders the dash as its own cell text node; the mobile card
    // composes it into "Due —" split across sibling text nodes, so only the desktop
    // match is a standalone "—" text node — assert on that, plus the mobile card's
    // full rendered text via the container.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("Due —");
  });

  it("falls back to a dash when the invoice has no lead", () => {
    renderTable([{ ...baseInvoice, lead: undefined }]);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the correct status pill label per status", () => {
    renderTable([
      { ...baseInvoice, id: "inv-draft", status: "DRAFT" },
      { ...baseInvoice, id: "inv-paid", status: "PAID" },
      { ...baseInvoice, id: "inv-overdue", status: "OVERDUE" },
    ]);
    expect(screen.getAllByText("Draft")).toHaveLength(2);
    expect(screen.getAllByText("Paid")).toHaveLength(2);
    expect(screen.getAllByText("Overdue")).toHaveLength(2);
  });
});
