import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateDispatchDto } from './dto/create-dispatch.dto';
import type { UpdateDispatchDto } from './dto/update-dispatch.dto';

const ENTITY_TYPE = 'Dispatch';
const MODULE_KEY = 'dispatch';
const LIST_FILTERS = {
  moduleKey: 'dispatch',
  entityType: ENTITY_TYPE,
  dateField: 'invoiceDate',
  facetFields: [],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['dispatchDate', 'status', 'createdAt'];

export interface DispatchListQuery extends ModuleListQuery {
  salesOrderId?: string;
}

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  'Mark dispatched': { to: 'Dispatched', when: ['Planned'] },
  'In transit': { to: 'In transit', when: ['Dispatched'] },
  'Mark delivered': { to: 'Delivered', when: ['Dispatched', 'In transit'], requires: 'actual' },
};

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  // Dispatch has no ownerId column — org-only scoping for every role (matches Product/Approval in Phase 3b).
  private scopeFilter(caller: AuthUser): Prisma.DispatchWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  private async baseWhere(query: DispatchListQuery, caller: AuthUser): Promise<Prisma.DispatchWhereInput> {
    return {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.search ? { invoiceNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: DispatchListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.dispatch as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: DispatchListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.DispatchWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.dispatch.count({ where }),
      this.prisma.dispatch.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.dispatch.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Dispatch '${id}' not found.`);
    return this.withSlaState(record);
  }

  private async assertSalesOrderInOrg(salesOrderId: string, caller: AuthUser): Promise<void> {
    const salesOrder = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, orgId: caller.orgId ?? '' } });
    if (!salesOrder) throw new BadRequestException(`Sales order '${salesOrderId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  async create(dto: CreateDispatchDto, caller: AuthUser) {
    await this.assertSalesOrderInOrg(dto.salesOrderId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    // Terms such as "50% before dispatch" hold the shipment until that milestone is paid.
    const unpaid = await this.prisma.paymentMilestone.findMany({
      where: { salesOrderId: dto.salesOrderId, orgId: requireOrgId(caller), isDeleted: false, milestone: 'Before dispatch', status: { not: 'Received' } },
      select: { id: true, status: true, amount: true },
    });
    if (unpaid.length > 0) {
      const which = unpaid.map((m) => `${m.id.slice(-6).toUpperCase()} (${m.status}, ₹${m.amount.toLocaleString('en-IN')})`).join(', ');
      throw new BadRequestException(`A 'Before dispatch' payment is still outstanding: ${which}. Record it in full before creating a dispatch.`);
    }
    const dispatch = await this.prisma.dispatch.create({
      data: {
        ...dto,
        dispatchDate: new Date(dto.dispatchDate),
        ...(dto.invoiceDate ? { invoiceDate: new Date(dto.invoiceDate) } : {}),
        ...(dto.expectedDelivery ? { expectedDelivery: new Date(dto.expectedDelivery) } : {}),
        orgId: requireOrgId(caller),
        status: 'Planned',
      },
    });
    await this.notifySalesperson(dispatch);
    return dispatch;
  }

  // The order's owner hears that their order is being shipped.
  private async notifySalesperson(dispatch: { id: string; orgId: string; salesOrderId: string }): Promise<void> {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: dispatch.salesOrderId, orgId: dispatch.orgId }, select: { ownerId: true } });
    if (!order?.ownerId) return;
    await this.notifications.create(dispatch.orgId, order.ownerId, 'Dispatch created', 'A dispatch was created for your sales order.', `/dispatch/${dispatch.id}`);
  }

  async update(id: string, dto: UpdateDispatchDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.salesOrderId) await this.assertSalesOrderInOrg(dto.salesOrderId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    return this.prisma.dispatch.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.dispatchDate ? { dispatchDate: new Date(dto.dispatchDate) } : {}),
        ...(dto.invoiceDate ? { invoiceDate: new Date(dto.invoiceDate) } : {}),
        ...(dto.expectedDelivery ? { expectedDelivery: new Date(dto.expectedDelivery) } : {}),
      },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.dispatch.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for dispatches.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a dispatch in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.DispatchUncheckedUpdateInput = { status: transition.to };
    if (action === 'Mark delivered') data.actualDelivery = new Date(payload!.actual as string);
    const updated = await this.prisma.dispatch.update({ where: { id }, data });
    if (action === 'Mark dispatched') {
      // SLA-18 'Delivery confirmation': starts once the shipment actually leaves.
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Dispatched');
    } else if (action === 'Mark delivered') {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Delivered');
    }
    return updated;
  }
}
