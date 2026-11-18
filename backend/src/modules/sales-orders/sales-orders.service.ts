import { BadRequestException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { isModuleFullyRestricted } from '../../modules-framework/utils/field-permission.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { PdfService } from '../pdf/pdf.service';
import type { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import type { UpdateSalesOrderDto } from './dto/update-sales-order.dto';

const ENTITY_TYPE = 'SalesOrder';
const MODULE_KEY = 'sorders';
const LIST_FILTERS = {
  moduleKey: 'sorders',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'committedDelivery',
  valueField: 'value',
  facetFields: ['installScope', 'commissioningScope'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['value', 'committedDelivery', 'status', 'createdAt'];

export const ORDER_FLOW = [
  'Order accepted',
  'Design',
  'Procurement',
  'Production',
  'Quality check',
  'Ready for dispatch',
  'Dispatched',
  'Delivered',
  'Installation',
  'Commissioned',
  'Closed',
];

// Installation workflow, one step at a time: each action needs the status before it.
const INSTALL_STEPS: Record<string, { from: string | null; to: string }> = {
  'Plan installation': { from: null, to: 'Planned' },
  'Start installation': { from: 'Planned', to: 'In progress' },
  'Mark installed': { from: 'In progress', to: 'Installed' },
  'Request sign-off': { from: 'Installed', to: 'Pending sign-off' },
  'Customer sign-off': { from: 'Pending sign-off', to: 'Closed' },
};

const SPECIAL_ACTIONS = new Set(['Create dispatch']);

export interface SalesOrderListQuery extends ModuleListQuery {
  accountId?: string;
}

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly pdf: PdfService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.SalesOrderWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  private async baseWhere(query: SalesOrderListQuery, caller: AuthUser): Promise<Prisma.SalesOrderWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search.trim(), mode: 'insensitive' as const } },
              { accountId: { contains: query.search.trim(), mode: 'insensitive' as const } },
              { products: { contains: query.search.trim(), mode: 'insensitive' as const } },
              { account: { name: { contains: query.search.trim(), mode: 'insensitive' as const } } },
              { account: { short: { contains: query.search.trim(), mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
  }

  async getFacets(query: SalesOrderListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.salesOrder as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: SalesOrderListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.SalesOrderWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  private async findScoped(id: string, caller: AuthUser) {
    const record = await this.prisma.salesOrder.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Sales order '${id}' not found.`);
    return this.withSlaState(record);
  }

  // The detail view: the record plus its payment summary.
  async findOne(id: string, caller: AuthUser) {
    const record = await this.findScoped(id, caller);
    return { ...record, paymentSummary: await this.summarizePayments(record, caller) };
  }

  // "Total ₹X · Received ₹Y · Outstanding ₹Z · Next due 12 Oct 2026" from the order's milestones and their receipts.
  // A role restricted from 'Payment receipts' gets no received/outstanding figures here either, matching the masked milestone list.
  private async summarizePayments(order: { id: string; orgId: string; value: number }, caller: AuthUser): Promise<string> {
    const receiptsHidden = await isModuleFullyRestricted(this.prisma, caller, 'payments', 'Payment receipts');
    const milestones = await this.prisma.paymentMilestone.findMany({
      where: { salesOrderId: order.id, orgId: order.orgId, isDeleted: false },
      include: { receipts: { select: { amount: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
    const received = milestones.reduce((sum, m) => sum + m.receipts.reduce((s, r) => s + r.amount, 0), 0);
    const nextDue = milestones.find((m) => m.status !== 'Received');
    return [
      `Total ${money(order.value)}`,
      ...(receiptsHidden ? [] : [`Received ${money(received)}`, `Outstanding ${money(Math.max(order.value - received, 0))}`]),
      `Next due ${nextDue ? nextDue.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`,
    ].join(' · ');
  }

  private async assertPurchaseOrderInOrg(purchaseOrderId: string, caller: AuthUser): Promise<void> {
    const purchaseOrder = await this.prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, orgId: caller.orgId ?? '' } });
    if (!purchaseOrder) throw new BadRequestException(`Purchase order '${purchaseOrderId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  private async assertContactInOrg(contactId: string, caller: AuthUser): Promise<void> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: caller.orgId ?? '' } });
    if (!contact) throw new BadRequestException(`Contact '${contactId}' not found in your organization.`);
  }

  async create(dto: CreateSalesOrderDto, caller: AuthUser) {
    if (dto.purchaseOrderId) await this.assertPurchaseOrderInOrg(dto.purchaseOrderId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.custContactId) await this.assertContactInOrg(dto.custContactId, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    const order = await this.prisma.salesOrder.create({
      data: {
        ...dto,
        ownerId,
        ...(dto.committedDelivery ? { committedDelivery: new Date(dto.committedDelivery) } : {}),
        orgId: requireOrgId(caller),
        status: ORDER_FLOW[0],
        ackStatus: 'Pending',
      },
    });
    // SLA-16 'Operations handover acknowledgement': starts the moment the order is created.
    await this.slaEngine.startTimer(order.orgId, MODULE_KEY, ENTITY_TYPE, order.id, 'Sales order created');
    return order;
  }

  private async advanceInstallation(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findScoped(id, caller);
    const step = INSTALL_STEPS[action];
    if (!['Delivered', 'Installation', 'Commissioned'].includes(record.status)) {
      throw new BadRequestException(`Installation starts once the order is Delivered (current status: '${record.status}').`);
    }
    if ((record.installStatus ?? null) !== step.from) {
      throw new BadRequestException(`Cannot ${action} while installation is '${record.installStatus ?? 'not planned'}'.`);
    }
    const data: Prisma.SalesOrderUpdateInput = { installStatus: step.to };
    if (action === 'Plan installation') {
      const date = String(payload?.date ?? '').trim();
      if (!date || Number.isNaN(Date.parse(date))) throw new BadRequestException(`'date' is required to ${action}.`);
      data.installPlannedOn = new Date(date);
    }
    if (action === 'Mark installed') data.installedOn = new Date();
    if (action === 'Customer sign-off') {
      const by = String(payload?.by ?? '').trim();
      if (!by) throw new BadRequestException(`'by' (who signed off) is required to ${action}.`);
      data.signOffBy = by;
      data.signOffOn = new Date();
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.orderMilestone.create({ data: { salesOrderId: id, status: `Installation: ${step.to}`, createdById: caller.id } }),
      this.prisma.salesOrder.update({ where: { id }, data }),
    ]);
    // Sign-off is the step that gets forgotten: put it on the owner's task list the moment installation finishes.
    if (action === 'Request sign-off') {
      await this.prisma.mfgActivity.create({
        data: {
          orgId: record.orgId,
          type: 'Meeting',
          subject: 'Collect customer installation sign-off',
          accountId: record.accountId,
          ownerId: record.ownerId,
          priority: 'High',
          status: 'Open',
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      });
    }
    return updated;
  }

  async buildCommissioningReport(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }> {
    const order = await this.findScoped(id, caller);
    const [account, assets] = await Promise.all([
      this.prisma.account.findFirst({ where: { id: order.accountId, orgId: order.orgId }, select: { name: true } }),
      this.prisma.installedAsset.findMany({
        where: { salesOrderId: id, orgId: order.orgId, isDeleted: false },
        select: { serial: true, model: true, commissionedOn: true, warrantyEnd: true },
      }),
    ]);
    const day = (date: Date | null) => date?.toLocaleDateString('en-IN') ?? '—';
    const buffer = await this.pdf.render((doc) => {
      doc.fontSize(18).font('Helvetica-Bold').text('Installation & commissioning report', { align: 'right' });
      doc.moveDown();
      this.pdf.fieldBlock(doc, [
        ['Customer', account?.name ?? '—'],
        ['Order', `SO-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`],
        ['Installation status', order.installStatus ?? 'Not planned'],
        ['Planned on', day(order.installPlannedOn)],
        ['Installed on', day(order.installedOn)],
        ['Customer sign-off', order.signOffBy ? `${order.signOffBy} on ${day(order.signOffOn)}` : 'Pending'],
      ]);
      this.pdf.table(
        doc,
        [{ label: 'Serial', width: 140 }, { label: 'Model', width: 160 }, { label: 'Commissioned', width: 100 }, { label: 'Warranty ends' }],
        assets.map((a) => [a.serial, a.model, day(a.commissionedOn), day(a.warrantyEnd)]),
      );
    });
    return { filename: `Commissioning-report-${id}.pdf`, buffer };
  }

  // Terms such as "50% before dispatch" hold the shipment until that milestone is paid.
  private async assertDispatchPaymentCleared(salesOrderId: string): Promise<void> {
    const unpaid = await this.prisma.paymentMilestone.count({
      where: { salesOrderId, isDeleted: false, milestone: 'Before dispatch', status: { not: 'Received' } },
    });
    if (unpaid > 0) throw new BadRequestException(`A 'Before dispatch' payment is still outstanding. Record it before dispatching this order.`);
  }

  async update(id: string, dto: UpdateSalesOrderDto, caller: AuthUser) {
    const existing = await this.findScoped(id, caller);
    // The PO behind an order is its audit anchor: re-pointing it would rewrite what the customer agreed to.
    if (dto.purchaseOrderId && dto.purchaseOrderId !== existing.purchaseOrderId) {
      throw new BadRequestException(`An order's purchase order can't be changed.`);
    }
    if (dto.purchaseOrderId) await this.assertPurchaseOrderInOrg(dto.purchaseOrderId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.custContactId) await this.assertContactInOrg(dto.custContactId, caller);
    return this.prisma.salesOrder.update({
      where: { id },
      data: { ...dto, ...(dto.committedDelivery ? { committedDelivery: new Date(dto.committedDelivery) } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findScoped(id, caller);
    await this.prisma.salesOrder.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (SPECIAL_ACTIONS.has(action)) throw new NotImplementedException(`'${action}' is not yet implemented.`);
    if (action === 'Acknowledge handover') {
      await this.findScoped(id, caller);
      const updated = await this.prisma.salesOrder.update({ where: { id }, data: { ackStatus: 'Acknowledged' } });
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Handover acknowledged');
      return updated;
    }
    if (INSTALL_STEPS[action]) return this.advanceInstallation(id, action, payload, caller);
    if (action === 'Send back for rework') {
      const record = await this.findScoped(id, caller);
      if (record.status !== 'Quality check') throw new BadRequestException(`Only an order in Quality check can be sent back for rework (current status: '${record.status}').`);
      const reason = String(payload?.reason ?? '').trim();
      if (!reason) throw new BadRequestException(`'reason' is required to send an order back for rework.`);
      const [, updated] = await this.prisma.$transaction([
        this.prisma.orderMilestone.create({ data: { salesOrderId: id, status: 'Production', note: `Rework: ${reason}`, createdById: caller.id } }),
        this.prisma.salesOrder.update({ where: { id }, data: { status: 'Production' } }),
      ]);
      return updated;
    }
    if (action === 'Advance status') {
      const record = await this.findScoped(id, caller);
      const currentIndex = ORDER_FLOW.indexOf(record.status);
      if (currentIndex === -1 || currentIndex === ORDER_FLOW.length - 1) {
        throw new BadRequestException(`Cannot advance a sales order in status '${record.status}'.`);
      }
      const nextStatus = ORDER_FLOW[currentIndex + 1];
      if (nextStatus === 'Dispatched') await this.assertDispatchPaymentCleared(id);
      if (nextStatus === 'Commissioned' && !payload?.serial) {
        throw new BadRequestException(`'serial' is required to advance a sales order to Commissioned.`);
      }
      if (nextStatus === 'Commissioned') {
        const now = new Date();
        const warrantyEnd = new Date(now);
        warrantyEnd.setFullYear(warrantyEnd.getFullYear() + 1);
        const results = await this.prisma.$transaction([
          this.prisma.orderMilestone.create({ data: { salesOrderId: id, status: nextStatus, createdById: caller.id } }),
          this.prisma.salesOrder.update({ where: { id }, data: { status: nextStatus } }),
          this.prisma.installedAsset.create({
            data: {
              orgId: requireOrgId(caller),
              serial: payload!.serial as string,
              model: record.products ?? 'Unknown',
              accountId: record.accountId,
              salesOrderId: record.id,
              status: 'Under warranty',
              installedOn: now,
              commissionedOn: now,
              warrantyStart: now,
              warrantyEnd,
            },
          }),
        ]);
        return results[1];
      } else {
        const [, updated] = await this.prisma.$transaction([
          this.prisma.orderMilestone.create({ data: { salesOrderId: id, status: nextStatus, createdById: caller.id } }),
          this.prisma.salesOrder.update({ where: { id }, data: { status: nextStatus } }),
        ]);
        if (nextStatus === 'Dispatched') {
          // SLA-17 'Delivery commitment risk' stops the moment the order actually dispatches.
          await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Dispatched');
        }
        return updated;
      }
    }
    throw new BadRequestException(`Unknown action '${action}' for sales orders.`);
  }

  async getMilestoneEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    await this.findScoped(id, caller);
    const rows = await this.prisma.orderMilestone.findMany({ where: { salesOrderId: id }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      label: row.status,
      description: row.note ?? undefined,
    }));
  }
}
