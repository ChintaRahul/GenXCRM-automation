import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';
import { StorageService } from '../storage/storage.service';
import { mergeNotificationSettings } from '../../common/constants/org-defaults';
import { registerInrFonts, PDF_FONT, PDF_FONT_BOLD } from '../../common/utils/pdf-fonts.util';

// Minimal shapes the PDF builder needs — kept local so the builder is easy to unit-test.
interface InvoiceLead {
  name: string;
  email: string | null;
  phone: string;
  course: string | null;
}
interface InvoiceOrg {
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  gstNumber: string | null;
  logoKey?: string | null;
}
interface InvoiceData {
  invoiceNumber: string;
  issuedAt: Date;
  amount: number;
  currency: string;
  gstPercent: number;
  discountAmount: number;
  includeGst: boolean;
  reference: string | null;
}

const inr = (n: number, currency: string) =>
  `${currency === 'INR' ? '₹' : `${currency} `}${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

@Injectable()
export class PaymentReceiptsService {
  private readonly logger = new Logger(PaymentReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
  ) {}

  // Best-effort: a missing/unreadable logo must never block invoice generation or sending.
  private async getOrgLogoBuffer(logoKey: string | null | undefined): Promise<Buffer | undefined> {
    if (!logoKey) return undefined;
    try {
      return await this.storage.getObjectBuffer(logoKey);
    } catch (err) {
      this.logger.warn(`Failed to fetch org logo (${logoKey}): ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /**
   * Generates and emails a PDF invoice for a paid payment. Fire-and-forget from
   * the payment flow — it never throws. Idempotent: a payment whose invoice was
   * already sent (invoiceSentAt set) is skipped, so retries and duplicate
   * webhook deliveries don't double-send.
   */
  async sendInvoiceForPayment(paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: { lead: { include: { org: true } } },
      });
      if (!payment) return;
      if (payment.invoiceSentAt) return; // already sent — idempotent

      const lead = payment.lead;
      if (!lead?.email) {
        this.logger.warn(`Lead ${lead?.id ?? '?'} has no email — skipping invoice for payment ${paymentId}`);
        return;
      }

      const org = lead.org;
      if (org && !mergeNotificationSettings(org.notificationSettings).paymentReceived.email) {
        this.logger.log(`Org ${lead.orgId} has paymentReceived notifications off — skipping invoice email for payment ${paymentId}`);
        return;
      }
      if (!(await this.billing.hasEmailQuota(lead.orgId))) {
        this.logger.warn(`Org ${lead.orgId} has exhausted its email quota — skipping invoice email for payment ${paymentId}`);
        return;
      }
      const includeGst = payment.includeGstNumber && !!org?.gstNumber;
      const invoiceNumber = payment.invoiceNumber ?? this.makeInvoiceNumber(payment.id, payment.createdAt);

      const pdf = await this.buildInvoicePdf(
        {
          invoiceNumber,
          issuedAt: payment.paidAt ?? new Date(),
          amount: payment.amount,
          currency: payment.currency,
          gstPercent: payment.gstPercent,
          discountAmount: payment.discountAmount,
          includeGst,
          reference: payment.gatewayPaymentId,
        },
        {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          course: lead.course,
        },
        {
          name: org?.name ?? 'GenX CRM',
          city: org?.city ?? null,
          state: org?.state ?? null,
          country: org?.country ?? null,
          email: org?.email ?? null,
          phone: org?.phone ?? null,
          gstNumber: org?.gstNumber ?? null,
          logoKey: org?.logoKey ?? null,
        },
        await this.getOrgLogoBuffer(org?.logoKey),
      );

      await this.mail.sendRaw(
        lead.email,
        `Invoice ${invoiceNumber} — ${org?.name ?? 'GenX CRM'}`,
        this.invoiceEmailHtml(lead.name, invoiceNumber, inr(payment.amount, payment.currency)),
        [{ filename: `${invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
      );
      void this.billing.recordEmailSent(lead.orgId);

      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { invoiceNumber, invoiceSentAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Failed to send invoice for payment ${paymentId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private makeInvoiceNumber(paymentId: string, createdAt: Date): string {
    const year = createdAt.getFullYear();
    return `INV-${year}-${paymentId.slice(0, 8).toUpperCase()}`;
  }

  private invoiceEmailHtml(name: string, invoiceNumber: string, total: string): string {
    return `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">
        <p>Hi ${name},</p>
        <p>Thank you for your payment. Your invoice <strong>${invoiceNumber}</strong> for
        <strong>${total}</strong> is attached as a PDF.</p>
        <p>If you have any questions about this invoice, just reply to this email.</p>
        <p style="color:#667">— Team GenX CRM</p>
      </div>`;
  }

  // Builds the invoice PDF in memory and resolves the bytes. Public so it can be unit-tested.
  // logoBuffer is fetched by the caller via StorageService, matching InvoicesService's
  // buildInvoicePdf so both PDF builders stay storage-agnostic.
  buildInvoicePdf(data: InvoiceData, lead: InvoiceLead, org: InvoiceOrg, logoBuffer?: Buffer | null): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      registerInrFonts(doc);

      const teal = '#0d9488';
      const muted = '#667085';
      const logoSize = 60;

      // Absolute-positioned top-right (545 = the same right margin the totals block below
      // uses as its own `rightX`), so it never disturbs the left-aligned header text flow.
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, 545 - logoSize, 45, { fit: [logoSize, logoSize] });
        } catch {
          // Corrupt/unsupported image bytes shouldn't break invoice generation.
        }
      }

      // ── Header: seller (org) ──────────────────────────────────────────────
      doc.fillColor(teal).fontSize(20).font(PDF_FONT_BOLD).text(org.name, { continued: false });
      doc.moveDown(0.2);
      doc.fillColor(muted).fontSize(9).font(PDF_FONT);
      const addr = [org.city, org.state, org.country].filter(Boolean).join(', ');
      if (addr) doc.text(addr);
      const contact = [org.email, org.phone].filter(Boolean).join('  ·  ');
      if (contact) doc.text(contact);
      if (data.includeGst && org.gstNumber) {
        doc.fillColor('#1a1a1a').font(PDF_FONT_BOLD).text(`GSTIN: ${org.gstNumber}`);
      }

      // ── Title ─────────────────────────────────────────────────────────────
      doc.moveDown(1.2);
      doc.fillColor('#1a1a1a').fontSize(16).font(PDF_FONT_BOLD).text('TAX INVOICE');
      doc.fillColor(muted).fontSize(9).font(PDF_FONT);
      doc.text(`Invoice No: ${data.invoiceNumber}`);
      doc.text(`Date: ${data.issuedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);

      // ── Bill to (lead) ────────────────────────────────────────────────────
      doc.moveDown(1);
      doc.fillColor(muted).fontSize(9).font(PDF_FONT_BOLD).text('BILL TO');
      doc.fillColor('#1a1a1a').font(PDF_FONT).fontSize(11).text(lead.name);
      doc.fillColor(muted).fontSize(9);
      if (lead.email) doc.text(lead.email);
      if (lead.phone) doc.text(lead.phone);

      // ── Line items ────────────────────────────────────────────────────────
      doc.moveDown(1.5);
      const tableTop = doc.y;
      const rightX = 545;
      doc.fillColor(muted).fontSize(9).font(PDF_FONT_BOLD);
      doc.text('DESCRIPTION', 50, tableTop);
      doc.text('AMOUNT', rightX - 120, tableTop, { width: 120, align: 'right' });
      doc.moveTo(50, tableTop + 15).lineTo(rightX, tableTop + 15).strokeColor('#e5e7eb').stroke();

      // GST is treated as inclusive of the charged amount.
      const gross = data.amount;
      const gstAmount = data.gstPercent > 0 ? gross - gross / (1 + data.gstPercent / 100) : 0;
      const taxable = gross - gstAmount;

      let y = tableTop + 25;
      doc.fillColor('#1a1a1a').font(PDF_FONT).fontSize(10);
      doc.text(lead.course ? `Course enrollment — ${lead.course}` : 'Course enrollment', 50, y, { width: 350 });
      doc.text(inr(taxable, data.currency), rightX - 120, y, { width: 120, align: 'right' });
      y += 22;

      if (data.discountAmount > 0) {
        doc.fillColor(muted).text('Discount applied', 50, y, { width: 350 });
        doc.text(`- ${inr(data.discountAmount, data.currency)}`, rightX - 120, y, { width: 120, align: 'right' });
        y += 22;
      }

      doc.fillColor(muted).text(`GST (${data.gstPercent}%)`, 50, y, { width: 350 });
      doc.text(inr(gstAmount, data.currency), rightX - 120, y, { width: 120, align: 'right' });
      y += 28;

      doc.moveTo(50, y).lineTo(rightX, y).strokeColor('#e5e7eb').stroke();
      y += 10;
      doc.fillColor('#1a1a1a').font(PDF_FONT_BOLD).fontSize(12);
      doc.text('Total Paid', 50, y, { width: 350 });
      doc.text(inr(gross, data.currency), rightX - 120, y, { width: 120, align: 'right' });

      // ── Footer ────────────────────────────────────────────────────────────
      doc.moveDown(4);
      doc.fillColor(muted).font(PDF_FONT).fontSize(9);
      if (data.reference) doc.text(`Payment reference: ${data.reference}`);
      doc.text('This is a computer-generated invoice and does not require a signature.');

      doc.end();
    });
  }
}
