import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { PaymentsService } from '../payments/payments.service';
import { CommunicationsService } from '../communications/communications.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  invoice: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  invoiceLineItem: {
    deleteMany: jest.fn(),
  },
  emiInstallment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
  messageTemplate: {
    findFirst: jest.fn(),
  },
  lead: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};
mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));

const mockStorage = {
  buildInvoiceRegistrationScreenshotKey: jest.fn(
    (invoiceId: string, ext: string) => `invoices/${invoiceId}/registration-screenshot.${ext}`,
  ),
  getPresignedUploadUrl: jest.fn(),
  getPresignedDownloadUrl: jest.fn(),
};

const mockMail = {
  send: jest.fn(),
  sendRaw: jest.fn().mockResolvedValue(undefined),
};

const mockPayments = {
  isRazorpayConnected: jest.fn(),
  isCashfreeConnected: jest.fn(),
  createRazorpayLink: jest.fn(),
  createGatewayLink: jest.fn(),
  createRazorpaySubscription: jest.fn(),
  createCashfreeSubscription: jest.fn(),
};

const mockCommunications = {
  sendWhatsApp: jest.fn().mockResolvedValue({ id: 'comm-1' }),
  sendWhatsAppTemplate: jest.fn().mockResolvedValue({ id: 'comm-1' }),
};

const mockLead = { id: 'lead-1', name: 'John' };

const repUser: AuthUser = {
  id: 'rep-1',
  name: 'Rep',
  email: 'rep@t.com',
  role: Role.SALES_REP,
  teamId: 'team-1',
  orgId: 'org-1',
};
const managerUser: AuthUser = {
  id: 'mgr-1',
  name: 'Mgr',
  email: 'mgr@t.com',
  role: Role.MANAGER,
  teamId: 'team-1',
  orgId: 'org-1',
};
const directorUser: AuthUser = {
  id: 'dir-1',
  name: 'Dir',
  email: 'dir@t.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};
const noOrgUser: AuthUser = { id: 'x-1', name: 'X', email: 'x@t.com', role: Role.DIRECTOR, teamId: null, orgId: null };

describe('InvoicesService', () => {
  let service: InvoicesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: MailService, useValue: mockMail },
        { provide: PaymentsService, useValue: mockPayments },
        { provide: CommunicationsService, useValue: mockCommunications },
      ],
    }).compile();
    service = module.get(InvoicesService);
  });

  describe('list', () => {
    it('scopes to org only for DIRECTOR', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({}, directorUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: 'org-1', isDeleted: false },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('scopes to lead.assignedToId for SALES_REP', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({}, repUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', lead: { assignedToId: 'rep-1' } }),
        }),
      );
    });

    it('scopes to lead.teamId for MANAGER', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({}, managerUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', lead: { teamId: 'team-1' } }),
        }),
      );
    });

    it('caps limit at 100 and applies status filter', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({ status: 'SENT', page: 2, limit: 500 }, directorUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SENT' }),
          skip: 100,
          take: 100,
        }),
      );
    });

    it('includes the lead relation so the list page can render the Lead column', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({}, directorUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            lead: { select: { id: true, name: true } },
            lineItems: { orderBy: { sortOrder: 'asc' } },
          },
        }),
      );
    });

    it('strips registrationScreenshotKey from every returned invoice (CLAUDE.md rule 6)', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', registrationScreenshotKey: 'invoices/inv-1/registration-screenshot.png' },
        { id: 'inv-2', registrationScreenshotKey: null },
      ]);
      mockPrisma.invoice.count.mockResolvedValue(2);

      const result = await service.list({}, directorUser);

      expect(result.data).toHaveLength(2);
      for (const invoice of result.data) {
        expect(invoice).not.toHaveProperty('registrationScreenshotKey');
      }
    });

    it('filters to registeredAt not null when registered=true', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({ registered: true }, directorUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ registeredAt: { not: null } }),
        }),
      );
    });

    it('does not filter by registeredAt when registered is omitted', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);
      await service.list({}, directorUser);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', isDeleted: false } }),
      );
    });
  });

  describe('getNextNumber', () => {
    it('throws ForbiddenException when orgId is missing', async () => {
      await expect(service.getNextNumber(noOrgUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.count).not.toHaveBeenCalled();
    });

    it('computes but does not persist the next invoice number', async () => {
      mockPrisma.invoice.count.mockResolvedValue(3);
      const year = new Date().getFullYear();
      const result = await service.getNextNumber(directorUser);
      expect(result).toEqual({ invoiceNumber: `INV-${year}-0004` });
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', invoiceNumber: { startsWith: `INV-${year}-` } } }),
      );
    });
  });

  describe('getById', () => {
    it('scopes lookup to lead.assignedToId for SALES_REP', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      await service.getById('inv-1', repUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'inv-1', orgId: 'org-1', lead: { assignedToId: 'rep-1' } }),
        }),
      );
    });

    it('scopes lookup to lead.teamId for MANAGER', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      await service.getById('inv-1', managerUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lead: { teamId: 'team-1' } }),
        }),
      );
    });

    it('scopes lookup to org only for DIRECTOR, no lead filter', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      await service.getById('inv-1', directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1', orgId: 'org-1', isDeleted: false } }),
      );
    });

    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.getById('inv-1', repUser)).rejects.toThrow(NotFoundException);
    });

    it('strips registrationScreenshotKey from the returned invoice (CLAUDE.md rule 6)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        registrationScreenshotKey: 'invoices/inv-1/registration-screenshot.png',
      });
      const result = await service.getById('inv-1', directorUser);
      expect(result).not.toHaveProperty('registrationScreenshotKey');
      expect(result).toEqual({ id: 'inv-1' });
    });

    // The client-facing include must never pull the whole Organization row: it carries
    // orgWebhookToken (the bearer credential for the inbound lead-capture webhooks) plus
    // plan/trial/quota internals. Assert on the Prisma `include` because that select is what
    // actually keeps those columns out of the response — nothing downstream strips them.
    it('never requests sensitive Organization columns (orgWebhookToken et al.)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      await service.getById('inv-1', directorUser);

      const { include } = mockPrisma.invoice.findFirst.mock.calls[0][0];
      expect(include.org).toEqual({ select: expect.any(Object) });
      const requested = Object.keys(include.org.select);
      for (const forbidden of [
        'orgWebhookToken',
        'planStatus',
        'trialEndsAt',
        'emailsSentThisCycle',
        'emailCycleStartedAt',
        'ownerId',
        'domain',
        'slug',
      ]) {
        expect(requested).not.toContain(forbidden);
      }
      expect(requested).toEqual(
        expect.arrayContaining(['name', 'city', 'state', 'country', 'email', 'phone', 'gstNumber']),
      );
    });

    it('returns no Organization field outside the safe display allowlist', async () => {
      // Faithful to what Prisma returns for the select above — the point of the assertion is
      // that the sensitive columns are simply never fetched, so they cannot leak.
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        org: {
          id: 'org-1',
          name: 'Acme Edu',
          city: null,
          state: null,
          country: 'India',
          email: null,
          phone: null,
          gstNumber: null,
        },
      });
      const result = (await service.getById('inv-1', directorUser)) as { org: Record<string, unknown> };
      expect(result.org).not.toHaveProperty('orgWebhookToken');
      expect(result.org).not.toHaveProperty('planStatus');
      expect(result.org).not.toHaveProperty('ownerId');
    });
  });

  describe('getInvoicePdf', () => {
    const fullInvoice = {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-0001',
      invoiceDate: new Date('2026-06-01'),
      dueDate: null,
      notes: null,
      gstEnabled: true,
      gstType: 'CGST_SGST',
      gstRate: 18,
      subtotal: 1000,
      discountAmount: 0,
      taxableAmount: 1000,
      taxAmount: 180,
      cgstAmount: 90,
      sgstAmount: 90,
      igstAmount: null,
      grandTotal: 1180,
      lineItems: [{ courseName: 'MBA', quantity: 2, unitPrice: 500, lineTotal: 1000 }],
      emiInstallments: [],
      lead: { name: 'John', email: 'john@test.com', phone: '999' },
      org: { name: 'Acme Edu', city: null, state: null, country: 'India', email: null, phone: null, gstNumber: null },
    };

    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.getInvoicePdf('inv-1', repUser)).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup to orgId (via buildInvoiceScopeFilter)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(fullInvoice);
      await service.getInvoicePdf('inv-1', directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'inv-1', orgId: 'org-1' }) }),
      );
    });

    it('returns a PDF buffer and a filename derived from the invoice number', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(fullInvoice);
      const result = await service.getInvoicePdf('inv-1', directorUser);
      expect(result.filename).toBe('INV-2026-0001.pdf');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  describe('create', () => {
    const baseDto = {
      leadId: 'lead-1',
      lineItems: [{ courseName: 'Course A', quantity: 2, unitPrice: 500 }],
      gstEnabled: true,
      gstType: 'CGST_SGST' as const,
      gstRate: 18,
      discountType: 'FLAT' as const,
      discountValue: 0,
    };

    it('throws ForbiddenException when caller.orgId is missing', async () => {
      await expect(service.create(baseDto, noOrgUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an out-of-scope leadId with NotFoundException', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.create(baseDto, repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('computes and persists totals matching computeInvoiceTotals for a known input', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });
      const year = new Date().getFullYear();

      await service.create(baseDto, directorUser);

      // subtotal = 2*500 = 1000, no discount, tax @18% = 180, cgst=sgst=90, grandTotal=1180
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            leadId: 'lead-1',
            invoiceNumber: `INV-${year}-0001`,
            status: 'DRAFT',
            subtotal: 1000,
            discountAmount: 0,
            taxableAmount: 1000,
            taxAmount: 180,
            cgstAmount: 90,
            sgstAmount: 90,
            igstAmount: null,
            grandTotal: 1180,
            createdById: 'dir-1',
          }),
        }),
      );
    });

    it('passes batchId and batchLabel through to the created line items', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      await service.create(
        {
          ...baseDto,
          lineItems: [
            {
              courseId: 'course-1',
              courseName: 'Course A',
              batchId: 'batch-1',
              batchLabel: 'Batch A – Morning',
              quantity: 2,
              unitPrice: 500,
            },
          ],
        },
        directorUser,
      );

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lineItems: expect.objectContaining({
              create: [expect.objectContaining({ batchId: 'batch-1', batchLabel: 'Batch A – Morning' })],
            }),
          }),
        }),
      );
    });

    it.each([
      ['negative quantity', { lineItems: [{ courseName: 'A', quantity: -1, unitPrice: 500 }] }],
      ['negative unitPrice', { lineItems: [{ courseName: 'A', quantity: 1, unitPrice: -500 }] }],
      ['gstRate above 100', { gstRate: 250 }],
      ['negative gstRate', { gstRate: -1 }],
      ['negative discountValue', { discountValue: -50 }],
    ])('rejects %s with BadRequestException before touching the DB', async (_label, override) => {
      await expect(service.create({ ...baseDto, ...override }, directorUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('retries with a freshly generated number when the first create hits a P2002 on invoiceNumber', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      // First attempt sees 0 existing invoices, loses the race; second sees 1 and wins.
      mockPrisma.invoice.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      mockPrisma.invoice.create
        .mockRejectedValueOnce(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['orgId', 'invoiceNumber'] },
          }),
        )
        .mockResolvedValueOnce({ id: 'inv-1' });
      const year = new Date().getFullYear();

      const result = await service.create(baseDto, directorUser);

      expect(mockPrisma.invoice.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.invoice.create.mock.calls[0][0].data.invoiceNumber).toBe(`INV-${year}-0001`);
      expect(mockPrisma.invoice.create.mock.calls[1][0].data.invoiceNumber).toBe(`INV-${year}-0002`);
      expect(result).toEqual({ id: 'inv-1' });
    });

    it('gives up with a clear error after repeated invoice-number collisions', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['orgId', 'invoiceNumber'] },
        }),
      );

      await expect(service.create(baseDto, directorUser)).rejects.toThrow(ConflictException);
      expect(mockPrisma.invoice.create).toHaveBeenCalledTimes(3);
    });

    it('does not retry (or swallow) an unrelated Prisma error', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockRejectedValue(Object.assign(new Error('FK violation'), { code: 'P2003' }));

      await expect(service.create(baseDto, directorUser)).rejects.toThrow('FK violation');
      expect(mockPrisma.invoice.create).toHaveBeenCalledTimes(1);
    });

    it('validates the leadId against buildLeadScopeFilter for the caller', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });
      await service.create(baseDto, repUser);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'lead-1', assignedToId: 'rep-1' }) }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.update('inv-1', { notes: 'x' }, repUser)).rejects.toThrow(NotFoundException);
    });

    it('rejects a negative unitPrice with BadRequestException before touching the DB', async () => {
      await expect(
        service.update('inv-1', { lineItems: [{ courseName: 'A', quantity: 1, unitPrice: -1 }] }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range gstRate with BadRequestException', async () => {
      await expect(service.update('inv-1', { gstRate: 1000 }, directorUser)).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when the invoice is already PAID', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'PAID', lineItems: [] });
      await expect(service.update('inv-1', { notes: 'updated' }, directorUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the invoice is CANCELLED (voided)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'CANCELLED', lineItems: [] });
      await expect(service.update('inv-1', { notes: 'updated' }, directorUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('scopes the existence check to lead.assignedToId for SALES_REP', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', lineItems: [] });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.update('inv-1', { notes: 'updated' }, repUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { assignedToId: 'rep-1' } }) }),
      );
    });

    it('scopes the existence check to lead.teamId for MANAGER', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', lineItems: [] });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.update('inv-1', { notes: 'updated' }, managerUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { teamId: 'team-1' } }) }),
      );
    });

    it('scopes the existence check to org only for DIRECTOR, no lead filter', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', lineItems: [] });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.update('inv-1', { notes: 'updated' }, directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1', orgId: 'org-1', isDeleted: false } }),
      );
    });

    it('updates scalar fields only when no GST/discount/lineItems fields change', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', lineItems: [] });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.update('inv-1', { notes: 'updated' }, directorUser);
      expect(mockPrisma.invoiceLineItem.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1' }, data: { notes: 'updated' } }),
      );
    });

    it('recomputes totals and replaces line items wholesale when lineItems change', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        lineItems: [],
        gstEnabled: true,
        gstType: 'CGST_SGST',
        gstRate: 18,
        discountType: 'FLAT',
        discountValue: 0,
      });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });

      await service.update(
        'inv-1',
        { lineItems: [{ courseName: 'Course B', quantity: 1, unitPrice: 1000 }] },
        directorUser,
      );

      expect(mockPrisma.invoiceLineItem.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' } });
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 1000, taxAmount: 180, grandTotal: 1180 }),
        }),
      );
    });

    it('rejects a negative registrationFee with BadRequestException', async () => {
      await expect(service.update('inv-1', { registrationFee: -1 }, directorUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
    });

    it('updates registrationFee/registrationPaymentMode/registrationNote as scalar fields', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', lineItems: [] });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.update(
        'inv-1',
        { registrationFee: 6000, registrationPaymentMode: 'SCREENSHOT', registrationNote: 'UPI ref 123' },
        directorUser,
      );
      expect(mockPrisma.invoiceLineItem.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            registrationFee: 6000,
            registrationPaymentMode: 'SCREENSHOT',
            registrationNote: 'UPI ref 123',
          },
        }),
      );
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.updateStatus('inv-1', 'SENT', repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('scopes the existence check to lead.assignedToId for SALES_REP', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.updateStatus('inv-1', 'SENT', repUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { assignedToId: 'rep-1' } }) }),
      );
    });

    it('scopes the existence check to lead.teamId for MANAGER', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.updateStatus('inv-1', 'SENT', managerUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { teamId: 'team-1' } }) }),
      );
    });

    it('scopes the existence check to org only for DIRECTOR, no lead filter', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.updateStatus('inv-1', 'SENT', directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1', orgId: 'org-1', isDeleted: false } }),
      );
    });

    it('sets paidAt when transitioning to PAID', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.updateStatus('inv-1', 'PAID', directorUser);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAID', paidAt: expect.any(Date) }) }),
      );
    });

    it('does not set paidAt for a non-PAID transition', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.updateStatus('inv-1', 'SENT', directorUser);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'SENT' } });
    });

    it('allows voiding a SENT invoice (CANCELLED)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'CANCELLED' });
      await service.updateStatus('inv-1', 'CANCELLED', directorUser);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('throws ForbiddenException when voiding an already-PAID invoice', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'PAID' });
      await expect(service.updateStatus('inv-1', 'CANCELLED', directorUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the invoice is not found or out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.remove('inv-1', repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('scopes the existence check to lead.assignedToId for SALES_REP and soft-deletes', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.remove('inv-1', repUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { assignedToId: 'rep-1' } }) }),
      );
      expect(mockPrisma.invoice.delete).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { isDeleted: true },
      });
    });

    it('scopes the existence check to lead.teamId for MANAGER', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.remove('inv-1', managerUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lead: { teamId: 'team-1' } }) }),
      );
    });

    it('scopes the existence check to org only for DIRECTOR, no lead filter', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.remove('inv-1', directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1', orgId: 'org-1', isDeleted: false } }),
      );
    });
  });

  describe('generateFromRegistration', () => {
    const baseDto = {
      leadId: 'lead-1',
      lineItems: [{ courseName: 'Course A', quantity: 1, unitPrice: 1000 }],
    };

    it('throws ForbiddenException when caller.orgId is missing', async () => {
      await expect(service.generateFromRegistration(baseDto, noOrgUser)).rejects.toThrow(ForbiddenException);
    });

    it('rejects an out-of-scope leadId with NotFoundException', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.generateFromRegistration(baseDto, repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('rejects a negative line-item quantity with BadRequestException', async () => {
      await expect(
        service.generateFromRegistration(
          { ...baseDto, lineItems: [{ courseName: 'A', quantity: -2, unitPrice: 100 }] },
          directorUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });

    it('sets generatedFromRegistration true and does not set registeredAt, defaulting GST off and discount to flat/zero', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      await service.generateFromRegistration(baseDto, directorUser);

      // GST defaults off — the Register Student screen doesn't show tax settings unless the
      // rep explicitly turns it on, so silently taxing the invoice would overcharge.
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            generatedFromRegistration: true,
            status: 'DRAFT',
            gstEnabled: false,
            gstType: 'CGST_SGST',
            gstRate: 18,
            discountType: 'FLAT',
            discountValue: 0,
          }),
        }),
      );
      const call = mockPrisma.invoice.create.mock.calls[0][0];
      expect(call.data.registeredAt).toBeUndefined();
    });

    it('respects an explicitly provided gstEnabled:true override instead of the off-by-default', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      await service.generateFromRegistration(
        { ...baseDto, gstEnabled: true, discountType: 'PERCENT', discountValue: 10 },
        directorUser,
      );

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gstEnabled: true, discountType: 'PERCENT', discountValue: 10 }),
        }),
      );
    });

    it('reuses an existing not-yet-registered draft for the same lead instead of creating a duplicate', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-existing-draft' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-existing-draft', lineItems: [] });

      const result = await service.generateFromRegistration(baseDto, directorUser);

      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            leadId: 'lead-1',
            generatedFromRegistration: true,
            registeredAt: null,
          }),
        }),
      );
      expect(mockPrisma.invoiceLineItem.deleteMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-existing-draft' },
      });
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-existing-draft' } }),
      );
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'inv-existing-draft', lineItems: [] });
    });
  });

  describe('recordRegistrationPayment', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.recordRegistrationPayment('inv-1', { amount: 5000, mode: 'SAVE' }, repUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes the existence check by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      await service.recordRegistrationPayment('inv-1', { amount: 5000, mode: 'SAVE' }, directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('sets registeredAt/registeredById/registrationFee/registrationPaymentMode/registrationNote', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });

      await service.recordRegistrationPayment(
        'inv-1',
        { amount: 5000, mode: 'SCREENSHOT', note: 'Paid by cash' },
        directorUser,
      );

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          registeredAt: expect.any(Date),
          registeredById: 'dir-1',
          registrationFee: 5000,
          registrationPaymentMode: 'SCREENSHOT',
          registrationNote: 'Paid by cash',
        },
      });
    });

    // Regression guard for the cross-tenant read: the S3 key is written server-side at
    // presign time, so a client-supplied key must never reach the update.
    it('never writes a client-supplied screenshot key for mode=SCREENSHOT', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });

      await service.recordRegistrationPayment(
        'inv-1',
        {
          amount: 5000,
          mode: 'SCREENSHOT',
          // A hostile extra field on the request body — must be ignored entirely.
          screenshotUrl: 'invoices/victim-invoice/registration-screenshot.png',
        } as unknown as Parameters<typeof service.recordRegistrationPayment>[1],
        directorUser,
      );

      const { data } = mockPrisma.invoice.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('registrationScreenshotKey');
    });

    it('clears a stale registrationScreenshotKey when amending mode back to SAVE', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });

      // Invoice was previously registered via SCREENSHOT; amending back to SAVE must null
      // out the old key, not silently keep it (Prisma treats `undefined` as "leave
      // unchanged," which would otherwise leave the stale screenshot attached).
      await service.recordRegistrationPayment('inv-1', { amount: 5000, mode: 'SAVE' }, directorUser);

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: expect.objectContaining({
          registrationPaymentMode: 'SAVE',
          registrationScreenshotKey: null,
        }),
      });
    });
  });

  describe('sendRegistrationPaymentLink', () => {
    afterEach(() => {
      delete process.env.RAZORPAY_KEY_ID;
    });

    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(
        service.sendRegistrationPaymentLink('inv-1', { source: 'CUSTOM', customUrl: 'https://x.test' }, repUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('validates customUrl is present for source=CUSTOM', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      await expect(service.sendRegistrationPaymentLink('inv-1', { source: 'CUSTOM' }, directorUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns a confirmation shape for source=CUSTOM with a valid customUrl', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      const result = await service.sendRegistrationPaymentLink(
        'inv-1',
        { source: 'CUSTOM', customUrl: 'https://pay.example.com/x' },
        directorUser,
      );
      expect(result).toEqual({ sent: true, source: 'CUSTOM', url: 'https://pay.example.com/x' });
    });

    it('rejects a non-Razorpay gateway for source=GATEWAY', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      await expect(
        service.sendRegistrationPaymentLink(
          'inv-1',
          { source: 'GATEWAY', gateway: 'STRIPE' as unknown as 'RAZORPAY' },
          directorUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the registration fee is zero or unset', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        registrationFee: 0,
        lead: { name: 'John', email: 'john@test.com', phone: '9999999999' },
      });
      await expect(
        service.sendRegistrationPaymentLink('inv-1', { source: 'GATEWAY', gateway: 'RAZORPAY' }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPayments.createGatewayLink).not.toHaveBeenCalled();
    });

    it('charges dto.amount instead of the unset persisted registrationFee (step 3, before save)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        registrationFee: 0,
        lead: { name: 'John', email: 'john@test.com', phone: '9999999999' },
      });
      mockPayments.createGatewayLink.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/reg' });

      const result = await service.sendRegistrationPaymentLink(
        'inv-1',
        { source: 'GATEWAY', gateway: 'RAZORPAY', amount: 2500 },
        directorUser,
      );

      expect(mockPayments.createGatewayLink).toHaveBeenCalledWith(
        'RAZORPAY',
        'org-1',
        2500,
        'INR',
        'inv-1',
        expect.anything(),
        { invoiceId: 'inv-1', kind: 'REGISTRATION_FEE' },
      );
      expect(result).toEqual({ sent: true, source: 'GATEWAY', url: 'https://rzp.io/l/reg' });
    });

    it('throws when Razorpay is not configured for this org', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        registrationFee: 1000,
        lead: { name: 'John', email: 'john@test.com', phone: '9999999999' },
      });
      mockPayments.createGatewayLink.mockRejectedValue(new ForbiddenException('not configured'));
      await expect(
        service.sendRegistrationPaymentLink('inv-1', { source: 'GATEWAY', gateway: 'RAZORPAY' }, directorUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a real Razorpay link for the registration fee when configured', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        registrationFee: 1000,
        lead: { name: 'John', email: 'john@test.com', phone: '9999999999' },
      });
      mockPayments.createGatewayLink.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/reg' });

      const result = await service.sendRegistrationPaymentLink(
        'inv-1',
        { source: 'GATEWAY', gateway: 'RAZORPAY' },
        directorUser,
      );

      expect(mockPayments.createGatewayLink).toHaveBeenCalledWith(
        'RAZORPAY',
        'org-1',
        1000,
        'INR',
        'inv-1',
        { name: 'John', email: 'john@test.com', contact: '+919999999999' },
        { invoiceId: 'inv-1', kind: 'REGISTRATION_FEE' },
      );
      expect(result).toEqual({ sent: true, source: 'GATEWAY', url: 'https://rzp.io/l/reg' });
    });
  });

  describe('markRegistrationFeePaid', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.markRegistrationFeePaid('inv-1', repUser)).rejects.toThrow(NotFoundException);
    });

    it('sets registrationFeePaidAt when unset', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', registrationFeePaidAt: null });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', registrationFeePaidAt: new Date('2026-09-18') });

      const result = await service.markRegistrationFeePaid('inv-1', directorUser);

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { registrationFeePaidAt: expect.any(Date) },
      });
      expect(result.registrationFeePaidAt).toEqual(new Date('2026-09-18'));
    });

    it('is idempotent — keeps the original paidAt when already marked paid', async () => {
      const alreadyPaidAt = new Date('2026-09-01');
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', registrationFeePaidAt: alreadyPaidAt });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', registrationFeePaidAt: alreadyPaidAt });

      await service.markRegistrationFeePaid('inv-1', directorUser);

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { registrationFeePaidAt: alreadyPaidAt },
      });
    });
  });

  describe('getRegistrationScreenshotUploadUrl', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(
        service.getRegistrationScreenshotUploadUrl({ invoiceId: 'inv-1', contentType: 'image/png' }, repUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the existence check by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockStorage.getPresignedUploadUrl.mockResolvedValue('https://s3.test/upload');
      await service.getRegistrationScreenshotUploadUrl({ invoiceId: 'inv-1', contentType: 'image/png' }, directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('builds the key server-side, persists it, and returns only the upload URL', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' });
      mockStorage.getPresignedUploadUrl.mockResolvedValue('https://s3.test/upload');

      const result = await service.getRegistrationScreenshotUploadUrl(
        { invoiceId: 'inv-1', contentType: 'image/png' },
        directorUser,
      );

      expect(mockStorage.buildInvoiceRegistrationScreenshotKey).toHaveBeenCalledWith('inv-1', 'png');
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { registrationScreenshotKey: 'invoices/inv-1/registration-screenshot.png' },
      });
      // The raw key never goes back to the client (CLAUDE.md rule 6 + cross-tenant read fix).
      expect(result).toEqual({ uploadUrl: 'https://s3.test/upload' });
    });
  });

  describe('getRegistrationScreenshotDownloadUrl', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.getRegistrationScreenshotDownloadUrl('inv-1', repUser)).rejects.toThrow(NotFoundException);
    });

    it('scopes the existence check by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        registrationScreenshotKey: 'invoices/inv-1/registration-screenshot.png',
      });
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://s3.test/download');
      await service.getRegistrationScreenshotDownloadUrl('inv-1', directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('throws NotFoundException when no screenshot has been uploaded', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ registrationScreenshotKey: null });
      await expect(service.getRegistrationScreenshotDownloadUrl('inv-1', directorUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('mints a fresh presigned download URL', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        registrationScreenshotKey: 'invoices/inv-1/registration-screenshot.png',
      });
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://s3.test/download');
      const result = await service.getRegistrationScreenshotDownloadUrl('inv-1', directorUser);
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith('invoices/inv-1/registration-screenshot.png');
      expect(result).toEqual({ url: 'https://s3.test/download' });
    });
  });

  describe('createEmiPlan', () => {
    // tenureMonths is used as an array length in computeEmiSchedule — an unbounded value
    // allocates a giant array and can OOM the (RAM-constrained) production process.
    it.each([
      ['an absurdly large tenure', 1e9],
      ['zero', 0],
      ['a negative tenure', -3],
      ['a non-integer tenure', 2.5],
      ['NaN', Number.NaN],
      ['above the 60-month cap', 61],
    ])('rejects %s with BadRequestException before any DB work', async (_label, tenureMonths) => {
      await expect(
        service.createEmiPlan('inv-1', { tenureMonths, startDate: '2026-01-01' }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.emiInstallment.createMany).not.toHaveBeenCalled();
    });

    it('rejects an unparseable startDate with BadRequestException', async () => {
      await expect(
        service.createEmiPlan('inv-1', { tenureMonths: 3, startDate: 'not-a-date' }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(
        service.createEmiPlan('inv-1', { tenureMonths: 3, startDate: '2026-01-01' }, repUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the existence check by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        grandTotal: 3000,
        registrationFee: 0,
        emiInstallments: [],
      });
      mockPrisma.emiInstallment.findMany.mockResolvedValue([]);
      await service.createEmiPlan('inv-1', { tenureMonths: 3, startDate: '2026-01-01' }, directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('deletes all existing installments and creates a fresh schedule when none are paid', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        grandTotal: 3000,
        registrationFee: 0,
        emiInstallments: [],
      });
      mockPrisma.emiInstallment.findMany.mockResolvedValue([]);

      await service.createEmiPlan('inv-1', { tenureMonths: 3, startDate: '2026-01-01' }, directorUser);

      expect(mockPrisma.emiInstallment.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' } });
      expect(mockPrisma.emiInstallment.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([expect.objectContaining({ invoiceId: 'inv-1', installmentNumber: 1 })]),
      });
    });

    it('only deletes PENDING installments (not PAID ones) when some installments are already paid', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        grandTotal: 6000,
        registrationFee: 0,
        emiInstallments: [
          { installmentNumber: 1, amount: 1000, status: 'PAID' },
          { installmentNumber: 2, amount: 1000, status: 'PAID' },
        ],
      });
      mockPrisma.emiInstallment.findMany.mockResolvedValue([]);

      await service.createEmiPlan('inv-1', { tenureMonths: 6, startDate: '2026-01-01' }, directorUser);

      expect(mockPrisma.emiInstallment.deleteMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-1', status: 'PENDING' },
      });
      const createArgs = mockPrisma.emiInstallment.createMany.mock.calls[0][0];
      expect(createArgs.data.every((row: { installmentNumber: number }) => row.installmentNumber > 2)).toBe(true);
    });

    // markInstallmentPaid allows paying out of order, so the paid set can have holes. The
    // regenerated rows must fill exactly the gaps — never reuse a paid number (which would
    // violate @@unique([invoiceId, installmentNumber]) on the createMany).
    it('regenerates only the unpaid installment numbers when a middle installment is paid', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        grandTotal: 6000,
        registrationFee: 0,
        emiInstallments: [{ installmentNumber: 3, amount: 1000, status: 'PAID' }],
      });
      mockPrisma.emiInstallment.findMany.mockResolvedValue([]);

      await service.createEmiPlan('inv-1', { tenureMonths: 6, startDate: '2026-01-01' }, directorUser);

      const createArgs = mockPrisma.emiInstallment.createMany.mock.calls[0][0];
      const numbers = createArgs.data.map((row: { installmentNumber: number }) => row.installmentNumber);
      expect(numbers).toEqual([1, 2, 4, 5, 6]);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('rejects with BadRequestException when a live mandate already exists, without touching installments', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        grandTotal: 3000,
        registrationFee: 0,
        emiInstallments: [],
        emiGatewaySubscriptionId: 'sub_existing',
      });

      await expect(
        service.createEmiPlan('inv-1', { tenureMonths: 3, startDate: '2026-01-01' }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.emiInstallment.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.emiInstallment.createMany).not.toHaveBeenCalled();
    });

    it('returns the full updated installment list ordered by installmentNumber', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        grandTotal: 3000,
        registrationFee: 0,
        emiInstallments: [],
      });
      mockPrisma.emiInstallment.findMany.mockResolvedValue([{ installmentNumber: 1 }]);

      const result = await service.createEmiPlan('inv-1', { tenureMonths: 3, startDate: '2026-01-01' }, directorUser);

      expect(mockPrisma.emiInstallment.findMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-1' },
        orderBy: { installmentNumber: 'asc' },
      });
      expect(result).toEqual([{ installmentNumber: 1 }]);
    });
  });

  describe('createEmiMandate', () => {
    const baseDto = { tenureMonths: 4, startDate: '2026-10-01' };

    it('rejects when the invoice is out of the caller scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.createEmiMandate('inv-1', baseDto, repUser)).rejects.toThrow(NotFoundException);
    });

    it('rejects an out-of-range tenure before any DB lookup', async () => {
      await expect(service.createEmiMandate('inv-1', { tenureMonths: 0, startDate: '2026-10-01' }, repUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
    });

    it('scopes the invoice lookup by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.createEmiMandate('inv-1', baseDto, repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('rejects if a mandate already exists on the invoice', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        grandTotal: 45000,
        registrationFee: 5000,
        emiGatewaySubscriptionId: 'sub_existing',
        lead: { name: 'John', email: 'john@example.com', phone: '9999999999' },
      });
      await expect(service.createEmiMandate('inv-1', baseDto, repUser)).rejects.toThrow(BadRequestException);
      expect(mockPayments.createRazorpaySubscription).not.toHaveBeenCalled();
    });

    it('only selects the fields it actually uses (no emiInstallments, lead narrowed to name/email/phone)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.createEmiMandate('inv-1', baseDto, repUser)).rejects.toThrow(NotFoundException);
      const { select } = mockPrisma.invoice.findFirst.mock.calls[0][0];
      expect(select).not.toHaveProperty('emiInstallments');
      expect(select.lead).toEqual({ select: { name: true, email: true, phone: true } });
    });

    it('creates installments, calls createRazorpaySubscription with the per-cycle amount, and persists mandate fields atomically', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        grandTotal: 45000,
        registrationFee: 5000,
        emiGatewaySubscriptionId: null,
        lead: { name: 'John', email: 'john@example.com', phone: '9999999999' },
      });
      mockPayments.createRazorpaySubscription.mockResolvedValue({
        subscriptionId: 'sub_1',
        shortUrl: 'https://rzp.io/i/sub-abc',
      });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => await fn(mockPrisma));
      mockPrisma.emiInstallment.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.emiInstallment.createMany.mockResolvedValue({ count: 4 });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.emiInstallment.findMany.mockResolvedValue([
        { id: 'emi-1', installmentNumber: 1, amount: 10000, dueDate: new Date('2026-10-01'), status: 'PENDING' },
      ]);

      await service.createEmiMandate('inv-1', baseDto, repUser);

      // (45000 - 5000) / 4 = 10000 per cycle
      expect(mockPayments.createRazorpaySubscription).toHaveBeenCalledWith(
        'org-1',
        10000,
        'INR',
        4,
        { name: 'John', email: 'john@example.com', contact: '+919999999999' },
        { invoiceId: 'inv-1', kind: 'EMI_MANDATE' },
      );
      // The mandate fields update now happens inside the SAME $transaction as the
      // installment delete/create, not as a separate invoice.update call after it.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          emiPaymentMode: 'SUBSCRIPTION',
          emiGatewaySubscriptionId: 'sub_1',
          emiMandateShortUrl: 'https://rzp.io/i/sub-abc',
          emiMandateStatus: 'CREATED',
        },
      });
    });

    it('uses Cashfree when dto.gateway is CASHFREE and never touches Razorpay', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        grandTotal: 45000,
        registrationFee: 5000,
        emiGatewaySubscriptionId: null,
        lead: { name: 'John', email: 'john@example.com', phone: '9999999999' },
      });
      mockPayments.createCashfreeSubscription.mockResolvedValue({
        subscriptionId: 'gxs_1',
        shortUrl: 'https://app.example.com/authorize-mandate?s=tok&m=sandbox',
      });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => await fn(mockPrisma));
      mockPrisma.emiInstallment.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.emiInstallment.createMany.mockResolvedValue({ count: 4 });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.emiInstallment.findMany.mockResolvedValue([]);

      await service.createEmiMandate('inv-1', { ...baseDto, gateway: 'CASHFREE' }, repUser);

      expect(mockPayments.createRazorpaySubscription).not.toHaveBeenCalled();
      expect(mockPayments.createCashfreeSubscription).toHaveBeenCalledWith(
        'org-1',
        10000,
        'INR',
        4,
        expect.any(Date),
        { name: 'John', email: 'john@example.com', contact: '+919999999999' },
        { invoiceId: 'inv-1', kind: 'EMI_MANDATE' },
      );
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: expect.objectContaining({
          emiGatewaySubscriptionId: 'gxs_1',
          emiMandateShortUrl: 'https://app.example.com/authorize-mandate?s=tok&m=sandbox',
          emiMandateStatus: 'CREATED',
        }),
      });
    });

    it('logs the orphaned subscription id and re-throws when the persist transaction fails', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        grandTotal: 45000,
        registrationFee: 5000,
        emiGatewaySubscriptionId: null,
        lead: { name: 'John', email: 'john@example.com', phone: '9999999999' },
      });
      mockPayments.createRazorpaySubscription.mockResolvedValue({
        subscriptionId: 'sub_orphan',
        shortUrl: 'https://rzp.io/i/sub-orphan',
      });
      const txError = new Error('DB connection lost');
      mockPrisma.$transaction.mockRejectedValueOnce(txError);
      const loggerErrorSpy = jest.spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error');

      await expect(service.createEmiMandate('inv-1', baseDto, repUser)).rejects.toThrow('DB connection lost');
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('sub_orphan'));
    });
  });

  describe('remindInstallment', () => {
    const mockInvoice = {
      invoiceNumber: 'INV-2026-0001',
      leadId: 'lead-1',
      lead: { name: 'John', email: 'john@test.com', phone: '9999999999' },
    };
    const mockInstallment = {
      id: 'inst-1',
      installmentNumber: 1,
      amount: 1000,
      dueDate: new Date('2026-02-01'),
    };

    beforeEach(() => {
      mockPayments.createRazorpayLink.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/emi' });
      // No EMI-reminder template configured by default — WHATSAPP tests exercise the
      // free-form fallback unless a test opts into the configured-template path below.
      mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme Academy', paymentSettings: null });
    });

    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.remindInstallment('inv-1', 1, { channel: 'EMAIL' }, repUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes the existence check by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      await service.remindInstallment('inv-1', 1, { channel: 'EMAIL' }, directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(null);
      await expect(service.remindInstallment('inv-1', 9, { channel: 'EMAIL' }, directorUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates a Razorpay link for the installment amount (not the invoice total) and includes it in the email', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });

      await service.remindInstallment('inv-1', 1, { channel: 'EMAIL' }, directorUser);

      expect(mockPayments.createRazorpayLink).toHaveBeenCalledWith(
        'org-1',
        1000, // installment.amount, never invoice.grandTotal
        'INR',
        'inv-1-emi-1',
        { name: 'John', email: 'john@test.com', contact: '+919999999999' },
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        'john@test.com',
        expect.any(String),
        expect.stringContaining('https://rzp.io/l/emi'),
      );
      expect(mockPrisma.emiInstallment.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { lastReminderAt: expect.any(Date), lastReminderChannel: 'EMAIL' },
      });
    });

    it('still sends the email reminder (without a link) when Razorpay link creation fails', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      mockPayments.createRazorpayLink.mockRejectedValue(new ForbiddenException('not configured'));

      await service.remindInstallment('inv-1', 1, { channel: 'EMAIL' }, directorUser);

      expect(mockMail.send).toHaveBeenCalledWith(
        'john@test.com',
        expect.any(String),
        expect.not.stringContaining('href'),
      );
    });

    it('uses the org-configured EMAIL template (subject + body filled and escaped) when one is set', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        name: 'Acme Academy',
        paymentSettings: { emiReminderEmailTemplateId: 'tpl-email' },
      });
      mockPrisma.messageTemplate.findFirst.mockResolvedValue({
        subject: 'Installment #{{installment_no}} due {{due_date}}',
        body: 'Hi {{name}},' + String.fromCharCode(10) + 'Pay ₹{{amount}} for {{invoice_no}}: {{payment_link}}' + String.fromCharCode(10) + '– {{org}}',
      });

      await service.remindInstallment('inv-1', 1, { channel: 'EMAIL' }, directorUser);

      expect(mockPrisma.messageTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl-email', orgId: 'org-1', channel: 'EMAIL' } }),
      );
      const [to, subject, html] = mockMail.send.mock.calls[0];
      expect(to).toBe('john@test.com');
      expect(subject).toMatch(/^Installment #1 due /);
      expect(html).toContain('Hi John,<br>Pay ₹1000 for INV-2026-0001: <a href="https://rzp.io/l/emi">');
      expect(html).toContain('– Acme Academy');
    });

    it('falls back to the built-in email when the configured EMAIL template no longer exists', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        name: 'Acme Academy',
        paymentSettings: { emiReminderEmailTemplateId: 'gone' },
      });
      mockPrisma.messageTemplate.findFirst.mockResolvedValue(null);

      await service.remindInstallment('inv-1', 1, { channel: 'EMAIL' }, directorUser);

      expect(mockMail.send).toHaveBeenCalledWith(
        'john@test.com',
        'Payment reminder — Invoice INV-2026-0001',
        expect.stringContaining('installment #1'),
      );
    });

    it('actually sends via CommunicationsService.sendWhatsApp for channel=WHATSAPP and updates the reminder fields', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });

      await service.remindInstallment('inv-1', 1, { channel: 'WHATSAPP' }, directorUser);

      expect(mockCommunications.sendWhatsApp).toHaveBeenCalledWith(
        'lead-1',
        expect.stringContaining('https://rzp.io/l/emi'),
        directorUser,
      );
      expect(mockPrisma.emiInstallment.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { lastReminderAt: expect.any(Date), lastReminderChannel: 'WHATSAPP' },
      });
    });

    // Previously this branch only logged "would send" and always reported success — a lie,
    // since no WhatsApp integration was ever called. Now a real send is attempted, so a real
    // failure (e.g. outside Meta's 24h free-form window) must propagate, not report false success.
    it('propagates a WhatsApp send failure instead of reporting false success', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockCommunications.sendWhatsApp.mockRejectedValueOnce(new BadRequestException('WhatsApp not configured'));

      await expect(service.remindInstallment('inv-1', 1, { channel: 'WHATSAPP' }, directorUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.emiInstallment.update).not.toHaveBeenCalled();
    });

    it('sends via the configured approved WhatsApp template instead of free-form text when one is set', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        name: 'Acme Academy',
        paymentSettings: { emiReminderTemplateId: 'tpl-1' },
      });
      mockPrisma.messageTemplate.findFirst.mockResolvedValue({
        metaTemplateName: 'emi_installment_reminder',
        language: 'en_US',
        variables: ['name', 'installment_no', 'amount', 'invoice_no', 'due_date', 'payment_link', 'org'],
      });

      await service.remindInstallment('inv-1', 1, { channel: 'WHATSAPP' }, directorUser);

      expect(mockPrisma.messageTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tpl-1', orgId: 'org-1', channel: 'WHATSAPP', status: 'APPROVED' },
        }),
      );
      expect(mockCommunications.sendWhatsAppTemplate).toHaveBeenCalledWith(
        'lead-1',
        'emi_installment_reminder',
        'en_US',
        [
          'John',
          '1',
          '1000',
          'INV-2026-0001',
          mockInstallment.dueDate.toLocaleDateString('en-IN'),
          'https://rzp.io/l/emi',
          'Acme Academy',
        ],
        directorUser,
      );
      expect(mockCommunications.sendWhatsApp).not.toHaveBeenCalled();
    });

    it('falls back to free-form WhatsApp when the configured template id no longer resolves to an approved template', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(mockInstallment);
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        name: 'Acme Academy',
        paymentSettings: { emiReminderTemplateId: 'tpl-deleted' },
      });
      mockPrisma.messageTemplate.findFirst.mockResolvedValue(null);

      await service.remindInstallment('inv-1', 1, { channel: 'WHATSAPP' }, directorUser);

      expect(mockCommunications.sendWhatsAppTemplate).not.toHaveBeenCalled();
      expect(mockCommunications.sendWhatsApp).toHaveBeenCalled();
    });
  });

  describe('markInstallmentPaid', () => {
    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.markInstallmentPaid('inv-1', 1, repUser)).rejects.toThrow(NotFoundException);
    });

    it('scopes the existence check by orgId', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.emiInstallment.findFirst.mockResolvedValue({ id: 'inst-1' });
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      await service.markInstallmentPaid('inv-1', 1, directorUser);
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.emiInstallment.findFirst.mockResolvedValue(null);
      await expect(service.markInstallmentPaid('inv-1', 9, directorUser)).rejects.toThrow(NotFoundException);
    });

    it('marks the installment PAID with a paidAt timestamp', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      mockPrisma.emiInstallment.findFirst.mockResolvedValue({ id: 'inst-1' });
      mockPrisma.emiInstallment.update.mockResolvedValue({ id: 'inst-1' });
      await service.markInstallmentPaid('inv-1', 1, directorUser);
      expect(mockPrisma.emiInstallment.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
    });
  });

  describe('send', () => {
    // buildInvoicePdf (real, unmocked) iterates lineItems/emiInstallments and reads
    // org/lead fields, so every mocked invoice here needs the full PDF-include shape —
    // not just the bare `{ id, generatedFromRegistration, registeredAt }` shape used
    // before SCRUM-44 wired up the actual email send.
    const baseInvoice = {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-0001',
      invoiceDate: new Date('2026-01-01'),
      dueDate: null,
      notes: null,
      gstEnabled: false,
      gstType: 'CGST_SGST',
      gstRate: 0,
      subtotal: 0,
      discountAmount: 0,
      taxableAmount: 0,
      cgstAmount: null,
      sgstAmount: null,
      igstAmount: null,
      grandTotal: 0,
      generatedFromRegistration: false,
      registeredAt: null,
      lineItems: [],
      emiInstallments: [],
      lead: { name: 'John', email: 'john@test.com', phone: '9999999999' },
      org: { name: 'Acme Academy', city: null, state: null, country: null, email: null, phone: null, gstNumber: null },
    };

    afterEach(() => {
      delete process.env.RAZORPAY_KEY_ID;
    });

    it('throws NotFoundException when the invoice is out of scope', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.send('inv-1', { attachPaymentLink: false }, repUser)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when generatedFromRegistration is true and registeredAt is null', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        generatedFromRegistration: true,
        registeredAt: null,
      });
      await expect(service.send('inv-1', { attachPaymentLink: false }, directorUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockMail.sendRaw).not.toHaveBeenCalled();
    });

    // SCRUM-44: sending an invoice to a lead with no email on file used to silently
    // "succeed" (status flipped to SENT, nothing ever emailed). Now it fails loudly
    // with a clear, actionable message instead of pretending to have sent anything.
    it('throws BadRequestException when the lead has no email', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        lead: { ...baseInvoice.lead, email: null },
      });
      await expect(service.send('inv-1', { attachPaymentLink: false }, directorUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockMail.sendRaw).not.toHaveBeenCalled();
    });

    it('succeeds when generatedFromRegistration is true and registeredAt is set', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        generatedFromRegistration: true,
        registeredAt: new Date(),
      });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      await expect(service.send('inv-1', { attachPaymentLink: false }, directorUser)).resolves.toEqual({
        id: 'inv-1',
        status: 'SENT',
      });
    });

    it('does not throw for an ad-hoc invoice regardless of registeredAt', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      await expect(service.send('inv-1', { attachPaymentLink: false }, directorUser)).resolves.toBeDefined();
    });

    // Core SCRUM-44 regression test: the invoice PDF must actually be emailed to the
    // lead — this used to never happen at all.
    it('emails the invoice PDF to the lead', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });

      await service.send('inv-1', { attachPaymentLink: false }, directorUser);

      expect(mockMail.sendRaw).toHaveBeenCalledWith(
        'john@test.com',
        expect.stringContaining('INV-2026-0001'),
        expect.any(String),
        [expect.objectContaining({ filename: 'INV-2026-0001.pdf', contentType: 'application/pdf' })],
      );
    });

    it('does not attach a payment link and clears gateway when attachPaymentLink is false', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });

      await service.send('inv-1', { attachPaymentLink: false }, directorUser);

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          status: 'SENT',
          sentAt: expect.any(Date),
          paymentLinkAttached: false,
          paymentGateway: null,
          paymentLinkUrl: null,
        },
      });
    });

    it('rejects a non-Razorpay gateway when attachPaymentLink is true', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      await expect(
        service.send('inv-1', { attachPaymentLink: true, gateway: 'STRIPE' as unknown as 'RAZORPAY' }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockMail.sendRaw).not.toHaveBeenCalled();
    });

    it('rejects attachPaymentLink:true/RAZORPAY when Razorpay is not configured', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      mockPayments.createGatewayLink.mockRejectedValue(new ForbiddenException('not configured'));
      await expect(
        service.send('inv-1', { attachPaymentLink: true, gateway: 'RAZORPAY' }, directorUser),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockMail.sendRaw).not.toHaveBeenCalled();
    });

    it('creates the link through Cashfree and records CASHFREE as the invoice gateway', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      mockPayments.createGatewayLink.mockResolvedValue({ id: 'gx_1', shortUrl: 'https://cf/link' });

      await service.send('inv-1', { attachPaymentLink: true, gateway: 'CASHFREE' }, directorUser);

      expect(mockPayments.createGatewayLink).toHaveBeenCalledWith(
        'CASHFREE',
        'org-1',
        baseInvoice.grandTotal,
        'INR',
        'inv-1',
        expect.anything(),
      );
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentGateway: 'CASHFREE', paymentLinkUrl: 'https://cf/link' }),
        }),
      );
    });

    it('creates a real Razorpay link, emails it, and persists it on the invoice when configured', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      mockPayments.createGatewayLink.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/abc' });

      await service.send('inv-1', { attachPaymentLink: true, gateway: 'RAZORPAY' }, directorUser);

      expect(mockPayments.createGatewayLink).toHaveBeenCalledWith('RAZORPAY', 'org-1', baseInvoice.grandTotal, 'INR', 'inv-1', {
        name: 'John',
        email: 'john@test.com',
        contact: '+919999999999',
      });
      expect(mockMail.sendRaw).toHaveBeenCalledWith(
        'john@test.com',
        expect.any(String),
        expect.stringContaining('https://rzp.io/l/abc'),
        expect.any(Array),
      );
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          status: 'SENT',
          sentAt: expect.any(Date),
          paymentLinkAttached: true,
          paymentGateway: 'RAZORPAY',
          paymentLinkUrl: 'https://rzp.io/l/abc',
        },
      });
    });

    // Regression: once an EMI plan exists, the invoice's payment link must charge the
    // next pending installment, not invoice.grandTotal — otherwise the customer is asked
    // to pay in full despite having agreed to pay in installments.
    it('charges the next pending EMI installment instead of grandTotal when an EMI plan exists', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        grandTotal: 6000,
        emiInstallments: [
          { installmentNumber: 1, amount: 2000, status: 'PAID', dueDate: new Date('2026-01-01') },
          { installmentNumber: 2, amount: 2000, status: 'PENDING', dueDate: new Date('2026-02-01') },
          { installmentNumber: 3, amount: 2000, status: 'PENDING', dueDate: new Date('2026-03-01') },
        ],
      });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      mockPayments.createGatewayLink.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/emi' });

      await service.send('inv-1', { attachPaymentLink: true, gateway: 'RAZORPAY' }, directorUser);

      expect(mockPayments.createGatewayLink).toHaveBeenCalledWith(
        'RAZORPAY',
        'org-1',
        2000, // next PENDING installment's amount, never invoice.grandTotal
        'INR',
        'inv-1',
        { name: 'John', email: 'john@test.com', contact: '+919999999999' },
      );
    });

    it('rejects attachPaymentLink when an EMI auto-debit mandate is already active', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        emiPaymentMode: 'SUBSCRIPTION',
        emiGatewaySubscriptionId: 'sub_existing',
      });

      await expect(
        service.send('inv-1', { attachPaymentLink: true, gateway: 'RAZORPAY' }, directorUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPayments.createGatewayLink).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockMail.sendRaw).not.toHaveBeenCalled();
    });

    it('falls back to grandTotal when all EMI installments are already paid', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        grandTotal: 6000,
        emiInstallments: [
          { installmentNumber: 1, amount: 3000, status: 'PAID', dueDate: new Date('2026-01-01') },
          { installmentNumber: 2, amount: 3000, status: 'PAID', dueDate: new Date('2026-02-01') },
        ],
      });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
      mockPayments.createGatewayLink.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/full' });

      await service.send('inv-1', { attachPaymentLink: true, gateway: 'RAZORPAY' }, directorUser);

      expect(mockPayments.createGatewayLink).toHaveBeenCalledWith('RAZORPAY', 'org-1', 6000, 'INR', 'inv-1', {
        name: 'John',
        email: 'john@test.com',
        contact: '+919999999999',
      });
    });
  });

  describe('getConnectedPaymentGateways', () => {
    // Defers entirely to PaymentsService.isRazorpayConnected (org OrgIntegration or platform
    // fallback) so this badge can never say Connected when send()/sendRegistrationPaymentLink()
    // would actually fail — see b90b78a for the bug this class of test guards against.
    it('returns Razorpay and Cashfree connected:true when PaymentsService reports connected', async () => {
      mockPayments.isRazorpayConnected.mockResolvedValue(true);
      mockPayments.isCashfreeConnected.mockResolvedValue(true);
      await expect(service.getConnectedPaymentGateways(directorUser)).resolves.toEqual([
        { gateway: 'RAZORPAY', connected: true },
        { gateway: 'CASHFREE', connected: true },
      ]);
      expect(mockPayments.isRazorpayConnected).toHaveBeenCalledWith('org-1');
      expect(mockPayments.isCashfreeConnected).toHaveBeenCalledWith('org-1');
    });

    it('reports each gateway independently when only one is connected', async () => {
      mockPayments.isRazorpayConnected.mockResolvedValue(false);
      mockPayments.isCashfreeConnected.mockResolvedValue(true);
      await expect(service.getConnectedPaymentGateways(directorUser)).resolves.toEqual([
        { gateway: 'RAZORPAY', connected: false },
        { gateway: 'CASHFREE', connected: true },
      ]);
    });
  });
});
