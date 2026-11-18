import { buildInvoicePdf, type InvoiceWithRelations } from './invoices-pdf.util';

const baseInvoice = {
  id: 'inv-1',
  orgId: 'org-1',
  invoiceNumber: 'INV-2026-0001',
  status: 'DRAFT',
  invoiceDate: new Date('2026-06-01'),
  dueDate: new Date('2026-06-15'),
  notes: null,
  gstEnabled: true,
  gstType: 'CGST_SGST',
  gstRate: 18,
  discountType: 'FLAT',
  discountValue: 0,
  subtotal: 1000,
  discountAmount: 0,
  taxableAmount: 1000,
  taxAmount: 180,
  cgstAmount: 90,
  sgstAmount: 90,
  igstAmount: null,
  grandTotal: 1180,
  lineItems: [
    { id: 'li-1', invoiceId: 'inv-1', courseId: null, courseName: 'MBA', quantity: 2, unitPrice: 500, lineTotal: 1000, sortOrder: 0 },
  ],
  emiInstallments: [],
  lead: { id: 'lead-1', name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210' },
  org: {
    id: 'org-1',
    name: 'Acme Edu',
    city: 'Pune',
    state: 'MH',
    country: 'India',
    email: 'billing@acme.edu',
    phone: '020-111',
    gstNumber: '27ABCDE1234F1Z5',
  },
} as unknown as InvoiceWithRelations;

describe('buildInvoicePdf', () => {
  it('produces a non-empty valid PDF buffer for a minimal invoice (1 line item, GST enabled, no EMI)', async () => {
    const pdf = await buildInvoicePdf(baseInvoice);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not throw for the GST-disabled case', async () => {
    const invoice = { ...baseInvoice, gstEnabled: false, taxAmount: 0, cgstAmount: null, sgstAmount: null, igstAmount: null, grandTotal: 1000 } as InvoiceWithRelations;
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('does not throw for IGST invoices', async () => {
    const invoice = {
      ...baseInvoice,
      gstType: 'IGST',
      cgstAmount: null,
      sgstAmount: null,
      igstAmount: 180,
    } as InvoiceWithRelations;
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('does not throw for an invoice with EMI installments present', async () => {
    const invoice = {
      ...baseInvoice,
      emiInstallments: [
        { id: 'emi-1', invoiceId: 'inv-1', installmentNumber: 1, amount: 590, dueDate: new Date('2026-07-01'), status: 'PENDING', paidAt: null, lastReminderAt: null, lastReminderChannel: null },
        { id: 'emi-2', invoiceId: 'inv-1', installmentNumber: 2, amount: 590, dueDate: new Date('2026-08-01'), status: 'PAID', paidAt: new Date('2026-08-01'), lastReminderAt: null, lastReminderChannel: null },
      ],
    } as InvoiceWithRelations;
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('includes notes in the footer when present, without throwing', async () => {
    const invoice = { ...baseInvoice, notes: 'Thanks for enrolling!' } as InvoiceWithRelations;
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('handles a missing org gracefully', async () => {
    const invoice = { ...baseInvoice, org: null } as unknown as InvoiceWithRelations;
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.length).toBeGreaterThan(0);
  });
});
