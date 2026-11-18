import { BadRequestException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { PdfService } from '../pdf/pdf.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import type { CreateQuotationDto } from './dto/create-quotation.dto';
import type { UpdateQuotationDto } from './dto/update-quotation.dto';

const ENTITY_TYPE = 'Quotation';
const MODULE_KEY = 'quotes';
const LIST_FILTERS = {
  moduleKey: 'quotes',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'quotationDate',
  facetFields: ['currency', 'paymentTerms', 'deliveryTerms'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['validUntil', 'status', 'createdAt'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  'Mark sent': { to: 'Sent', when: ['Approved'] },
  'Mark accepted': { to: 'Accepted', when: ['Sent'] },
  'Mark rejected': { to: 'Rejected', when: ['Sent'], requires: 'rej' },
  Approve: { to: 'Approved', when: ['Approval pending'] },
  Reject: { to: 'Draft', when: ['Approval pending'], requires: 'rej' },
};
const LOCKED_FIELDS = ['quotationDate', 'validUntil', 'currency', 'paymentTerms', 'deliveryTerms', 'deliveryTime', 'warranty', 'freight', 'installation', 'exclusions', 'termsAndConditions'];
const SPECIAL_ACTIONS = new Set(['Download PDF']);

export interface QuotationListQuery extends ModuleListQuery {
  opportunityId?: string;
  accountId?: string;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly pdf: PdfService,
    private readonly nurturing: MfgNurturingService,
    private readonly automation: AutomationEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  // Readable record title ("Quotation v2 — Shree Steel") so the UI doesn't have to show a UUID.
  private withTitle<T extends { version: number; account: { name: string } | null }>(row: T) {
    const { account, ...rest } = row;
    return { ...rest, title: account ? `Quotation v${row.version} — ${account.name}` : `Quotation v${row.version}` };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.QuotationWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  private async baseWhere(query: QuotationListQuery, caller: AuthUser): Promise<Prisma.QuotationWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search.trim(), mode: 'insensitive' as const } },
              { account: { name: { contains: query.search.trim(), mode: 'insensitive' as const } } },
              { account: { short: { contains: query.search.trim(), mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
  }

  async getFacets(query: QuotationListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.quotation as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: QuotationListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.QuotationWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.quotation.count({ where }),
      this.prisma.quotation.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction }, include: { account: { select: { name: true } } } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(this.withTitle(row))));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const found = await this.prisma.quotation.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false }, include: { account: { select: { name: true } } } });
    if (!found) throw new NotFoundException(`Quotation '${id}' not found.`);
    const record = this.withTitle(found);
    // The detail page's Line items tab reads `lines` off the record; the record itself has no such column.
    const lines = await this.prisma.quotationLine.findMany({ where: { quotationId: id }, orderBy: { id: 'asc' } });
    return { ...(await this.withSlaState(record)), lines };
  }

  private async assertOpportunityInOrg(opportunityId: string, caller: AuthUser): Promise<void> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, orgId: caller.orgId ?? '' } });
    if (!opportunity) throw new BadRequestException(`Opportunity '${opportunityId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  private async assertLineProductsInOrg(lines: { productId?: string }[], caller: AuthUser): Promise<void> {
    const productIds = [...new Set(lines.map((line) => line.productId).filter((id): id is string => Boolean(id)))];
    for (const productId of productIds) {
      const product = await this.prisma.product.findFirst({ where: { id: productId, orgId: caller.orgId ?? '' } });
      if (!product) throw new BadRequestException(`Product '${productId}' not found in your organization.`);
    }
  }

  async create(dto: CreateQuotationDto, caller: AuthUser) {
    await this.assertOpportunityInOrg(dto.opportunityId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    const created = await this.prisma.quotation.create({
      data: {
        ...dto,
        ownerId,
        quotationDate: new Date(dto.quotationDate),
        validUntil: new Date(dto.validUntil),
        currency: dto.currency ?? 'INR',
        orgId: requireOrgId(caller),
        status: 'Draft',
        version: 1,
      },
    });
    return this.assignDocumentNo(created);
  }

  // Stamps the number from the org's 'Quotation…' document template (if it has one) onto the record.
  private async assignDocumentNo<T extends { id: string; orgId: string; quotationDate: Date; createdAt: Date }>(quotation: T): Promise<T> {
    const template = await this.resolveDocumentTemplate(quotation);
    if (!template) return quotation;
    return this.prisma.quotation.update({ where: { id: quotation.id }, data: { documentNo: template.number } }) as unknown as T;
  }

  async update(id: string, dto: UpdateQuotationDto, caller: AuthUser) {
    const existing = await this.findOne(id, caller);
    if (existing.status === 'Revised') {
      throw new BadRequestException('A revised quotation is read-only. Open the latest version to make changes.');
    }
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    const { lines, ...rest } = dto;
    if (lines && existing.status !== 'Draft') {
      throw new BadRequestException(`Quotation lines can only be edited while the quotation is in Draft (current status: '${existing.status}').`);
    }
    if (lines) await this.assertLineProductsInOrg(lines, caller);
    if (existing.status !== 'Draft') this.assertCommercialTermsUnchanged(existing, rest);
    const data: Prisma.QuotationUpdateInput = {
      ...rest,
      ...(rest.quotationDate ? { quotationDate: new Date(rest.quotationDate as unknown as string) } : {}),
      ...(rest.validUntil ? { validUntil: new Date(rest.validUntil as unknown as string) } : {}),
    };
    if (!lines) {
      return this.prisma.quotation.update({ where: { id }, data });
    }
    const [, , updated] = await this.prisma.$transaction([
      this.prisma.quotationLine.deleteMany({ where: { quotationId: id } }),
      this.prisma.quotationLine.createMany({
        // A line saved without an amount gets qty × price less its discount.
        data: lines.map((line) => ({ ...line, amount: line.amount ?? Math.round(line.qty * line.unitPrice * (1 - (line.discountPct ?? 0) / 100) * 100) / 100, quotationId: id })),
      }),
      this.prisma.quotation.update({ where: { id }, data }),
    ]);
    return updated;
  }

  // An issued version is immutable: changing price-bearing terms means a revision (new version).
  private assertCommercialTermsUnchanged(existing: Record<string, unknown>, changes: Record<string, unknown>): void {
    const normalize = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? '')).slice(0, value instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? 10 : undefined);
    const locked = LOCKED_FIELDS.filter((field) => changes[field] !== undefined && normalize(existing[field]) !== normalize(changes[field]));
    if (locked.length) {
      throw new BadRequestException(`An issued quotation can't be changed (${locked.join(', ')}). Use Revise → new version instead.`);
    }
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.quotation.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (action === 'Submit for approval') return this.submitForApproval(id, caller);
    if (action === 'Revise → new version') return this.reviseNewVersion(id, caller);
    if (SPECIAL_ACTIONS.has(action)) throw new NotImplementedException(`'${action}' is not yet implemented.`);
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for quotations.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a quotation in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const updated = await this.prisma.quotation.update({ where: { id }, data: { status: transition.to } });
    if (action === 'Approve') {
      // SLA-11 'Quotation issue': starts once the quotation itself is approved.
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Costing approved');
    } else if (action === 'Mark sent') {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Quotation sent');
      // SLA-12 'Quotation follow-up': starts the moment the quotation is sent.
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Quotation sent');
      await this.createFollowUpActivity(updated);
      await this.nurturing.enroll(updated.orgId, 'quotation_sent', ENTITY_TYPE, id);
      await this.automation.fire(updated.orgId, 'Quotation sent', {
        link: `/quotations/${id}`, title: `Quotation v${updated.version} was sent`, ownerId: updated.ownerId, accountId: updated.accountId, opportunityId: updated.opportunityId,
        value: (await this.prisma.quotationLine.findMany({ where: { quotationId: id }, select: { amount: true, qty: true, unitPrice: true } })).reduce((sum, l) => sum + (l.amount ?? l.qty * l.unitPrice), 0),
      });
    } else if (['Mark accepted', 'Mark rejected'].includes(action)) {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Customer response logged');
    }
    if (action === 'Mark accepted') {
      // SLA-13 'Quotation expiry reminder' also stops once the quotation is accepted.
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Revised / accepted');
    }
    return updated;
  }

  // Sending a quotation books the 3-day follow-up on the opportunity (the SLA-12 deadline), so it shows in the owner's task list.
  private async createFollowUpActivity(quotation: { orgId: string; opportunityId: string; accountId: string; ownerId: string | null; version: number }): Promise<void> {
    await this.prisma.mfgActivity.create({
      data: {
        orgId: quotation.orgId,
        type: 'Quotation follow-up',
        subject: `Follow up on quotation v${quotation.version}`,
        opportunityId: quotation.opportunityId,
        accountId: quotation.accountId,
        ownerId: quotation.ownerId,
        priority: 'Medium',
        status: 'Open',
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });
  }

  async getVersionEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    const record = await this.findOne(id, caller);
    return [{ id: record.id, at: record.createdAt.toISOString(), label: `V${record.version} created` }];
  }

  private async findMatchingApprovalRule(type: string, value: number, caller: AuthUser) {
    const rules = await this.prisma.approvalRule.findMany({
      where: { orgId: caller.orgId ?? '', type, isActive: true, isDeleted: false },
      orderBy: { min: 'asc' },
    });
    if (!rules.length) return null;
    // Bands are "up to and including" their upper edge: 5% is still the salesperson's, 5.1% the manager's.
    return rules.find((r) => value <= r.max) ?? rules[rules.length - 1];
  }

  async submitForApproval(id: string, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (record.status !== 'Draft') {
      throw new BadRequestException(`Cannot submit a quotation in status '${record.status}'.`);
    }
    const lines = await this.prisma.quotationLine.findMany({ where: { quotationId: id }, include: { product: true } });
    const warnings: string[] = [];
    for (const line of lines) {
      if (line.product?.minPrice != null) {
        const netPrice = line.unitPrice * (1 - line.discountPct / 100);
        if (netPrice < line.product.minPrice) {
          warnings.push(
            `Line for ${line.product.sku ?? line.productId} is priced below minimum (₹${netPrice.toFixed(2)} < ₹${line.product.minPrice}).`,
          );
        }
      }
    }
    const maxDiscount = lines.reduce((max, l) => Math.max(max, l.discountPct ?? 0), 0);
    const rule = await this.findMatchingApprovalRule('Discount', maxDiscount, caller);
    if (rule) {
      const approval = await this.prisma.approval.create({
        data: {
          orgId: requireOrgId(caller),
          title: `Quotation approval — QT-${record.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          entityType: 'Quotation',
          entityId: record.id,
          type: 'Discount',
          requestedById: caller.id,
          currentApprover: rule.approverRole,
          matchedRule: rule.id,
          reason: `Discount ${maxDiscount}% matched approval rule AR-${rule.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          status: 'Requested',
        },
      });
      // SLA-14 'Approval turnaround': starts for this auto-created approval too, not just ones
      // created directly through the Approvals module.
      await this.slaEngine.startTimer(approval.orgId, 'approvals', 'Approval', approval.id, 'Approval requested', approval.currentApprover ?? undefined);
    }
    const updated = await this.prisma.quotation.update({
      where: { id },
      data: { status: rule ? 'Approval pending' : 'Approved' },
    });
    if (!rule) {
      // SLA-11 'Quotation issue': starts here too, when no approval rule matches and the
      // quotation is auto-approved straight out of submission.
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Costing approved');
    }
    return { ...updated, warnings } as Record<string, unknown>;
  }

  async reviseNewVersion(id: string, caller: AuthUser) {
    const parent = await this.findOne(id, caller);
    if (!['Sent', 'Approved', 'Rejected', 'Approval pending'].includes(parent.status)) {
      throw new BadRequestException(`Cannot revise a quotation in status '${parent.status}'.`);
    }
    const lines = await this.prisma.quotationLine.findMany({ where: { quotationId: id } });
    return this.prisma.$transaction(async (tx) => {
      const child = await tx.quotation.create({
        data: {
          orgId: parent.orgId,
          opportunityId: parent.opportunityId,
          accountId: parent.accountId,
          version: parent.version + 1,
          parentId: parent.id,
          quotationDate: parent.quotationDate,
          validUntil: parent.validUntil,
          currency: parent.currency,
          ownerId: parent.ownerId,
          status: 'Draft',
          paymentTerms: parent.paymentTerms,
          deliveryTerms: parent.deliveryTerms,
          deliveryTime: parent.deliveryTime,
          warranty: parent.warranty,
          freight: parent.freight,
          installation: parent.installation,
          exclusions: parent.exclusions,
          termsAndConditions: parent.termsAndConditions,
        },
      });
      if (lines.length) {
        await tx.quotationLine.createMany({
          data: lines.map((l) => ({
            quotationId: child.id,
            productId: l.productId,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            amount: l.amount,
          })),
        });
      }
      await tx.quotation.update({ where: { id }, data: { status: 'Revised' } });
      return child;
    }).then(async (child) => {
      // SLA-13 'Quotation expiry reminder' stops on the parent once it's revised.
      await this.slaEngine.stopTimer(parent.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Revised / accepted');
      return this.assignDocumentNo(child);
    });
  }

  // The org's 'Quotation…' document template sets the number printed on the PDF ("QT-{YY}{MM}-{####}")
  // and supplies the terms text when the quotation has none of its own.
  private async resolveDocumentTemplate(quotation: { orgId: string; quotationDate: Date; createdAt: Date; id: string }): Promise<{ number: string; terms: string | null } | null> {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { orgId: quotation.orgId, isDeleted: false, name: { contains: 'quotation', mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!template) return null;
    const sequence = await this.prisma.quotation.count({ where: { orgId: quotation.orgId, createdAt: { lte: quotation.createdAt } } });
    const { quotationDate: date } = quotation;
    const number = template.numberingPattern
      .replace('{YYYY}', String(date.getFullYear()))
      .replace('{YY}', String(date.getFullYear()).slice(-2))
      .replace('{MM}', String(date.getMonth() + 1).padStart(2, '0'))
      .replace(/\{(#+)\}/, (_, hashes: string) => String(sequence).padStart(hashes.length, '0'))
      .replace('{SEQ}', String(sequence).padStart(4, '0'));
    return { number, terms: template.description };
  }

  async buildPdf(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }> {
    const quotation = await this.findOne(id, caller);
    const [account, opportunity, lines] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: quotation.accountId }, select: { name: true, billing: true, city: true, state: true } }),
      this.prisma.opportunity.findUnique({ where: { id: quotation.opportunityId }, select: { title: true } }),
      this.prisma.quotationLine.findMany({ where: { quotationId: id }, include: { product: { select: { model: true, sku: true } } } }),
    ]);
    const documentTemplate = await this.resolveDocumentTemplate(quotation);
    const lineTotal = (l: (typeof lines)[number]) => l.amount ?? l.qty * l.unitPrice * (1 - l.discountPct / 100);
    const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

    const buffer = await this.pdf.render((doc) => {
      doc.fontSize(18).font('Helvetica-Bold').text('Quotation', { align: 'right' });
      doc.fontSize(10).font('Helvetica').text(`${quotation.documentNo ?? documentTemplate?.number ?? id} · v${quotation.version}`, { align: 'right' });
      doc.moveDown();
      this.pdf.fieldBlock(doc, [
        ['Account', account?.name ?? '—'],
        ['Billing address', [account?.billing, account?.city, account?.state].filter(Boolean).join(', ')],
        ['Opportunity', opportunity?.title ?? '—'],
        ['Quotation date', quotation.quotationDate.toLocaleDateString('en-IN')],
        ['Valid until', quotation.validUntil.toLocaleDateString('en-IN')],
        ['Payment terms', quotation.paymentTerms],
      ]);
      this.pdf.table(
        doc,
        [{ label: 'Item', width: 220 }, { label: 'Qty', width: 50 }, { label: 'Unit price', width: 90 }, { label: 'Disc %', width: 60 }, { label: 'Amount' }],
        lines.map((l) => [
          l.description ?? l.product?.model ?? l.product?.sku ?? '—',
          String(l.qty),
          l.unitPrice.toLocaleString('en-IN'),
          `${l.discountPct}%`,
          lineTotal(l).toLocaleString('en-IN'),
        ]),
      );
      doc.font('Helvetica-Bold').fontSize(12).text(`Grand total: ₹${grandTotal.toLocaleString('en-IN')}`, { align: 'right' });
      const terms = quotation.termsAndConditions ?? documentTemplate?.terms;
      if (terms) {
        doc.moveDown().font('Helvetica-Bold').fontSize(10).text('Terms & conditions');
        doc.font('Helvetica').fontSize(9).text(terms);
      }
    });
    return { filename: `Quotation-${id}-v${quotation.version}.pdf`, buffer };
  }
}
