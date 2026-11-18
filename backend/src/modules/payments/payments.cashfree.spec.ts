import { Test } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';
import { IntegrationProvider, IntegrationStatus, PaymentGateway, PaymentStatus, Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentReceiptsService } from '../payment-receipts/payment-receipts.service';
import type { AuthUser } from '../../common/types/auth-user.type';

jest.mock('axios');
jest.mock('razorpay', () => jest.fn());
jest.mock('../../common/crypto.utils', () => ({
  encryptToken: jest.fn((t: string) => `enc:${t}`),
  decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockPrisma = {
  lead: { findFirst: jest.fn() },
  payment: { create: jest.fn(), findFirst: jest.fn() },
  orgIntegration: { findUnique: jest.fn() },
  invoice: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  emiInstallment: { updateMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
};
const mockReceipts = { sendInvoiceForPayment: jest.fn().mockResolvedValue(undefined) };

const director: AuthUser = {
  id: 'dir-1',
  name: 'Dir',
  email: 'dir@t.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};
const customer = { name: 'John', email: 'john@example.com', contact: '+919999999999' };
const orgCashfree = { status: IntegrationStatus.CONNECTED, accountId: 'TEST123', accessToken: 'enc:org_secret' };

const sign = (secret: string, timestamp: string, body: string) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}${body}`).digest('base64');

describe('PaymentsService — Cashfree', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.CASHFREE_APP_ID;
    delete process.env.CASHFREE_SECRET_KEY;
    delete process.env.API_URL;
    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentReceiptsService, useValue: mockReceipts },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  describe('isCashfreeConnected', () => {
    it('is false with no org integration and no platform keys', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.isCashfreeConnected('org-1')).resolves.toBe(false);
    });

    it("is true for the org's own CONNECTED integration, looked up by org + CASHFREE", async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      await expect(service.isCashfreeConnected('org-1')).resolves.toBe(true);
      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith({
        where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.CASHFREE } },
      });
    });

    it('falls back to the platform keys', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      process.env.CASHFREE_APP_ID = 'app';
      process.env.CASHFREE_SECRET_KEY = 'secret';
      await expect(service.isCashfreeConnected('org-1')).resolves.toBe(true);
    });
  });

  describe('createGatewayLink (CASHFREE)', () => {
    it('throws ForbiddenException when Cashfree is not configured', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(
        service.createGatewayLink(PaymentGateway.CASHFREE, 'org-1', 1000, 'INR', 'inv-1', customer),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('posts to the sandbox host for a TEST app id, with a bare 10-digit phone and the notes', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      mockedAxios.post.mockResolvedValue({ data: { link_id: 'gx_1', link_url: 'https://payments-test.cashfree.com/links/x' } });

      const result = await service.createGatewayLink(
        PaymentGateway.CASHFREE,
        'org-1',
        1500,
        'INR',
        'inv-1',
        customer,
        { kind: 'REGISTRATION_FEE' },
      );

      const [url, body, config] = mockedAxios.post.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { headers: Record<string, string> },
      ];
      expect(url).toBe('https://sandbox.cashfree.com/pg/links');
      expect(config.headers).toMatchObject({ 'x-client-id': 'TEST123', 'x-client-secret': 'org_secret' });
      expect(body).toMatchObject({
        link_amount: 1500,
        link_currency: 'INR',
        customer_details: expect.objectContaining({ customer_phone: '9999999999' }),
        link_notes: { leadId: 'inv-1', kind: 'REGISTRATION_FEE' },
      });
      expect(result).toEqual({ id: 'gx_1', shortUrl: 'https://payments-test.cashfree.com/links/x' });
    });

    it('uses the production host for a non-TEST app id and sends notify_url only over https', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ ...orgCashfree, accountId: 'LIVE123' });
      process.env.API_URL = 'https://api.example.com';
      mockedAxios.post.mockResolvedValue({ data: { link_id: 'gx_2', link_url: 'https://cftest/y' } });

      await service.createGatewayLink(PaymentGateway.CASHFREE, 'org-1', 100, 'INR', 'inv-1', customer);

      const [url, body] = mockedAxios.post.mock.calls[0] as [string, { link_meta?: { notify_url: string } }];
      expect(url).toBe('https://api.cashfree.com/pg/links');
      expect(body.link_meta?.notify_url).toBe('https://api.example.com/api/v1/payments/webhook/CASHFREE');
    });

    it('uses the sandbox host for a cfsk_ma_test_ secret even when the app id has no TEST prefix', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        ...orgCashfree,
        accountId: 'CF123ABC',
        accessToken: 'enc:cfsk_ma_test_abc_def',
      });
      mockedAxios.post.mockResolvedValue({ data: { link_id: 'gx_3', link_url: 'https://cf/z' } });

      await service.createGatewayLink(PaymentGateway.CASHFREE, 'org-1', 100, 'INR', 'inv-1', customer);

      expect(mockedAxios.post.mock.calls[0][0]).toBe('https://sandbox.cashfree.com/pg/links');
    });

    it('surfaces Cashfree rejection as ForbiddenException', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      mockedAxios.post.mockRejectedValue(new Error('boom'));
      await expect(
        service.createGatewayLink(PaymentGateway.CASHFREE, 'org-1', 100, 'INR', 'inv-1', customer),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createPayment with gateway CASHFREE', () => {
    it('creates the link through Cashfree and stores gateway CASHFREE with the link id', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', name: 'John', email: 'j@e.com', phone: '9999999999' });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      mockedAxios.post.mockResolvedValue({ data: { link_id: 'gx_9', link_url: 'https://cf/link' } });
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });

      await service.createPayment({ leadId: 'lead-1', amount: 500, gateway: PaymentGateway.CASHFREE }, director);

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gateway: PaymentGateway.CASHFREE,
            gatewayOrderId: 'gx_9',
            paymentLink: 'https://cf/link',
            status: PaymentStatus.LINK_SENT,
          }),
        }),
      );
    });
  });

  describe('handleWebhook (CASHFREE)', () => {
    const body = JSON.stringify({
      type: 'PAYMENT_LINK_EVENT',
      data: { link_id: 'gx_9', link_status: 'PAID', order: { transaction_id: 4455 } },
    });
    const payload = JSON.parse(body) as Record<string, unknown>;
    const payment = { id: 'pay-1', status: PaymentStatus.LINK_SENT, lead: { orgId: 'org-1' } };

    beforeEach(() => {
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      jest.spyOn(service, 'markPaid').mockResolvedValue({} as never);
    });

    it('marks the payment paid when the signature (timestamp + raw body, base64) is valid', async () => {
      const ts = '1700000000';
      await service.handleWebhook(
        PaymentGateway.CASHFREE,
        Buffer.from(body),
        sign('org_secret', ts, body),
        payload,
        ts,
      );
      expect(service.markPaid).toHaveBeenCalledWith('pay-1', '4455');
    });

    it('rejects a bad signature and does not mark paid', async () => {
      await expect(
        service.handleWebhook(PaymentGateway.CASHFREE, Buffer.from(body), 'bogus', payload, '1700000000'),
      ).rejects.toThrow(UnauthorizedException);
      expect(service.markPaid).not.toHaveBeenCalled();
    });

    it('rejects a missing timestamp (fails closed)', async () => {
      await expect(
        service.handleWebhook(PaymentGateway.CASHFREE, Buffer.from(body), sign('org_secret', '', body), payload),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when no credentials can be resolved for the owning org', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(
        service.handleWebhook(PaymentGateway.CASHFREE, Buffer.from(body), sign('x', '1', body), payload, '1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('ignores a PARTIALLY_PAID link even with a valid signature', async () => {
      const partial = JSON.stringify({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'gx_9', link_status: 'PARTIALLY_PAID' } });
      await service.handleWebhook(
        PaymentGateway.CASHFREE,
        Buffer.from(partial),
        sign('org_secret', '1', partial),
        JSON.parse(partial) as Record<string, unknown>,
        '1',
      );
      expect(service.markPaid).not.toHaveBeenCalled();
    });

    it('ignores events for links we do not know', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      await service.handleWebhook(PaymentGateway.CASHFREE, Buffer.from(body), 'x', payload, '1');
      expect(service.markPaid).not.toHaveBeenCalled();
    });

    it('marks a registration-fee invoice paid via the echoed link_notes', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
      const reg = JSON.stringify({
        type: 'PAYMENT_LINK_EVENT',
        data: { link_id: 'gx_7', link_status: 'PAID', link_notes: { kind: 'REGISTRATION_FEE', invoiceId: 'inv-1' } },
      });
      await service.handleWebhook(
        PaymentGateway.CASHFREE,
        Buffer.from(reg),
        sign('org_secret', '1', reg),
        JSON.parse(reg) as Record<string, unknown>,
        '1',
      );
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', registrationFeePaidAt: null },
        data: { registrationFeePaidAt: expect.any(Date) },
      });
    });
  });

  describe('createCashfreeSubscription', () => {
    const firstCharge = new Date('2026-12-01T00:00:00.000Z');

    it('throws ForbiddenException when Cashfree is not configured', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(
        service.createCashfreeSubscription('org-1', 1000, 'INR', 6, firstCharge, customer),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('posts an inline monthly plan to the sandbox and returns the hosted authorize page URL', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      process.env.FRONTEND_URL = 'https://app.example.com/';
      mockedAxios.post.mockResolvedValue({ data: { subscription_session_id: 'subs_tok_1' } });

      const result = await service.createCashfreeSubscription('org-1', 2500, 'INR', 6, firstCharge, customer, {
        invoiceId: 'inv-1',
        kind: 'EMI_MANDATE',
      });

      const [url, body, config] = mockedAxios.post.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { headers: Record<string, string> },
      ];
      expect(url).toBe('https://sandbox.cashfree.com/pg/subscriptions');
      expect(config.headers['x-api-version']).toBe('2026-01-01');
      expect(body).toMatchObject({
        plan_details: expect.objectContaining({
          plan_type: 'PERIODIC',
          plan_amount: 2500,
          plan_max_cycles: 6,
          plan_interval_type: 'MONTH',
        }),
        customer_details: expect.objectContaining({ customer_phone: '9999999999' }),
        subscription_first_charge_time: firstCharge.toISOString(),
        subscription_tags: { invoiceId: 'inv-1', kind: 'EMI_MANDATE' },
      });
      expect(result.subscriptionId).toMatch(/^gxs_/);
      expect(result.shortUrl).toBe('https://app.example.com/authorize-mandate?s=subs_tok_1&m=sandbox');
      delete process.env.FRONTEND_URL;
    });

    it('pushes a same-day or past first charge date out to at least tomorrow', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      mockedAxios.post.mockResolvedValue({ data: { subscription_session_id: 'tok' } });

      await service.createCashfreeSubscription('org-1', 1000, 'INR', 6, new Date('2020-01-01T00:00:00Z'), customer);

      const body = mockedAxios.post.mock.calls[0][1] as { subscription_first_charge_time: string };
      const sentMs = new Date(body.subscription_first_charge_time).getTime();
      expect(sentMs).toBeGreaterThanOrEqual(Date.now() + 23 * 60 * 60 * 1000);
    });

    it('surfaces a Cashfree rejection as ForbiddenException', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
      mockedAxios.post.mockRejectedValue(new Error('boom'));
      await expect(
        service.createCashfreeSubscription('org-1', 1000, 'INR', 6, firstCharge, customer),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('handleWebhook (CASHFREE subscriptions)', () => {
    const invoice = { id: 'inv-1', orgId: 'org-1', emiMandateStatus: 'CREATED' };
    const send = (body: string, ts = '1700000000', sig?: string) =>
      service.handleWebhook(
        PaymentGateway.CASHFREE,
        Buffer.from(body),
        sig ?? sign('org_secret', ts, body),
        JSON.parse(body) as Record<string, unknown>,
        ts,
      );

    beforeEach(() => {
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(orgCashfree);
    });

    it('rejects a bad signature without touching any state', async () => {
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: { subscription_details: { subscription_id: 'gxs_1', subscription_status: 'ACTIVE' } },
      });
      await expect(send(body, '1700000000', 'bogus')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('ignores an event for a subscription we do not know', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: { subscription_details: { subscription_id: 'nope', subscription_status: 'ACTIVE' } },
      });
      await send(body);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it.each([
      ['ACTIVE', 'ACTIVE'],
      ['CUSTOMER_CANCELLED', 'CANCELLED'],
      ['ON_HOLD', 'HALTED'],
      ['COMPLETED', 'COMPLETED'],
    ])('maps subscription_status %s to mandate status %s', async (cashfree, expected) => {
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: { subscription_details: { subscription_id: 'gxs_1', subscription_status: cashfree } },
      });
      await send(body);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { emiMandateStatus: expected },
      });
    });

    it('moves CREATED to AUTHENTICATED on a successful auth', async () => {
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_AUTH_STATUS',
        data: { subscription_id: 'gxs_1', payment_status: 'SUCCESS', payment_type: 'AUTH' },
      });
      await send(body);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { emiMandateStatus: 'AUTHENTICATED' },
      });
    });

    it('marks the earliest unpaid installment due by the scheduled date as paid on a CHARGE, even a few days late', async () => {
      mockPrisma.emiInstallment.findFirst.mockResolvedValue({ id: 'emi-1' });
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        data: {
          subscription_id: 'gxs_1',
          payment_status: 'SUCCESS',
          payment_type: 'CHARGE',
          payment_schedule_date: '2026-11-07T00:00:00Z',
        },
      });
      await send(body);
      const call = mockPrisma.emiInstallment.findFirst.mock.calls[0][0] as {
        where: { invoiceId: string; status: unknown; dueDate: { lte: Date } };
        orderBy: { installmentNumber: string };
      };
      expect(call.where.invoiceId).toBe('inv-1');
      expect(call.where.status).toEqual({ not: 'PAID' });
      expect(call.where.dueDate.lte.getTime()).toBeGreaterThan(new Date('2026-11-07T00:00:00Z').getTime());
      expect(call.orderBy).toEqual({ installmentNumber: 'asc' });
      expect(mockPrisma.emiInstallment.update).toHaveBeenCalledWith({
        where: { id: 'emi-1' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
    });

    it('marks nothing when every installment due by then is already paid (retried webhook)', async () => {
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(null);
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        data: { subscription_id: 'gxs_1', payment_status: 'SUCCESS', payment_type: 'CHARGE' },
      });
      await send(body);
      expect(mockPrisma.emiInstallment.update).not.toHaveBeenCalled();
    });

    it('does not mark anything paid for an AUTH-type payment', async () => {
      const body = JSON.stringify({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        data: { subscription_id: 'gxs_1', payment_status: 'SUCCESS', payment_type: 'AUTH' },
      });
      await send(body);
      expect(mockPrisma.emiInstallment.findFirst).not.toHaveBeenCalled();
    });
  });
});
