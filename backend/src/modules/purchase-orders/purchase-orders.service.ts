import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import type { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import type { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

const ENTITY_TYPE = 'PurchaseOrder';
const MODULE_KEY = 'pos';
const LIST_FILTERS = {
  moduleKey: 'pos',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'poDate',
  valueField: 'value',
  facetFields: ['currency'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['poNo', 'value', 'poDate', 'createdAt'];

export interface PurchaseOrderListQuery extends ModuleListQuery {
  opportunityId?: string;
}

// Quotation total as the customer sees it: each line's amount, or qty × price less its discount.
const quotedTotal = (lines: { qty: number; unitPrice: number; discountPct: number | null; amount: number | null }[]) =>
  Math.round(lines.reduce((sum, l) => sum + (l.amount ?? l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100)), 0) * 100) / 100;

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  // After a clarification is answered, verification restarts from 'Clarification required' too.
  'Start verification': { to: 'Under verification', when: ['Received', 'Clarification required'] },
  'Request clarification': { to: 'Clarification required', when: ['Under verification'], requires: 'clar' },
  Reject: { to: 'Rejected / cancelled', when: ['Received', 'Under verification', 'Clarification required'], requires: 'rej' },
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
  ) {}

  private async scopeFilter(caller: AuthUser): Promise<Prisma.PurchaseOrderWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  private async baseWhere(query: PurchaseOrderListQuery, caller: AuthUser): Promise<Prisma.PurchaseOrderWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.search ? { OR: [{ poNo: { contains: query.search, mode: 'insensitive' } }, { id: { contains: query.search.trim(), mode: 'insensitive' } }] } : {}),
    };
  }

  async getFacets(query: PurchaseOrderListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.purchaseOrder as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: PurchaseOrderListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(
      rows.map(async (row) => ({ ...row, sla: await this.slaEngine.getSlaState(row.orgId, ENTITY_TYPE, row.id) })),
    );
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.purchaseOrder.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Purchase order '${id}' not found.`);
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async assertOpportunityInOrg(opportunityId: string, caller: AuthUser): Promise<void> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, orgId: caller.orgId ?? '' } });
    if (!opportunity) throw new BadRequestException(`Opportunity '${opportunityId}' not found in your organization.`);
  }

  private async assertQuotationInOrg(quotationId: string, caller: AuthUser): Promise<void> {
    const quotation = await this.prisma.quotation.findFirst({ where: { id: quotationId, orgId: caller.orgId ?? '' } });
    if (!quotation) throw new BadRequestException(`Quotation '${quotationId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  async create(dto: CreatePurchaseOrderDto, caller: AuthUser) {
    await this.assertOpportunityInOrg(dto.opportunityId, caller);
    await this.assertQuotationInOrg(dto.quotationId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    const po = await this.prisma.purchaseOrder.create({
      data: {
        ...dto,
        ownerId,
        poDate: new Date(dto.poDate),
        ...(dto.deliveryDate ? { deliveryDate: new Date(dto.deliveryDate) } : {}),
        currency: dto.currency ?? 'INR',
        orgId: requireOrgId(caller),
        status: 'Received',
      },
    });
    // SLA-15 'PO verification' starts the moment a PO is received.
    await this.slaEngine.startTimer(po.orgId, MODULE_KEY, ENTITY_TYPE, po.id, 'PO received');
    await this.notifyPoReceived(po);
    return po;
  }

  // Sales managers and commercial estimation hear about every new customer PO.
  private async notifyPoReceived(po: { id: string; orgId: string; poNo: string; value: number }): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: { orgId: po.orgId, isActive: true, mfgRole: { in: ['SALES_MANAGER', 'COMMERCIAL_ESTIMATION'] } },
      select: { id: true },
    });
    await Promise.all(
      recipients.map((user) =>
        this.notifications.create(po.orgId, user.id, 'Purchase order received', `PO ${po.poNo} worth ₹${po.value.toLocaleString('en-IN')} needs verification.`, `/pos/${po.id}`),
      ),
    );
  }

  async update(id: string, dto: UpdatePurchaseOrderDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    if (dto.quotationId) await this.assertQuotationInOrg(dto.quotationId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.poDate ? { poDate: new Date(dto.poDate) } : {}),
        ...(dto.deliveryDate ? { deliveryDate: new Date(dto.deliveryDate) } : {}),
      },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.purchaseOrder.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (action === 'Accept PO') return this.acceptPo(id, caller);
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for purchase orders.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a purchase order in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.PurchaseOrderUncheckedUpdateInput = { status: transition.to };
    if (action === 'Request clarification') data.clarification = payload!.clar as string;
    if (action === 'Reject') data.rejectionReason = payload!.rej as string;
    const updated = await this.prisma.purchaseOrder.update({ where: { id }, data });
    if (action === 'Request clarification') {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Accepted / clarification');
    }
    return updated;
  }

  async getCompareTable(id: string, caller: AuthUser): Promise<ModuleTableResult> {
    const record = await this.findOne(id, caller);
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: record.quotationId },
      include: { lines: { include: { product: true } } },
    });
    const lines = quotation?.lines ?? [];
    const quotedQty = lines.reduce((sum, l) => sum + l.qty, 0);
    const qtyStr = lines.map((l) => l.qty).join(' + ');
    const skuStr = lines.map((l) => l.product?.sku ?? l.productId ?? 'Unknown').join(', ');
    const quotedValue = quotedTotal(lines);
    const line = (check: string, quotationValue: unknown, poValue: unknown, result?: 'Match' | 'Mismatch' | 'n/a') => ({
      check,
      quotation: quotationValue,
      po: poValue,
      result: result ?? (quotationValue === poValue ? 'Match' : 'Mismatch'),
    });
    return {
      columns: [
        { key: 'check', label: 'Check', type: 'text' },
        { key: 'quotation', label: 'Quotation', type: 'text' },
        { key: 'po', label: 'Purchase order', type: 'text' },
        { key: 'result', label: 'Result', type: 'pill' },
      ],
      rows: [
        line('Value', quotedValue, record.value),
        // A PO entered without a quantity can't be compared — n/a rather than a fabricated match.
        record.qty == null ? line('Quantity', qtyStr, '—', 'n/a') : line('Quantity', quotedQty, record.qty),
        line('Delivery', quotation?.deliveryTime ?? null, record.deliveryDate ? record.deliveryDate.toISOString() : null),
        line('Payment terms', quotation?.paymentTerms ?? null, record.paymentTerms ?? null),
        record.products
          ? line('Products', skuStr, record.products, lines.every((l) => record.products!.toLowerCase().includes((l.product?.sku ?? l.productId ?? '').toLowerCase())) ? 'Match' : 'Mismatch')
          : line('Products', skuStr, '—', 'n/a'),
      ],
    };
  }

  private parsePaymentTerms(
    terms: string,
    poDate: Date,
    poValue: number,
  ): { milestone: string; pct: number; amount: number; dueDate: Date }[] {
    const daysCreditMatch = terms.match(/(\d+)\s*days?\s*credit/i);
    if (daysCreditMatch) {
      const days = parseInt(daysCreditMatch[1], 10);
      return [
        {
          milestone: 'Retention',
          pct: 100,
          amount: poValue,
          dueDate: new Date(poDate.getTime() + days * 24 * 60 * 60 * 1000),
        },
      ];
    }
    const clauses = terms.split(',').map((c) => c.trim());
    const results: { milestone: string; pct: number; amount: number; dueDate: Date }[] = [];
    for (const clause of clauses) {
      const match = clause.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!match) continue;
      const pct = parseFloat(match[1]);
      const lower = clause.toLowerCase();
      let milestone = 'Retention';
      if (lower.includes('advance')) milestone = 'Advance';
      else if (lower.includes('before dispatch')) milestone = 'Before dispatch';
      else if (lower.includes('after installation')) milestone = 'After installation';
      else if (lower.includes('after delivery')) milestone = 'After delivery';
      results.push({ milestone, pct, amount: (poValue * pct) / 100, dueDate: poDate });
    }
    if (!results.length) {
      return [{ milestone: 'Full payment', pct: 100, amount: poValue, dueDate: poDate }];
    }
    return results;
  }

  async acceptPo(id: string, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (!['Received', 'Under verification', 'Clarification required'].includes(record.status)) {
      throw new BadRequestException(`Cannot accept a purchase order in status '${record.status}'.`);
    }
    await this.assertValueMatchesQuotation(record);
    const parsedMilestones = this.parsePaymentTerms(record.paymentTerms ?? '', record.poDate, record.value);
    let salesOrderId = '';
    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the PO atomically: a concurrent (double-click) accept sees count 0 and is refused.
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, orgId: record.orgId, status: { in: ['Received', 'Under verification', 'Clarification required'] } },
        data: { status: 'Accepted' },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(`Cannot accept a purchase order in status 'Accepted'.`);
      }
      const opportunity = await tx.opportunity.findFirst({ where: { id: record.opportunityId, orgId: caller.orgId ?? '' } });
      if (opportunity && opportunity.stage !== 'Won') {
        await tx.opportunity.update({ where: { id: record.opportunityId }, data: { stage: 'Won' } });
        await tx.opportunityStageHistory.create({
          data: { opportunityId: record.opportunityId, fromStage: opportunity.stage, toStage: 'Won', changedById: caller.id },
        });
      }
      const salesOrder = await tx.salesOrder.create({
        data: {
          orgId: requireOrgId(caller),
          purchaseOrderId: record.id,
          accountId: record.accountId,
          value: record.value,
          status: 'Order accepted',
          ackStatus: 'Pending',
          ownerId: record.ownerId ?? caller.id,
          products: opportunity?.product,
          paymentTerms: record.paymentTerms,
        },
      });
      salesOrderId = salesOrder.id;
      for (const m of parsedMilestones) {
        await tx.paymentMilestone.create({
          data: {
            orgId: requireOrgId(caller),
            salesOrderId: salesOrder.id,
            accountId: record.accountId,
            ownerId: record.ownerId ?? caller.id,
            milestone: m.milestone,
            pct: m.pct,
            amount: m.amount,
            dueDate: m.dueDate,
            status: 'Not due',
          },
        });
      }
      return tx.purchaseOrder.update({ where: { id }, data: { status: 'Accepted' } });
    });
    // SLA-15 'PO verification' stops when the PO is accepted.
    // SLA-16 'Handover acknowledgement' starts with the sales order this acceptance just created.
    await this.slaEngine.startTimer(updated.orgId, 'sorders', 'SalesOrder', salesOrderId, 'Sales order created');
    await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Accepted / clarification');
    await this.requestCreditTermsApproval(record, caller);
    await this.automation.fire(updated.orgId, 'PO accepted', { link: `/purchase-orders/${id}`, title: `PO ${updated.poNo} was accepted`, ownerId: updated.ownerId, accountId: updated.accountId, opportunityId: updated.opportunityId, value: updated.value });
    return updated;
  }

  // A PO whose value differs from the quotation can't be accepted as-is: ask the customer to clarify (or correct the PO value).
  private async assertValueMatchesQuotation(record: { quotationId: string; value: number }): Promise<void> {
    const lines = await this.prisma.quotationLine.findMany({ where: { quotationId: record.quotationId } });
    if (!lines.length) return;
    const quoted = quotedTotal(lines);
    if (Math.abs(quoted - record.value) > 1) {
      throw new BadRequestException(
        `PO value (₹${record.value.toLocaleString('en-IN')}) differs from the quotation (₹${quoted.toLocaleString('en-IN')}). Request clarification, or correct the PO value, before accepting.`,
      );
    }
  }

  // Long credit ("90 days credit") needs a finance sign-off per the CreditTerms rules; raised alongside acceptance, never blocking it.
  private async requestCreditTermsApproval(record: { id: string; orgId: string; paymentTerms: string | null; ownerId: string | null }, caller: AuthUser): Promise<void> {
    // Accepts "90 days credit", "Net 90", "Net-90 days" or a bare "90 days".
    const match = record.paymentTerms?.match(/(\d+)\s*days?(?:\s*credit)?/i) ?? record.paymentTerms?.match(/net[\s-]*(\d+)/i);
    const days = Number(match?.[1]);
    if (!days) return;
    const rules = await this.prisma.approvalRule.findMany({
      where: { orgId: record.orgId, type: 'CreditTerms', isActive: true, isDeleted: false },
      orderBy: { min: 'asc' },
    });
    if (!rules.length || days < rules[0].min) return;
    const rule = rules.find((r) => days <= r.max) ?? rules[rules.length - 1];
    const approval = await this.prisma.approval.create({
      data: {
        orgId: record.orgId,
        title: `Credit terms approval — PO-${record.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
        entityType: 'PaymentTerms',
        entityId: record.id,
        type: 'CreditTerms',
        requestedById: caller.id,
        currentApprover: rule.approverRole,
        matchedRule: rule.id,
        reason: `${days} days credit matched approval rule AR-${rule.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
        status: 'Requested',
      },
    });
    await this.slaEngine.startTimer(approval.orgId, 'approvals', 'Approval', approval.id, 'Approval requested', approval.currentApprover ?? undefined);
  }
}

