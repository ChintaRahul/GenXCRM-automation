import { computeEmiSchedule, computeInvoiceTotals, computeRemainingEmiSchedule } from './invoices.math';

describe('computeInvoiceTotals', () => {
  it('computes CGST+SGST totals for multiple line items with no discount', () => {
    // subtotal = 2*500 + 1*1000 + 3*200 = 1000 + 1000 + 600 = 2600
    // tax = 2600 * 18% = 468, cgst = sgst = 234, grandTotal = 2600 + 468 = 3068
    const result = computeInvoiceTotals({
      lineItems: [
        { quantity: 2, unitPrice: 500 },
        { quantity: 1, unitPrice: 1000 },
        { quantity: 3, unitPrice: 200 },
      ],
      discountType: 'PERCENT',
      discountValue: 0,
      gstEnabled: true,
      gstType: 'CGST_SGST',
      gstRate: 18,
    });

    expect(result.subtotal).toBe(2600);
    expect(result.discountAmount).toBe(0);
    expect(result.taxableAmount).toBe(2600);
    expect(result.taxAmount).toBe(468);
    expect(result.cgstAmount).toBe(234);
    expect(result.sgstAmount).toBe(234);
    expect(result.igstAmount).toBeNull();
    expect(result.grandTotal).toBe(3068);
  });

  it('applies a PERCENT discount before tax', () => {
    // subtotal = 1000, discount = 10% = 100, taxable = 900, tax @18% = 162, grandTotal = 1062
    const result = computeInvoiceTotals({
      lineItems: [{ quantity: 1, unitPrice: 1000 }],
      discountType: 'PERCENT',
      discountValue: 10,
      gstEnabled: true,
      gstType: 'CGST_SGST',
      gstRate: 18,
    });

    expect(result.subtotal).toBe(1000);
    expect(result.discountAmount).toBe(100);
    expect(result.taxableAmount).toBe(900);
    expect(result.taxAmount).toBe(162);
    expect(result.grandTotal).toBe(1062);
  });

  it('applies a FLAT discount before tax', () => {
    // subtotal = 1000, discount = 150, taxable = 850, tax @18% = 153, grandTotal = 1003
    const result = computeInvoiceTotals({
      lineItems: [{ quantity: 1, unitPrice: 1000 }],
      discountType: 'FLAT',
      discountValue: 150,
      gstEnabled: true,
      gstType: 'CGST_SGST',
      gstRate: 18,
    });

    expect(result.discountAmount).toBe(150);
    expect(result.taxableAmount).toBe(850);
    expect(result.taxAmount).toBe(153);
    expect(result.grandTotal).toBe(1003);
  });

  it('caps a FLAT discount larger than the subtotal at the subtotal', () => {
    const result = computeInvoiceTotals({
      lineItems: [{ quantity: 1, unitPrice: 500 }],
      discountType: 'FLAT',
      discountValue: 999,
      gstEnabled: false,
      gstType: 'CGST_SGST',
      gstRate: 18,
    });

    expect(result.subtotal).toBe(500);
    expect(result.discountAmount).toBe(500);
    expect(result.taxableAmount).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it('caps a PERCENT discount over 100% at the subtotal', () => {
    const result = computeInvoiceTotals({
      lineItems: [{ quantity: 1, unitPrice: 500 }],
      discountType: 'PERCENT',
      discountValue: 150,
      gstEnabled: false,
      gstType: 'CGST_SGST',
      gstRate: 18,
    });

    expect(result.discountAmount).toBe(500);
    expect(result.taxableAmount).toBe(0);
  });

  it('zeroes out tax and nulls all GST fields when gstEnabled is false', () => {
    const result = computeInvoiceTotals({
      lineItems: [{ quantity: 1, unitPrice: 1000 }],
      discountType: 'FLAT',
      discountValue: 0,
      gstEnabled: false,
      gstType: 'CGST_SGST',
      gstRate: 18,
    });

    expect(result.taxAmount).toBe(0);
    expect(result.cgstAmount).toBeNull();
    expect(result.sgstAmount).toBeNull();
    expect(result.igstAmount).toBeNull();
    expect(result.grandTotal).toBe(result.taxableAmount);
  });

  it('puts the full tax amount into igstAmount for IGST type, cgst/sgst null', () => {
    // subtotal = 1000, tax @18% = 180
    const result = computeInvoiceTotals({
      lineItems: [{ quantity: 1, unitPrice: 1000 }],
      discountType: 'FLAT',
      discountValue: 0,
      gstEnabled: true,
      gstType: 'IGST',
      gstRate: 18,
    });

    expect(result.taxAmount).toBe(180);
    expect(result.igstAmount).toBe(180);
    expect(result.cgstAmount).toBeNull();
    expect(result.sgstAmount).toBeNull();
  });
});

describe('computeEmiSchedule', () => {
  it('bases the schedule on negotiatedAmount, not grandTotal, when negotiatedAmount is set', () => {
    // base = 70000 (negotiated) - 10000 (registration fee) = 60000, / 3 = 20000 each.
    // If grandTotal (100000) were used instead, each installment would be 30000.
    const rows = computeEmiSchedule({
      grandTotal: 100000,
      registrationFee: 10000,
      negotiatedAmount: 70000,
      tenureMonths: 3,
      startDate: new Date('2026-01-01'),
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.amount === 20000)).toBe(true);
  });

  it('absorbs the rounding remainder into the last installment', () => {
    // base = 1000, / 3 = 333.33 repeating; first two are 333.33, last picks up the remainder.
    const rows = computeEmiSchedule({
      grandTotal: 1000,
      registrationFee: 0,
      tenureMonths: 3,
      startDate: new Date('2026-01-01'),
    });

    expect(rows[0].amount).toBe(333.33);
    expect(rows[1].amount).toBe(333.33);
    expect(rows[2].amount).toBe(333.34);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(1000, 2);
  });

  it('handles tenureMonths=1 as a single full-balance installment due on the start date', () => {
    const startDate = new Date('2026-03-15');
    const rows = computeEmiSchedule({
      grandTotal: 5000,
      registrationFee: 0,
      tenureMonths: 1,
      startDate,
    });

    expect(rows).toEqual([{ installmentNumber: 1, amount: 5000, dueDate: startDate }]);
  });
});

describe('computeRemainingEmiSchedule', () => {
  it('preserves paid installments untouched and only regenerates the remaining pending ones', () => {
    // base = 120000, tenureMonths = 6 => original schedule was 20000 each. Installments 1-2
    // (40000 total) already paid; the remaining 80000 is spread over installments 3-6.
    const rows = computeRemainingEmiSchedule({
      grandTotal: 120000,
      registrationFee: 0,
      tenureMonths: 6,
      startDate: new Date('2026-01-01'),
      paidInstallments: [
        { installmentNumber: 1, amount: 20000 },
        { installmentNumber: 2, amount: 20000 },
      ],
    });

    // Continues numbering at 3, and never re-emits rows for the already-paid 1-2 —
    // those remain the caller's responsibility to leave untouched in the DB.
    expect(rows.map((r) => r.installmentNumber)).toEqual([3, 4, 5, 6]);
    expect(rows.some((r) => r.installmentNumber === 1 || r.installmentNumber === 2)).toBe(false);
    expect(rows.every((r) => r.amount === 20000)).toBe(true);
    expect(rows[0].dueDate).toEqual(new Date('2026-03-01'));
    expect(rows[3].dueDate).toEqual(new Date('2026-06-01'));
  });

  it('computes the remaining balance from actual paid amounts, not an assumed even split', () => {
    // base = 90000 (negotiated) - 10000 (fee) = 80000, 1 installment already paid at 25000
    // (not the even 20000/4 split) => remainingBase = 80000 - 25000 = 55000 over 3 installments.
    const rows = computeRemainingEmiSchedule({
      grandTotal: 100000,
      registrationFee: 10000,
      negotiatedAmount: 90000,
      tenureMonths: 4,
      startDate: new Date('2026-01-01'),
      paidInstallments: [{ installmentNumber: 1, amount: 25000 }],
    });

    expect(rows.map((r) => r.installmentNumber)).toEqual([2, 3, 4]);
    expect(rows[0].amount).toBe(18333.33);
    expect(rows[1].amount).toBe(18333.33);
    expect(rows[2].amount).toBe(18333.34);
  });

  // markInstallmentPaid accepts any installment number regardless of order, so the paid set
  // is not necessarily a contiguous prefix. Deriving numbers from paidInstallments.length used
  // to emit [2,3,4,5,6] here — colliding with the already-paid #3 (P2002 on the createMany)
  // and shifting every due date by a month.
  it('fills exactly the unpaid installment numbers when a middle installment is paid', () => {
    // base = 60000 over 6 installments (10000 each); #3 paid at 10000 => remainingBase 50000
    // spread over the 5 gaps [1, 2, 4, 5, 6].
    const rows = computeRemainingEmiSchedule({
      grandTotal: 60000,
      registrationFee: 0,
      tenureMonths: 6,
      startDate: new Date('2026-01-01'),
      paidInstallments: [{ installmentNumber: 3, amount: 10000 }],
    });

    expect(rows.map((r) => r.installmentNumber)).toEqual([1, 2, 4, 5, 6]);
    expect(rows.every((r) => r.amount === 10000)).toBe(true);
    // Each row keeps its own month offset (installmentNumber - 1) from startDate.
    expect(rows[0].dueDate).toEqual(new Date('2026-01-01'));
    expect(rows[1].dueDate).toEqual(new Date('2026-02-01'));
    expect(rows[2].dueDate).toEqual(new Date('2026-04-01'));
    expect(rows[4].dueDate).toEqual(new Date('2026-06-01'));
  });

  it('handles several non-contiguous paid installments without reusing a number', () => {
    const rows = computeRemainingEmiSchedule({
      grandTotal: 50000,
      registrationFee: 0,
      tenureMonths: 5,
      startDate: new Date('2026-01-01'),
      paidInstallments: [
        { installmentNumber: 2, amount: 10000 },
        { installmentNumber: 5, amount: 10000 },
      ],
    });

    expect(rows.map((r) => r.installmentNumber)).toEqual([1, 3, 4]);
    expect(rows[0].amount).toBe(10000);
    expect(rows[2].amount).toBe(10000);
    expect(rows[2].dueDate).toEqual(new Date('2026-04-01'));
  });

  it('returns an empty array once every installment is already paid', () => {
    const rows = computeRemainingEmiSchedule({
      grandTotal: 10000,
      registrationFee: 0,
      tenureMonths: 2,
      startDate: new Date('2026-01-01'),
      paidInstallments: [
        { installmentNumber: 1, amount: 5000 },
        { installmentNumber: 2, amount: 5000 },
      ],
    });

    expect(rows).toEqual([]);
  });
});
