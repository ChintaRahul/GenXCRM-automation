import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { registerInrFonts, PDF_FONT, PDF_FONT_BOLD } from '../../common/utils/pdf-fonts.util';

// Shared `include` shape for any lookup that needs to build the PDF — kept here so
// InvoicesService.getById (which already includes lineItems/emiInstallments/lead) can be
// extended with `org` in one place rather than duplicating the Prisma query.
export const invoicePdfInclude = {
  lineItems: { orderBy: { sortOrder: 'asc' } },
  emiInstallments: { orderBy: { installmentNumber: 'asc' } },
  lead: true,
  org: true,
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{ include: typeof invoicePdfInclude }>;

// Same ₹ + 2-decimal convention as PaymentReceiptsService's PDF builder (Invoice has no
// per-record currency field — the whole product is INR-only).
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const TEAL = '#0d9488';
const MUTED = '#667085';
const INK = '#1a1a1a';
const RULE = '#e5e7eb';
const RIGHT_X = 545;

const LOGO_SIZE = 60;

// Builds the invoice PDF in memory and resolves the bytes — same shape as
// PaymentReceiptsService.buildInvoicePdf (a Promise<Buffer> driven by pdfkit's stream events).
// logoBuffer is fetched by the caller (InvoicesService) via StorageService, since this
// module stays storage-agnostic and easy to unit-test without S3.
export function buildInvoicePdf(invoice: InvoiceWithRelations, logoBuffer?: Buffer | null): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    registerInrFonts(doc);

    // Absolute-positioned top-right, so it never disturbs the left-aligned header text flow.
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, RIGHT_X - LOGO_SIZE, 45, { fit: [LOGO_SIZE, LOGO_SIZE] });
      } catch {
        // Corrupt/unsupported image bytes shouldn't break invoice generation.
      }
    }

    // ── Header: seller (org) ────────────────────────────────────────────────
    doc.fillColor(TEAL).fontSize(20).font(PDF_FONT_BOLD).text(invoice.org?.name ?? 'GenX CRM');
    doc.moveDown(0.2);
    doc.fillColor(MUTED).fontSize(9).font(PDF_FONT);
    const addr = [invoice.org?.city, invoice.org?.state, invoice.org?.country].filter(Boolean).join(', ');
    if (addr) doc.text(addr);
    const contact = [invoice.org?.email, invoice.org?.phone].filter(Boolean).join('  ·  ');
    if (contact) doc.text(contact);
    if (invoice.gstEnabled && invoice.org?.gstNumber) {
      doc.fillColor(INK).font(PDF_FONT_BOLD).text(`GSTIN: ${invoice.org.gstNumber}`);
    }

    // ── Title ────────────────────────────────────────────────────────────────
    doc.moveDown(1.2);
    doc.fillColor(INK).fontSize(16).font(PDF_FONT_BOLD).text('INVOICE');
    doc.fillColor(MUTED).fontSize(9).font(PDF_FONT);
    doc.text(`Invoice No: ${invoice.invoiceNumber}`);
    doc.text(`Date: ${fmtDate(invoice.invoiceDate)}`);
    if (invoice.dueDate) doc.text(`Due: ${fmtDate(invoice.dueDate)}`);

    // ── Bill to (lead) ───────────────────────────────────────────────────────
    doc.moveDown(1);
    doc.fillColor(MUTED).fontSize(9).font(PDF_FONT_BOLD).text('BILL TO');
    doc.fillColor(INK).font(PDF_FONT).fontSize(11).text(invoice.lead.name);
    doc.fillColor(MUTED).fontSize(9);
    if (invoice.lead.phone) doc.text(invoice.lead.phone);
    if (invoice.lead.email) doc.text(invoice.lead.email);

    // ── Line items ───────────────────────────────────────────────────────────
    doc.moveDown(1.5);
    const tableTop = doc.y;
    doc.fillColor(MUTED).fontSize(9).font(PDF_FONT_BOLD);
    doc.text('COURSE', 50, tableTop, { width: 240 });
    doc.text('QTY', 290, tableTop, { width: 50, align: 'right' });
    doc.text('UNIT PRICE', 345, tableTop, { width: 100, align: 'right' });
    doc.text('AMOUNT', RIGHT_X - 100, tableTop, { width: 100, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(RIGHT_X, tableTop + 15).strokeColor(RULE).stroke();

    let y = tableTop + 25;
    doc.fillColor(INK).font(PDF_FONT).fontSize(10);
    for (const li of invoice.lineItems) {
      doc.text(li.courseName, 50, y, { width: 240 });
      doc.text(String(li.quantity), 290, y, { width: 50, align: 'right' });
      doc.text(inr(li.unitPrice), 345, y, { width: 100, align: 'right' });
      doc.text(inr(li.lineTotal), RIGHT_X - 100, y, { width: 100, align: 'right' });
      y += 20;
    }

    // ── Totals block ─────────────────────────────────────────────────────────
    y += 8;
    doc.moveTo(295, y).lineTo(RIGHT_X, y).strokeColor(RULE).stroke();
    y += 10;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? PDF_FONT_BOLD : PDF_FONT).fillColor(bold ? INK : MUTED).fontSize(bold ? 12 : 10);
      doc.text(label, 295, y, { width: 150 });
      doc.text(value, RIGHT_X - 100, y, { width: 100, align: 'right' });
      y += bold ? 20 : 18;
    };

    totalRow('Subtotal', inr(invoice.subtotal));
    if (invoice.discountAmount > 0) totalRow('Discount', `- ${inr(invoice.discountAmount)}`);
    totalRow('Taxable Amount', inr(invoice.taxableAmount));

    if (invoice.gstEnabled) {
      if (invoice.gstType === 'CGST_SGST') {
        totalRow(`CGST (${(invoice.gstRate / 2).toFixed(1)}%)`, inr(invoice.cgstAmount ?? 0));
        totalRow(`SGST (${(invoice.gstRate / 2).toFixed(1)}%)`, inr(invoice.sgstAmount ?? 0));
      } else {
        totalRow(`IGST (${invoice.gstRate}%)`, inr(invoice.igstAmount ?? 0));
      }
    } else {
      doc.font(PDF_FONT).fillColor(MUTED).fontSize(9).text('Tax-free invoice', 295, y, { width: 250 });
      y += 18;
    }

    y += 6;
    doc.moveTo(295, y).lineTo(RIGHT_X, y).strokeColor(RULE).stroke();
    y += 8;
    totalRow('Grand Total', inr(invoice.grandTotal), true);

    // ── EMI schedule ─────────────────────────────────────────────────────────
    if (invoice.emiInstallments.length > 0) {
      y += 20;
      doc.fillColor(INK).fontSize(12).font(PDF_FONT_BOLD).text('EMI Schedule', 50, y);
      y += 20;
      doc.fillColor(MUTED).fontSize(9).font(PDF_FONT_BOLD);
      doc.text('#', 50, y, { width: 40 });
      doc.text('DUE DATE', 100, y, { width: 150 });
      doc.text('AMOUNT', 300, y, { width: 100, align: 'right' });
      doc.text('STATUS', RIGHT_X - 90, y, { width: 90, align: 'right' });
      y += 15;
      doc.moveTo(50, y).lineTo(RIGHT_X, y).strokeColor(RULE).stroke();
      y += 10;
      doc.fillColor(INK).font(PDF_FONT).fontSize(10);
      for (const inst of invoice.emiInstallments) {
        doc.text(String(inst.installmentNumber), 50, y, { width: 40 });
        doc.text(fmtDate(inst.dueDate), 100, y, { width: 150 });
        doc.text(inr(inst.amount), 300, y, { width: 100, align: 'right' });
        doc.text(inst.status, RIGHT_X - 90, y, { width: 90, align: 'right' });
        y += 18;
      }
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    if (invoice.notes) {
      y += 25;
      doc.fillColor(MUTED).font(PDF_FONT).fontSize(9).text(invoice.notes, 50, y, { width: RIGHT_X - 50 });
    }

    doc.end();
  });
}
