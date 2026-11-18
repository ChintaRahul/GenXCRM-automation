// Pure GST/discount + EMI math for invoices. No Prisma imports, no NestJS
// decorators — easily unit-testable in isolation.

export interface LineItemInput {
  quantity: number;
  unitPrice: number;
}

export type GstType = 'CGST_SGST' | 'IGST';
export type DiscountType = 'PERCENT' | 'FLAT';

export interface InvoiceTotalsInput {
  lineItems: LineItemInput[];
  discountType: DiscountType;
  discountValue: number;
  gstEnabled: boolean;
  gstType: GstType;
  gstRate: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  grandTotal: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const subtotal = round2(input.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0));
  const rawDiscount = input.discountType === 'PERCENT' ? subtotal * (input.discountValue / 100) : input.discountValue;
  const discountAmount = round2(Math.min(rawDiscount, subtotal));
  const taxableAmount = round2(subtotal - discountAmount);
  const taxAmount = input.gstEnabled ? round2(taxableAmount * (input.gstRate / 100)) : 0;
  const cgstAmount = input.gstEnabled && input.gstType === 'CGST_SGST' ? round2(taxAmount / 2) : null;
  const sgstAmount = cgstAmount;
  const igstAmount = input.gstEnabled && input.gstType === 'IGST' ? taxAmount : null;
  const grandTotal = round2(taxableAmount + taxAmount);
  return { subtotal, discountAmount, taxableAmount, taxAmount, cgstAmount, sgstAmount, igstAmount, grandTotal };
}

// ─── EMI schedule math ──────────────────────────────────────────────────────

export interface EmiScheduleInput {
  grandTotal: number;
  registrationFee: number;
  negotiatedAmount?: number;
  tenureMonths: number;
  startDate: Date;
}

export interface EmiScheduleRow {
  installmentNumber: number;
  amount: number;
  dueDate: Date;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function computeEmiSchedule(input: EmiScheduleInput): EmiScheduleRow[] {
  const base = Math.max(
    (input.negotiatedAmount && input.negotiatedAmount > 0 ? input.negotiatedAmount : input.grandTotal) -
      input.registrationFee,
    0,
  );
  const perEmi = round2(base / input.tenureMonths);
  return Array.from({ length: input.tenureMonths }, (_, i) => ({
    installmentNumber: i + 1,
    amount: i === input.tenureMonths - 1 ? round2(base - perEmi * (input.tenureMonths - 1)) : perEmi,
    dueDate: addMonths(input.startDate, i),
  }));
}

// Recompute variant used when some installments are already PAID: preserves those rows'
// amount/dueDate untouched, and only regenerates the remaining PENDING ones against the
// balance still owed, spread over however many installments remain.
//
// Keys off the actual paid installment NUMBERS, not just how many are paid: markInstallmentPaid
// lets any installment be paid out of order (e.g. #3 of 6 while #1/#2 are pending), so the paid
// set is not necessarily a contiguous prefix. Assuming it was produced colliding installment
// numbers on the regenerated rows (P2002 on @@unique([invoiceId, installmentNumber])) and wrong
// due dates. Each regenerated row keeps its own month offset (installmentNumber - 1) from
// startDate, exactly as the from-scratch computeEmiSchedule path does.
export function computeRemainingEmiSchedule(input: {
  grandTotal: number;
  registrationFee: number;
  negotiatedAmount?: number;
  tenureMonths: number;
  startDate: Date;
  paidInstallments: { installmentNumber: number; amount: number }[];
}): EmiScheduleRow[] {
  const base = Math.max(
    (input.negotiatedAmount && input.negotiatedAmount > 0 ? input.negotiatedAmount : input.grandTotal) -
      input.registrationFee,
    0,
  );
  const paidTotal = input.paidInstallments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBase = Math.max(base - paidTotal, 0);

  const paidNumbers = new Set(input.paidInstallments.map((p) => p.installmentNumber));
  const remainingNumbers = Array.from({ length: input.tenureMonths }, (_, i) => i + 1).filter(
    (n) => !paidNumbers.has(n),
  );
  const remainingCount = remainingNumbers.length;
  if (remainingCount === 0) return [];

  const perEmi = round2(remainingBase / remainingCount);
  return remainingNumbers.map((installmentNumber, i) => ({
    installmentNumber,
    amount: i === remainingCount - 1 ? round2(remainingBase - perEmi * (remainingCount - 1)) : perEmi,
    dueDate: addMonths(input.startDate, installmentNumber - 1),
  }));
}
