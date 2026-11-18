import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { InvoiceStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';
import { buildInvoiceScopeFilter, buildLeadScopeFilter } from '../../common/utils/scope.util';
import {
  computeEmiSchedule,
  computeInvoiceTotals,
  computeRemainingEmiSchedule,
  round2,
  type DiscountType,
  type GstType,
} from './invoices.math';
import { StorageService } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { fillTemplate, renderEmailHtml } from '../../common/utils/template-render.util';
import { PaymentsService } from '../payments/payments.service';
import { CommunicationsService } from '../communications/communications.service';
import { mergePaymentSettings } from '../../common/constants/org-defaults';
import { toE164 } from '../../common/utils/phone.util';
import { buildInvoicePdf, invoicePdfInclude } from './invoices-pdf.util';
import { InvoiceLineItemDto } from './dto/invoice-line-item.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { GenerateFromRegistrationDto } from './dto/generate-from-registration.dto';
import {
  RecordRegistrationPaymentDto,
  RegistrationScreenshotUploadDto,
  SendRegistrationPaymentLinkDto,
} from './dto/registration-payment.dto';
import { CreateEmiMandateDto, CreateEmiPlanDto, RemindInstallmentDto } from './dto/emi.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';

// Client-facing relation include. Deliberately NOT the same as invoicePdfInclude: that one
// pulls the whole `Organization` row (fine for server-side PDF rendering, which never leaves
// the process), but the Organization row carries `orgWebhookToken` — the bearer credential
// that authenticates the inbound lead-capture webhooks (see webhook.controller.ts and
// integrations/google/google.controller.ts) — plus planStatus/trialEndsAt/ownerId/domain and
// the email-quota counters. None of that may ever reach a client, so `org` is narrowed to the
// handful of seller fields an invoice actually displays.
const invoiceClientInclude = {
  lineItems: { orderBy: { sortOrder: 'asc' } },
  emiInstallments: { orderBy: { installmentNumber: 'asc' } },
  lead: true,
  org: {
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      country: true,
      email: true,
      phone: true,
      gstNumber: true,
      // logoKey deliberately excluded — raw S3 key, never handed to the client (rule 6).
    },
  },
} satisfies Prisma.InvoiceInclude;

// Number-generation is count-based, so a race can produce the same number twice; the
// @@unique([orgId, invoiceNumber]) constraint turns that into a P2002 we retry through.
const INVOICE_NUMBER_MAX_ATTEMPTS = 3;

// Bounds for EMI tenure — `tenureMonths` is used as an array length in computeEmiSchedule,
// so an unbounded value is an OOM vector on a RAM-constrained box.
const MIN_TENURE_MONTHS = 1;
const MAX_TENURE_MONTHS = 60;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly payments: PaymentsService,
    private readonly communications: CommunicationsService,
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

  // CLAUDE.md rule 6: never return a raw S3 key to the client — registrationScreenshotKey is
  // an internal storage key, not something the frontend should ever see (it gets the actual
  // image via getRegistrationScreenshotDownloadUrl's short-lived presigned URL instead). Apply
  // this at every point an Invoice (or list of them) is returned to a controller/client.
  private stripInternalFields<T extends { registrationScreenshotKey?: string | null; emiGatewaySubscriptionId?: string | null }>(
    invoice: T,
  ): Omit<T, 'registrationScreenshotKey' | 'emiGatewaySubscriptionId'> {
    const { registrationScreenshotKey: _registrationScreenshotKey, emiGatewaySubscriptionId: _emiGatewaySubscriptionId, ...rest } = invoice;
    return rest;
  }

  async list(query: { status?: string; page?: number; limit?: number; registered?: boolean }, caller: AuthUser) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;

    const where: Prisma.InvoiceWhereInput = {
      ...buildInvoiceScopeFilter(caller),
      ...(query.status ? { status: query.status as InvoiceStatus } : {}),
      // "Registered" means a registration payment was actually recorded (registeredAt set) —
      // not merely that a DRAFT invoice was generated via generate-from-registration, which
      // can happen with no payment logged yet (e.g. a screenshot upload that was abandoned).
      ...(query.registered ? { registeredAt: { not: null } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        // The list page renders a "Lead" column (components/invoices/InvoiceTable.tsx reads
        // `inv.lead?.name`) — without this include every row shows a dash. lineItems is
        // needed by the registrations list (RegistrationTable.tsx's course-summary column).
        include: {
          lead: { select: { id: true, name: true } },
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const data = rows.map((row) => this.stripInternalFields(row));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // Computes but does NOT persist — used both for the "next number" preview
  // endpoint and internally by create() to generate the authoritative number.
  private async generateInvoiceNumber(orgId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count({
      where: { orgId, invoiceNumber: { startsWith: `INV-${year}-` } },
    });
    const seq = String(count + 1).padStart(4, '0');
    return `INV-${year}-${seq}`;
  }

  async getNextNumber(caller: AuthUser) {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.invoices.orgRequired);
    const invoiceNumber = await this.generateInvoiceNumber(caller.orgId);
    return { invoiceNumber };
  }

  // Belt-and-suspenders on top of the class-validator DTO checks (which already reject
  // NaN/negative values at the controller boundary): kept so create/update/
  // generateFromRegistration fail the same way even if called with a hand-built object
  // that bypassed the ValidationPipe (e.g. from a future internal caller).
  private assertValidMoneyInputs(input: {
    lineItems?: readonly InvoiceLineItemDto[];
    gstRate?: number;
    discountValue?: number;
    registrationFee?: number;
  }) {
    for (const li of input.lineItems ?? []) {
      if (!Number.isFinite(li.quantity) || li.quantity < 0 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0) {
        throw new BadRequestException(ErrorMessages.invoices.invalidLineItem);
      }
    }
    if (input.gstRate !== undefined && (!Number.isFinite(input.gstRate) || input.gstRate < 0 || input.gstRate > 100)) {
      throw new BadRequestException(ErrorMessages.invoices.invalidGstRate);
    }
    if (input.discountValue !== undefined && (!Number.isFinite(input.discountValue) || input.discountValue < 0)) {
      throw new BadRequestException(ErrorMessages.invoices.invalidDiscountValue);
    }
    if (input.registrationFee !== undefined && (!Number.isFinite(input.registrationFee) || input.registrationFee < 0)) {
      throw new BadRequestException(ErrorMessages.invoices.invalidRegistrationFee);
    }
  }

  // Duck-typed rather than `instanceof Prisma.PrismaClientKnownRequestError` so a wrapped or
  // re-thrown error (and a mocked one in tests) is still recognised.
  private isInvoiceNumberConflict(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const { code, meta } = err as { code?: unknown; meta?: { target?: unknown } };
    if (code !== 'P2002') return false;
    const { target } = meta ?? {};
    const fields = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : [];
    return fields.length === 0 || fields.some((f) => f.includes('invoiceNumber'));
  }

  // generateInvoiceNumber counts existing rows, so two concurrent creates can compute the
  // same number. @@unique([orgId, invoiceNumber]) makes the DB reject the loser with P2002
  // instead of silently persisting a duplicate; here we regenerate and retry a few times.
  private async createInvoiceWithUniqueNumber(
    orgId: string,
    buildData: (invoiceNumber: string) => Prisma.InvoiceUncheckedCreateInput,
  ) {
    for (let attempt = 1; attempt <= INVOICE_NUMBER_MAX_ATTEMPTS; attempt++) {
      const invoiceNumber = await this.generateInvoiceNumber(orgId);
      try {
        return await this.prisma.invoice.create({
          data: buildData(invoiceNumber),
          include: { lineItems: true },
        });
      } catch (err) {
        if (!this.isInvoiceNumberConflict(err)) throw err;
        this.logger.warn(
          `Invoice number ${invoiceNumber} collided for org ${orgId} (attempt ${attempt}/${INVOICE_NUMBER_MAX_ATTEMPTS}) — regenerating`,
        );
      }
    }
    throw new ConflictException(ErrorMessages.invoices.numberCollision);
  }

  // Client-facing scoped lookup — narrowed `org` (see invoiceClientInclude) plus the
  // registrationScreenshotKey strip applied by the caller below.
  private async findInvoiceForClientOrThrow(id: string, caller: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      include: invoiceClientInclude,
    });
    if (!invoice) throw new NotFoundException(ErrorMessages.invoices.notFound);
    return invoice;
  }

  // Same scope filter, but the PDF-only include (full `org` row). The result of this lookup
  // is rendered into a PDF server-side and never serialized to a client as JSON.
  private async findInvoiceForPdfOrThrow(id: string, caller: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      include: invoicePdfInclude,
    });
    if (!invoice) throw new NotFoundException(ErrorMessages.invoices.notFound);
    return invoice;
  }

  async getById(id: string, caller: AuthUser) {
    const invoice = await this.findInvoiceForClientOrThrow(id, caller);
    return this.stripInternalFields(invoice);
  }

  async getInvoicePdf(id: string, caller: AuthUser): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.findInvoiceForPdfOrThrow(id, caller);
    const logoBuffer = await this.getOrgLogoBuffer(invoice.org?.logoKey);
    const buffer = await buildInvoicePdf(invoice, logoBuffer);
    return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
  }

  async create(dto: CreateInvoiceDto, caller: AuthUser) {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.invoices.orgRequired);
    this.assertValidMoneyInputs(dto);

    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, ...buildLeadScopeFilter(caller) },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.invoices.leadNotFound);

    const totals = computeInvoiceTotals({
      lineItems: dto.lineItems.map((li) => ({ quantity: li.quantity, unitPrice: li.unitPrice })),
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      gstEnabled: dto.gstEnabled,
      gstType: dto.gstType,
      gstRate: dto.gstRate,
    });

    const orgId = caller.orgId;
    const invoice = await this.createInvoiceWithUniqueNumber(orgId, (invoiceNumber) => ({
      orgId,
      leadId: dto.leadId,
      invoiceNumber,
      status: 'DRAFT',
      invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : new Date(),
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      notes: dto.notes,
      gstEnabled: dto.gstEnabled,
      gstType: dto.gstType,
      gstRate: dto.gstRate,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      ...totals,
      createdById: caller.id,
      lineItems: {
        create: dto.lineItems.map((li, i) => ({
          courseId: li.courseId,
          courseName: li.courseName,
          batchId: li.batchId,
          batchLabel: li.batchLabel,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: round2(li.quantity * li.unitPrice),
          sortOrder: i,
        })),
      },
    }));
    return this.stripInternalFields(invoice);
  }

  async update(id: string, dto: UpdateInvoiceDto, caller: AuthUser) {
    this.assertValidMoneyInputs(dto);

    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      include: { lineItems: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    // Once fully paid (or voided), amounts must not silently change — the status has to
    // be reopened (updateStatus) before editing.
    if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
      throw new ForbiddenException(ErrorMessages.invoices.paidInvoiceLocked);
    }

    const scalarData: Prisma.InvoiceUpdateInput = {
      ...(dto.invoiceDate !== undefined ? { invoiceDate: new Date(dto.invoiceDate) } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.registrationFee !== undefined ? { registrationFee: dto.registrationFee } : {}),
      ...(dto.registrationPaymentMode !== undefined ? { registrationPaymentMode: dto.registrationPaymentMode } : {}),
      ...(dto.registrationNote !== undefined ? { registrationNote: dto.registrationNote } : {}),
    };

    const recomputeTotals =
      dto.lineItems ||
      dto.gstEnabled !== undefined ||
      dto.gstType !== undefined ||
      dto.gstRate !== undefined ||
      dto.discountType !== undefined ||
      dto.discountValue !== undefined;

    if (!recomputeTotals) {
      const invoice = await this.prisma.invoice.update({
        where: { id },
        data: scalarData,
        include: { lineItems: true },
      });
      return this.stripInternalFields(invoice);
    }

    const lineItems =
      dto.lineItems ??
      existing.lineItems.map((li) => ({
        courseId: li.courseId ?? undefined,
        courseName: li.courseName,
        batchId: li.batchId ?? undefined,
        batchLabel: li.batchLabel ?? undefined,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
      }));
    const gstEnabled = dto.gstEnabled ?? existing.gstEnabled;
    const gstType = (dto.gstType ?? existing.gstType) as GstType;
    const gstRate = dto.gstRate ?? existing.gstRate;
    const discountType = (dto.discountType ?? existing.discountType) as DiscountType;
    const discountValue = dto.discountValue ?? existing.discountValue;

    const totals = computeInvoiceTotals({
      lineItems: lineItems.map((li) => ({ quantity: li.quantity, unitPrice: li.unitPrice })),
      discountType,
      discountValue,
      gstEnabled,
      gstType,
      gstRate,
    });

    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: {
          ...scalarData,
          gstEnabled,
          gstType,
          gstRate,
          discountType,
          discountValue,
          ...totals,
          lineItems: {
            create: lineItems.map((li, i) => ({
              courseId: li.courseId,
              courseName: li.courseName,
              batchId: li.batchId,
              batchLabel: li.batchLabel,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              lineTotal: round2(li.quantity * li.unitPrice),
              sortOrder: i,
            })),
          },
        },
        include: { lineItems: true },
      });
    });
    return this.stripInternalFields(invoice);
  }

  async updateStatus(id: string, status: InvoiceStatus, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    // Voiding a settled payment isn't a status flip — that needs a refund/adjustment
    // process outside this endpoint, not a silent CANCELLED overwrite.
    if (status === 'CANCELLED' && existing.status === 'PAID') {
      throw new ForbiddenException(ErrorMessages.invoices.cannotCancelPaidInvoice);
    }

    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: { status, ...(status === 'PAID' ? { paidAt: new Date() } : {}) },
    });
    return this.stripInternalFields(invoice);
  }

  // Soft-delete only, mirroring the Lead pattern (CLAUDE.md rule 5) — an invoice can carry
  // EMI installments, payment history, and a generated-from-registration link that other
  // records/reports may still reference, so it is never hard-deleted.
  async remove(id: string, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    const invoice = await this.prisma.invoice.update({ where: { id }, data: { isDeleted: true } });
    return this.stripInternalFields(invoice);
  }

  // "Register now, invoice later" step 1: a bare DRAFT invoice from the Register Student
  // screen, not yet marked registered. Step 2 (recordRegistrationPayment) stamps
  // registeredAt right after this in the same UI flow. GST/discount fields are optional
  // here — the Register Student screen doesn't show tax settings — and default sensibly;
  // they get finalized later on the invoice form.
  async generateFromRegistration(dto: GenerateFromRegistrationDto, caller: AuthUser) {
    if (!caller.orgId) throw new ForbiddenException(ErrorMessages.invoices.orgRequired);
    this.assertValidMoneyInputs(dto);

    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, ...buildLeadScopeFilter(caller) },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.invoices.leadNotFound);

    // Defaults to no GST — the Register Student screen doesn't show tax settings unless
    // the rep explicitly turns on TaxSettingsCard, so silently taxing the invoice would
    // charge more than what the rep and student agreed to.
    const gstEnabled = dto.gstEnabled ?? false;
    const gstType = dto.gstType ?? 'CGST_SGST';
    const gstRate = dto.gstRate ?? 18;
    const discountType = dto.discountType ?? 'FLAT';
    const discountValue = dto.discountValue ?? 0;

    const totals = computeInvoiceTotals({
      lineItems: dto.lineItems.map((li) => ({ quantity: li.quantity, unitPrice: li.unitPrice })),
      discountType,
      discountValue,
      gstEnabled,
      gstType,
      gstRate,
    });

    const lineItemsData = dto.lineItems.map((li, i) => ({
      courseId: li.courseId,
      courseName: li.courseName,
      batchId: li.batchId,
      batchLabel: li.batchLabel,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      lineTotal: round2(li.quantity * li.unitPrice),
      sortOrder: i,
    }));

    // Reuse an existing not-yet-registered draft from this same "Register now, invoice
    // later" flow for this lead instead of creating a duplicate — a second browser tab,
    // or reloading the Register page mid-flow (which loses the in-memory invoiceId), would
    // otherwise pile up abandoned DRAFT invoices with no registration payment ever recorded.
    const existingDraft = await this.prisma.invoice.findFirst({
      where: {
        orgId: caller.orgId,
        leadId: dto.leadId,
        generatedFromRegistration: true,
        registeredAt: null,
        isDeleted: false,
      },
    });

    if (existingDraft) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: existingDraft.id } });
        return tx.invoice.update({
          where: { id: existingDraft.id },
          data: {
            gstEnabled,
            gstType,
            gstRate,
            discountType,
            discountValue,
            ...totals,
            lineItems: { create: lineItemsData },
          },
          include: { lineItems: true },
        });
      });
      return this.stripInternalFields(updated);
    }

    const orgId = caller.orgId;
    const invoice = await this.createInvoiceWithUniqueNumber(orgId, (invoiceNumber) => ({
      orgId,
      leadId: dto.leadId,
      invoiceNumber,
      status: 'DRAFT',
      invoiceDate: new Date(),
      gstEnabled,
      gstType,
      gstRate,
      discountType,
      discountValue,
      ...totals,
      generatedFromRegistration: true,
      createdById: caller.id,
      lineItems: { create: lineItemsData },
    }));
    return this.stripInternalFields(invoice);
  }

  // "Register now, invoice later" step 2 — also reused later to amend a fee/mode/note
  // on an already-registered invoice.
  async recordRegistrationPayment(id: string, dto: RecordRegistrationPaymentDto, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: {
        registeredAt: new Date(),
        registeredById: caller.id,
        registrationFee: dto.amount,
        registrationPaymentMode: dto.mode,
        // For SCREENSHOT the key is already on the row — written server-side at presign time
        // (getRegistrationScreenshotUploadUrl) — so it's left untouched here; a client-supplied
        // key is never accepted. Prisma treats `undefined` as "leave unchanged," not "clear",
        // so switching back to SAVE must explicitly null the stale key from a prior amend.
        ...(dto.mode === 'SAVE' ? { registrationScreenshotKey: null } : {}),
        registrationNote: dto.note,
      },
    });
    return this.stripInternalFields(invoice);
  }

  async sendRegistrationPaymentLink(id: string, dto: SendRegistrationPaymentLinkDto, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { id: true, registrationFee: true, lead: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    if (dto.source === 'CUSTOM') {
      if (!dto.customUrl) throw new BadRequestException(ErrorMessages.invoices.customUrlRequired);
      this.logger.log(`Sending custom registration payment link for invoice ${id}: ${dto.customUrl}`);
      return { sent: true, source: 'CUSTOM' as const, url: dto.customUrl };
    }

    if (dto.gateway !== 'RAZORPAY' && dto.gateway !== 'CASHFREE') {
      throw new BadRequestException(ErrorMessages.invoices.unsupportedGateway);
    }
    const chargeAmount = dto.amount ?? existing.registrationFee;
    if (!chargeAmount || chargeAmount <= 0) {
      throw new BadRequestException(ErrorMessages.invoices.invalidRegistrationFee);
    }

    const link = await this.payments.createGatewayLink(
      dto.gateway,
      caller.orgId ?? undefined,
      chargeAmount,
      'INR',
      id,
      {
        name: existing.lead.name,
        email: existing.lead.email ?? undefined,
        contact: toE164(existing.lead.phone),
      },
      { invoiceId: id, kind: 'REGISTRATION_FEE' },
    );
    return { sent: true, source: 'GATEWAY' as const, url: link.shortUrl };
  }

  // Manual override for the webhook in handleWebhook (PaymentsService) — lets a rep confirm
  // the registration fee was paid (e.g. collected outside the sent link, or the webhook
  // hasn't landed yet). Idempotent: re-marking an already-paid invoice is a no-op.
  async markRegistrationFeePaid(id: string, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { id: true, registrationFeePaidAt: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: { registrationFeePaidAt: existing.registrationFeePaidAt ?? new Date() },
    });
    return this.stripInternalFields(invoice);
  }

  async getRegistrationScreenshotUploadUrl(dto: RegistrationScreenshotUploadDto, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, ...buildInvoiceScopeFilter(caller) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    // Same pattern as CommunicationsService.initCallRecording: the key is built server-side
    // and persisted on the row here, and never returned to the client. Handing the key back
    // and trusting it on a later write would let a caller attach an arbitrary (e.g. another
    // tenant's) object to their own invoice and then presign a download for it.
    const ext = dto.contentType.split('/')[1] ?? 'png';
    const key = this.storage.buildInvoiceRegistrationScreenshotKey(dto.invoiceId, ext);
    const uploadUrl = await this.storage.getPresignedUploadUrl(key, dto.contentType);
    await this.prisma.invoice.update({
      where: { id: dto.invoiceId },
      data: { registrationScreenshotKey: key },
    });
    return { uploadUrl };
  }

  // Mints a fresh signed URL on every call — never cache (CLAUDE.md rule 6).
  async getRegistrationScreenshotDownloadUrl(id: string, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { registrationScreenshotKey: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);
    if (!existing.registrationScreenshotKey) {
      throw new NotFoundException(ErrorMessages.invoices.screenshotNotFound);
    }

    const url = await this.storage.getPresignedDownloadUrl(existing.registrationScreenshotKey);
    return { url };
  }

  async createEmiPlan(id: string, dto: CreateEmiPlanDto, caller: AuthUser) {
    // tenureMonths becomes an array length downstream — bound it before any DB work so a
    // hostile value can't allocate a huge array and OOM the process.
    if (
      !Number.isInteger(dto.tenureMonths) ||
      dto.tenureMonths < MIN_TENURE_MONTHS ||
      dto.tenureMonths > MAX_TENURE_MONTHS
    ) {
      throw new BadRequestException(ErrorMessages.invoices.invalidTenure);
    }
    if (Number.isNaN(new Date(dto.startDate).getTime())) {
      throw new BadRequestException(ErrorMessages.invoices.invalidStartDate);
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      include: { emiInstallments: true },
    });
    if (!invoice) throw new NotFoundException(ErrorMessages.invoices.notFound);
    // A live Razorpay subscription auto-charges against the schedule shape it was created
    // with — regenerating installments here (a different tenure/amount split) desyncs
    // `installmentNumber === paid_count` correlation in the webhook. Same guard as
    // createEmiMandate; once a mandate exists, only that flow may touch the schedule.
    if (invoice.emiGatewaySubscriptionId) {
      throw new BadRequestException(ErrorMessages.invoices.mandateAlreadyExists);
    }

    const paid = invoice.emiInstallments.filter((inst) => inst.status === 'PAID');
    const startDate = new Date(dto.startDate);

    if (paid.length === 0) {
      const rows = computeEmiSchedule({
        grandTotal: invoice.grandTotal,
        registrationFee: invoice.registrationFee ?? 0,
        negotiatedAmount: dto.negotiatedAmount,
        tenureMonths: dto.tenureMonths,
        startDate,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.emiInstallment.deleteMany({ where: { invoiceId: id } });
        await tx.emiInstallment.createMany({ data: rows.map((row) => ({ invoiceId: id, ...row })) });
      });
    } else {
      const rows = computeRemainingEmiSchedule({
        grandTotal: invoice.grandTotal,
        registrationFee: invoice.registrationFee ?? 0,
        negotiatedAmount: dto.negotiatedAmount,
        tenureMonths: dto.tenureMonths,
        startDate,
        paidInstallments: paid.map((p) => ({ installmentNumber: p.installmentNumber, amount: p.amount })),
      });
      // Only the still-pending rows are dropped and regenerated — paid rows are untouched.
      await this.prisma.$transaction(async (tx) => {
        await tx.emiInstallment.deleteMany({ where: { invoiceId: id, status: 'PENDING' } });
        await tx.emiInstallment.createMany({ data: rows.map((row) => ({ invoiceId: id, ...row })) });
      });
    }

    return this.prisma.emiInstallment.findMany({
      where: { invoiceId: id },
      orderBy: { installmentNumber: 'asc' },
    });
  }

  // Auto-debit variant of createEmiPlan: generates the same schedule (via computeEmiSchedule)
  // but instead of leaving installments to be collected manually, sets up a Razorpay
  // Subscription so every cycle auto-charges. Every cycle charges the SAME amount (a Razorpay
  // Plan constraint) — uses the schedule's per-cycle amount (all rows but the last, which is
  // identical to it up to rounding) rather than special-casing the last row's amount.
  async createEmiMandate(id: string, dto: CreateEmiMandateDto, caller: AuthUser) {
    if (
      !Number.isInteger(dto.tenureMonths) ||
      dto.tenureMonths < MIN_TENURE_MONTHS ||
      dto.tenureMonths > MAX_TENURE_MONTHS
    ) {
      throw new BadRequestException(ErrorMessages.invoices.invalidTenure);
    }
    if (Number.isNaN(new Date(dto.startDate).getTime())) {
      throw new BadRequestException(ErrorMessages.invoices.invalidStartDate);
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: {
        id: true,
        grandTotal: true,
        registrationFee: true,
        emiGatewaySubscriptionId: true,
        lead: { select: { name: true, email: true, phone: true } },
      },
    });
    if (!invoice) throw new NotFoundException(ErrorMessages.invoices.notFound);
    if (invoice.emiGatewaySubscriptionId) {
      throw new BadRequestException(ErrorMessages.invoices.mandateAlreadyExists);
    }

    const startDate = new Date(dto.startDate);
    const rows = computeEmiSchedule({
      grandTotal: invoice.grandTotal,
      registrationFee: invoice.registrationFee ?? 0,
      negotiatedAmount: dto.negotiatedAmount,
      tenureMonths: dto.tenureMonths,
      startDate,
    });
    if (rows.length === 0) throw new BadRequestException(ErrorMessages.invoices.invalidTenure);

    // The per-cycle Razorpay Plan amount: the first row's amount, which equals every row's
    // amount except possibly the last (rounding-only difference — see the constraint above).
    const perEmiAmount = rows[0].amount;

    const customer = {
      name: invoice.lead.name,
      email: invoice.lead.email ?? undefined,
      contact: toE164(invoice.lead.phone),
    };
    const notes = { invoiceId: id, kind: 'EMI_MANDATE' };
    const gateway = dto.gateway ?? 'RAZORPAY';
    const subscription =
      gateway === 'CASHFREE'
        ? await this.payments.createCashfreeSubscription(
            caller.orgId ?? undefined,
            perEmiAmount,
            'INR',
            dto.tenureMonths,
            startDate,
            customer,
            notes,
          )
        : await this.payments.createRazorpaySubscription(
            caller.orgId ?? undefined,
            perEmiAmount,
            'INR',
            dto.tenureMonths,
            customer,
            notes,
          );

    // A real, billable Razorpay subscription now exists. If any of these three DB writes
    // fails, GenXCRM would have no record of it — its webhooks would find no matching
    // invoice and silently no-op forever, and a retry would create a duplicate subscription.
    // Fold them into one transaction so they commit or fail together, and log the
    // subscription id on failure so it's recoverable from PM2 logs.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.emiInstallment.deleteMany({ where: { invoiceId: id } });
        await tx.emiInstallment.createMany({ data: rows.map((row) => ({ invoiceId: id, ...row })) });
        await tx.invoice.update({
          where: { id },
          data: {
            emiPaymentMode: 'SUBSCRIPTION',
            emiGatewaySubscriptionId: subscription.subscriptionId,
            emiMandateShortUrl: subscription.shortUrl,
            emiMandateStatus: 'CREATED',
          },
        });
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist EMI mandate for invoice ${id} after creating ${gateway} subscription ${subscription.subscriptionId} — subscription is orphaned and needs manual reconciliation: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    return this.prisma.emiInstallment.findMany({
      where: { invoiceId: id },
      orderBy: { installmentNumber: 'asc' },
    });
  }

  // Looks up the org's configured EMI-reminder WhatsApp template (Administration > Payments),
  // if any, and re-validates it's still an approved, org-owned template with a Meta name to
  // send against — the org setting can point at a template that was since deleted or fell
  // back out of APPROVED (e.g. Meta revoked it), so this never trusts the stored id alone.
  private async resolveEmiWhatsAppTemplate(orgId: string | undefined): Promise<{
    metaTemplateName: string;
    language: string;
    variables: string[];
    orgName: string;
  } | null> {
    if (!orgId) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, paymentSettings: true },
    });
    const templateId = mergePaymentSettings(org?.paymentSettings).emiReminderTemplateId;
    if (!templateId) return null;

    const template = await this.prisma.messageTemplate.findFirst({
      where: { id: templateId, orgId, channel: 'WHATSAPP', status: 'APPROVED' },
      select: { metaTemplateName: true, language: true, variables: true },
    });
    if (!template?.metaTemplateName) return null;

    return {
      metaTemplateName: template.metaTemplateName,
      language: template.language ?? 'en_US',
      variables: Array.isArray(template.variables) ? (template.variables as string[]) : [],
      orgName: org?.name ?? 'Team',
    };
  }

  // The org's configured EMI-reminder EMAIL template (Administration > Payments), if it still
  // exists and is an org-owned email template. Null → the built-in message is sent instead.
  private async resolveEmiEmailTemplate(orgId: string | undefined): Promise<{
    subject: string;
    body: string;
    orgName: string;
  } | null> {
    if (!orgId) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, paymentSettings: true },
    });
    const templateId = mergePaymentSettings(org?.paymentSettings).emiReminderEmailTemplateId;
    if (!templateId) return null;

    const template = await this.prisma.messageTemplate.findFirst({
      where: { id: templateId, orgId, channel: 'EMAIL' },
      select: { subject: true, body: true },
    });
    if (!template) return null;

    return { subject: template.subject ?? '', body: template.body, orgName: org?.name ?? 'Team' };
  }

  async remindInstallment(id: string, n: number, dto: RemindInstallmentDto, caller: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { invoiceNumber: true, leadId: true, lead: { select: { name: true, email: true, phone: true } } },
    });
    if (!invoice) throw new NotFoundException(ErrorMessages.invoices.notFound);

    const installment = await this.prisma.emiInstallment.findFirst({
      where: { invoiceId: id, installmentNumber: n },
    });
    if (!installment) throw new NotFoundException(ErrorMessages.invoices.installmentNotFound);

    // Best-effort: a per-installment Razorpay link makes the reminder actionable, but a
    // reminder must still go out (with just the amount/due date) when Razorpay isn't
    // connected for this org.
    let paymentLinkUrl: string | null = null;
    try {
      const link = await this.payments.createRazorpayLink(
        caller.orgId ?? undefined,
        installment.amount,
        'INR',
        `${id}-emi-${n}`,
        { name: invoice.lead.name, email: invoice.lead.email ?? undefined, contact: toE164(invoice.lead.phone) },
      );
      paymentLinkUrl = link.shortUrl;
    } catch (err) {
      this.logger.warn(
        `Could not create a Razorpay link for invoice ${id} installment ${n} — reminder will go out without one: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const dueDate = installment.dueDate.toLocaleDateString('en-IN');
    if (dto.channel === 'EMAIL') {
      if (invoice.lead.email) {
        const template = await this.resolveEmiEmailTemplate(caller.orgId ?? undefined);
        if (template) {
          const values = {
            name: invoice.lead.name,
            installment_no: String(installment.installmentNumber),
            amount: String(installment.amount),
            invoice_no: invoice.invoiceNumber,
            due_date: dueDate,
            payment_link: paymentLinkUrl ?? '',
            org: template.orgName,
          };
          await this.mail.send(
            invoice.lead.email,
            fillTemplate(template.subject, values),
            renderEmailHtml(template.body, values, ['payment_link']),
          );
        } else {
          await this.mail.send(
            invoice.lead.email,
            `Payment reminder — Invoice ${invoice.invoiceNumber}`,
            `<p>Hi ${invoice.lead.name},</p><p>This is a reminder that installment #${installment.installmentNumber} of ₹${installment.amount} for invoice ${invoice.invoiceNumber} is due on ${dueDate}.</p>${paymentLinkUrl ? `<p><a href="${paymentLinkUrl}">Pay online</a></p>` : ''}`,
          );
        }
      } else {
        this.logger.warn(`Invoice ${id} lead has no email — skipping EMI reminder email for installment ${n}`);
      }
    } else {
      const template = await this.resolveEmiWhatsAppTemplate(caller.orgId ?? undefined);
      if (template) {
        // Approved template — deliverable any time, not just inside Meta's 24h window.
        // Configured via Administration > Payments (organizations.service.ts updateSettings).
        const values: Record<string, string> = {
          name: invoice.lead.name,
          installment_no: String(installment.installmentNumber),
          amount: String(installment.amount),
          invoice_no: invoice.invoiceNumber,
          due_date: dueDate,
          payment_link: paymentLinkUrl ?? '',
          org: template.orgName,
        };
        const params = template.variables.map((v) => values[v] ?? '');
        await this.communications.sendWhatsAppTemplate(
          invoice.leadId,
          template.metaTemplateName,
          template.language,
          params,
          caller,
        );
      } else {
        // No template configured — free-form text only delivers inside Meta's 24h
        // customer-service window; outside it this throws (see
        // CommunicationsService.sendWhatsApp), and that failure is allowed to propagate
        // here rather than being swallowed, so the caller/UI learns the reminder did NOT
        // actually go out instead of a false "sent" toast.
        const message = `Hi ${invoice.lead.name}, this is a reminder that installment #${installment.installmentNumber} of ₹${installment.amount} for invoice ${invoice.invoiceNumber} is due on ${dueDate}.${paymentLinkUrl ? ` Pay online: ${paymentLinkUrl}` : ''}`;
        await this.communications.sendWhatsApp(invoice.leadId, message, caller);
      }
    }

    return this.prisma.emiInstallment.update({
      where: { id: installment.id },
      data: { lastReminderAt: new Date(), lastReminderChannel: dto.channel },
    });
  }

  async markInstallmentPaid(id: string, n: number, caller: AuthUser) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(ErrorMessages.invoices.notFound);

    const installment = await this.prisma.emiInstallment.findFirst({
      where: { invoiceId: id, installmentNumber: n },
    });
    if (!installment) throw new NotFoundException(ErrorMessages.invoices.installmentNotFound);

    return this.prisma.emiInstallment.update({
      where: { id: installment.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }

  // Marks the invoice SENT, optionally attaching a payment link. Registration-sourced
  // invoices are gated below — send() refuses until the registration payment has been recorded.
  //
  // SCRUM-44: this previously only flipped the invoice's `status` to SENT — it never actually
  // emailed anything to the customer, so "Send Invoice" silently did nothing from the
  // recipient's point of view. Now it builds the same PDF as GET /invoices/:id/pdf and emails
  // it to the lead, mirroring PaymentReceiptsService.sendInvoiceForPayment's pattern.
  async send(id: string, dto: SendInvoiceDto, caller: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...buildInvoiceScopeFilter(caller) },
      include: invoicePdfInclude,
    });
    if (!invoice) throw new NotFoundException(ErrorMessages.invoices.notFound);

    if (invoice.generatedFromRegistration && !invoice.registeredAt) {
      throw new ForbiddenException(ErrorMessages.invoices.registrationPaymentRequired);
    }

    if (!invoice.lead.email) {
      throw new BadRequestException(ErrorMessages.invoices.leadEmailRequired);
    }

    let paymentLinkUrl: string | null = null;
    if (dto.attachPaymentLink) {
      // Once auto-debit is set up, Razorpay itself already collects every installment on
      // schedule and already sent the customer its own authorization link at mandate-creation
      // time — attaching another payment link here would just be a second, redundant link.
      if (invoice.emiPaymentMode === 'SUBSCRIPTION' && invoice.emiGatewaySubscriptionId) {
        throw new BadRequestException(ErrorMessages.invoices.mandateCoversPayment);
      }
      if (dto.gateway !== 'RAZORPAY' && dto.gateway !== 'CASHFREE') {
        // Stripe/PayU are never connected — same rule as sendRegistrationPaymentLink.
        throw new BadRequestException(ErrorMessages.invoices.unsupportedGateway);
      }
      // Once an EMI plan exists, the customer owes the next pending installment, not the
      // full grandTotal — otherwise this link demands full payment even though they agreed
      // to pay in installments (see remindInstallment's per-installment link, which already
      // gets this right).
      const nextInstallment = invoice.emiInstallments.find((inst) => inst.status === 'PENDING');
      const amountDue = nextInstallment ? nextInstallment.amount : invoice.grandTotal;
      const link = await this.payments.createGatewayLink(
        dto.gateway,
        caller.orgId ?? undefined,
        amountDue,
        'INR',
        invoice.id,
        { name: invoice.lead.name, email: invoice.lead.email ?? undefined, contact: toE164(invoice.lead.phone) },
      );
      paymentLinkUrl = link.shortUrl;
    }

    // Awaited (not fire-and-forget) — unlike the welcome email on lead creation, this *is*
    // the user-visible effect of clicking "Send Invoice", so a failure must surface to the
    // caller rather than be silently swallowed. MailService.sendRaw itself never throws (it
    // logs via Logger.error internally per CLAUDE.md's exception-logging rule), so this only
    // throws for invoice-lookup/validation errors above — genuine SES failures are logged,
    // not thrown, matching how every other mail send in this codebase degrades.
    const logoBuffer = await this.getOrgLogoBuffer(invoice.org?.logoKey);
    const pdf = await buildInvoicePdf(invoice, logoBuffer);
    await this.mail.sendRaw(
      invoice.lead.email,
      `Invoice ${invoice.invoiceNumber} — ${invoice.org?.name ?? 'GenX CRM'}`,
      this.invoiceSendEmailHtml(invoice.lead.name, invoice.invoiceNumber, paymentLinkUrl),
      [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
    );

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        paymentLinkAttached: paymentLinkUrl !== null,
        paymentGateway: paymentLinkUrl !== null ? dto.gateway : null,
        paymentLinkUrl,
      },
    });
    return this.stripInternalFields(updated);
  }

  private invoiceSendEmailHtml(leadName: string, invoiceNumber: string, paymentLinkUrl: string | null): string {
    return `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">
        <p>Hi ${leadName},</p>
        <p>Please find your invoice <strong>${invoiceNumber}</strong> attached as a PDF.</p>
        ${paymentLinkUrl ? `<p><a href="${paymentLinkUrl}">Pay online</a></p>` : ''}
        <p>If you have any questions about this invoice, just reply to this email.</p>
        <p style="color:#667">— Team GenX CRM</p>
      </div>`;
  }

  // `connected` reports whether send()/sendRegistrationPaymentLink() can actually create a
  // payment link right now — the org's own connected Razorpay (OrgIntegration) or the
  // platform's fallback credentials — via the same PaymentsService.isRazorpayConnected() check
  // those methods use to create the link, so this badge can never say Connected when a send
  // would fail (previously it only checked RAZORPAY_KEY_ID presence and always showed
  // Connected even though link creation was unimplemented; see b90b78a).
  async getConnectedPaymentGateways(caller: AuthUser) {
    return [
      { gateway: 'RAZORPAY' as const, connected: await this.payments.isRazorpayConnected(caller.orgId ?? undefined) },
      { gateway: 'CASHFREE' as const, connected: await this.payments.isCashfreeConnected(caller.orgId ?? undefined) },
    ];
  }
}
