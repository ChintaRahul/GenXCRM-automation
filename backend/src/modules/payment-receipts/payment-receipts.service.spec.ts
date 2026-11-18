import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';
import { StorageService } from '../storage/storage.service';
import { PaymentReceiptsService } from './payment-receipts.service';

const basePayment = {
  id: 'pay-12345678',
  amount: 11800,
  currency: 'INR',
  gstPercent: 18,
  discountAmount: 0,
  includeGstNumber: true,
  invoiceNumber: null,
  invoiceSentAt: null,
  gatewayPaymentId: 'pay_abc',
  paidAt: new Date('2026-06-23'),
  createdAt: new Date('2026-06-23'),
  lead: {
    id: 'lead-1',
    name: 'Priya Sharma',
    email: 'priya@example.com',
    phone: '9876543210',
    course: 'MBA',
    orgId: 'org-1',
    org: {
      name: 'Acme Edu',
      city: 'Pune',
      state: 'MH',
      country: 'India',
      email: 'billing@acme.edu',
      phone: '020-111',
      gstNumber: '27ABCDE1234F1Z5',
    },
  },
};

describe('PaymentReceiptsService', () => {
  let service: PaymentReceiptsService;
  let prisma: { payment: { findUnique: jest.Mock; update: jest.Mock } };
  let mail: { sendRaw: jest.Mock };
  let billing: { hasEmailQuota: jest.Mock; recordEmailSent: jest.Mock };
  let storage: { getObjectBuffer: jest.Mock };

  beforeEach(async () => {
    prisma = {
      payment: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    mail = { sendRaw: jest.fn().mockResolvedValue(undefined) };
    billing = { hasEmailQuota: jest.fn().mockResolvedValue(true), recordEmailSent: jest.fn() };
    storage = { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-logo')) };
    const module = await Test.createTestingModule({
      providers: [
        PaymentReceiptsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: BillingService, useValue: billing },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(PaymentReceiptsService);
  });

  it('builds a valid PDF buffer', async () => {
    const pdf = await service.buildInvoicePdf(
      {
        invoiceNumber: 'INV-2026-PAY12345',
        issuedAt: new Date('2026-06-23'),
        amount: 11800,
        currency: 'INR',
        gstPercent: 18,
        discountAmount: 0,
        includeGst: true,
        reference: 'pay_abc',
      },
      { name: 'Priya', email: 'p@x.com', phone: '999', course: 'MBA' },
      {
        name: 'Acme',
        city: 'Pune',
        state: 'MH',
        country: 'India',
        email: 'b@acme.edu',
        phone: '1',
        gstNumber: '27ABCDE1234F1Z5',
      },
    );
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('emails the invoice and marks it sent', async () => {
    prisma.payment.findUnique.mockResolvedValue(basePayment);
    await service.sendInvoiceForPayment('pay-12345678');
    expect(mail.sendRaw).toHaveBeenCalledTimes(1);
    const [, , , attachments] = mail.sendRaw.mock.calls[0];
    expect(attachments[0].contentType).toBe('application/pdf');
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-12345678' },
        data: expect.objectContaining({ invoiceSentAt: expect.any(Date) }),
      }),
    );
  });

  it('is idempotent — skips when already sent', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...basePayment, invoiceSentAt: new Date() });
    await service.sendInvoiceForPayment('pay-12345678');
    expect(mail.sendRaw).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('skips when the lead has no email', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...basePayment,
      lead: { ...basePayment.lead, email: null },
    });
    await service.sendInvoiceForPayment('pay-12345678');
    expect(mail.sendRaw).not.toHaveBeenCalled();
  });

  it('never throws when the DB lookup fails', async () => {
    prisma.payment.findUnique.mockRejectedValue(new Error('db down'));
    await expect(service.sendInvoiceForPayment('pay-12345678')).resolves.toBeUndefined();
  });

  it('meters a sent invoice email against the org email quota', async () => {
    prisma.payment.findUnique.mockResolvedValue(basePayment);
    await service.sendInvoiceForPayment('pay-12345678');
    expect(billing.recordEmailSent).toHaveBeenCalledWith('org-1');
  });

  it('skips when notificationSettings.paymentReceived.email is off', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...basePayment,
      lead: { ...basePayment.lead, org: { ...basePayment.lead.org, notificationSettings: { paymentReceived: { email: false } } } },
    });
    await service.sendInvoiceForPayment('pay-12345678');
    expect(mail.sendRaw).not.toHaveBeenCalled();
  });

  it('sends when notificationSettings is unset (defaults to on)', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...basePayment,
      lead: { ...basePayment.lead, org: { ...basePayment.lead.org, notificationSettings: null } },
    });
    await service.sendInvoiceForPayment('pay-12345678');
    expect(mail.sendRaw).toHaveBeenCalledTimes(1);
  });

  it('skips the invoice email when the org has exhausted its email quota', async () => {
    prisma.payment.findUnique.mockResolvedValue(basePayment);
    billing.hasEmailQuota.mockResolvedValue(false);
    await service.sendInvoiceForPayment('pay-12345678');
    expect(mail.sendRaw).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});
