import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { maskRestrictedFields, maskRestrictedFieldsMany } from '../../modules-framework/utils/field-permission.util';
import { resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { MailService } from '../mail/mail.service';
import type { CreatePaymentMilestoneDto } from './dto/create-payment-milestone.dto';
import type { UpdatePaymentMilestoneDto } from './dto/update-payment-milestone.dto';

const ENTITY_TYPE = 'PaymentMilestone';
const MODULE_KEY = 'payments';
const LIST_FILTERS = {
  moduleKey: 'payments',
  entityType: ENTITY_TYPE,
  ownerField: 'accountsOwnerId',
  dateField: 'dueDate',
  valueField: 'amount',
  facetFields: ['milestone'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['dueDate', 'amount', 'status', 'createdAt'];

export interface PaymentMilestoneListQuery extends ModuleListQuery {
  salesOrderId?: string;
  accountId?: string;
}

@Injectable()
export class PaymentMilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly mail: MailService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.PaymentMilestoneWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const { ownerId } = (await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) as { ownerId?: string | { in: string[] } };
    return ownerId === undefined ? orgFilter : { ...orgFilter, ownerId };
  }

  private async baseWhere(query: PaymentMilestoneListQuery, caller: AuthUser): Promise<Prisma.PaymentMilestoneWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };
  }

  async getFacets(query: PaymentMilestoneListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.paymentMilestone as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: PaymentMilestoneListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.PaymentMilestoneWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.paymentMilestone.count({ where }),
      this.prisma.paymentMilestone.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    // Roles restricted from 'Payment receipts' (Administration > Roles & permissions) get the amounts masked server-side.
    const masked = await maskRestrictedFieldsMany(await this.withReceiptTotals(rows), MODULE_KEY, caller, this.prisma);
    const data = await Promise.all(masked.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.paymentMilestone.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Payment milestone '${id}' not found.`);
    const [withTotals] = await this.withReceiptTotals([record]);
    return this.withSlaState(await maskRestrictedFields(withTotals, MODULE_KEY, caller, this.prisma));
  }

  // Adds what has been received so far and what is still owed, so a partly paid milestone shows its balance.
  private async withReceiptTotals<T extends { id: string; amount: number }>(rows: T[]): Promise<(T & { received: number; balance: number })[]> {
    if (!rows.length) return [];
    const sums = await this.prisma.receipt.groupBy({ by: ['paymentMilestoneId'], where: { paymentMilestoneId: { in: rows.map((r) => r.id) } }, _sum: { amount: true } });
    const receivedById = new Map(sums.map((s) => [s.paymentMilestoneId, s._sum.amount ?? 0]));
    return rows.map((row) => {
      const received = receivedById.get(row.id) ?? 0;
      return { ...row, received, balance: Math.max(row.amount - received, 0) };
    });
  }

  private async assertSalesOrderInOrg(salesOrderId: string, caller: AuthUser): Promise<void> {
    const salesOrder = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, orgId: caller.orgId ?? '' } });
    if (!salesOrder) throw new BadRequestException(`Sales order '${salesOrderId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  async create(dto: CreatePaymentMilestoneDto, caller: AuthUser) {
    await this.assertSalesOrderInOrg(dto.salesOrderId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    const ownerId = caller.role === Role.SALES_REP ? caller.id : (dto.ownerId ?? caller.id);
    return this.prisma.paymentMilestone.create({
      data: { ...dto, ownerId, dueDate: new Date(dto.dueDate), orgId: requireOrgId(caller), status: 'Not due' },
    });
  }

  async update(id: string, dto: UpdatePaymentMilestoneDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.salesOrderId) await this.assertSalesOrderInOrg(dto.salesOrderId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    return this.prisma.paymentMilestone.update({
      where: { id },
      data: { ...dto, ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.paymentMilestone.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (action === 'Send reminder') return this.sendReminder(id, caller);
    if (action !== 'Record receipt') throw new BadRequestException(`Unknown action '${action}' for payment milestones.`);
    const record = await this.findOne(id, caller);
    if (record.status === 'Received') {
      throw new BadRequestException(`Cannot record a receipt against a payment milestone that is already Received.`);
    }
    if (!payload?.amt) throw new BadRequestException(`'amt' is required to Record receipt.`);
    // Money received beyond what the milestone asks for is kept and flagged on the receipt, never silently absorbed.
    const alreadyReceived = (await this.prisma.receipt.aggregate({ where: { paymentMilestoneId: id }, _sum: { amount: true } }))._sum.amount ?? 0;
    const excess = alreadyReceived + (payload.amt as number) - record.amount;
    const receipt = await this.prisma.receipt.create({
      data: {
        paymentMilestoneId: id,
        amount: payload.amt as number,
        createdById: caller.id,
        ...(excess > 0 ? { note: `Over-payment of ₹${excess.toLocaleString('en-IN')} above the milestone amount` } : {}),
      },
    });
    const totals = await this.prisma.receipt.aggregate({ where: { paymentMilestoneId: id }, _sum: { amount: true } });
    const received = totals._sum.amount ?? 0;
    const fullyReceived = received >= record.amount;
    const data: Prisma.PaymentMilestoneUncheckedUpdateInput = fullyReceived
      ? { status: 'Received', receivedDate: receipt.receivedOn }
      : { status: 'Partially received' };
    const updated = await this.prisma.paymentMilestone.update({ where: { id }, data });
    if (fullyReceived) {
      // SLA-22 'Payment collection' stops once the full amount has been received.
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Received in full');
    }
    return updated;
  }

  // Emails the account's first contact with an address on file — no dedicated "payments
  // contact" concept exists yet, so this is the best available recipient.
  async sendReminder(id: string, caller: AuthUser) {
    const milestone = await this.findOne(id, caller);
    if (milestone.status === 'Received') {
      throw new BadRequestException(`Payment milestone '${id}' is already Received — no reminder needed.`);
    }
    const contact = await this.prisma.contact.findFirst({
      where: { accountId: milestone.accountId, orgId: milestone.orgId, isDeleted: false, email: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    if (!contact?.email) {
      throw new BadRequestException('No contact with an email address is on file for this account — add one before sending a reminder.');
    }
    const dueDate = milestone.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const sent = await this.mail.send(
      contact.email,
      `Payment reminder — ${milestone.milestone}`,
      `<p>Dear ${contact.name},</p><p>This is a reminder that a payment of ₹${milestone.amount.toLocaleString('en-IN')} for the "${milestone.milestone}" milestone was due on ${dueDate}.</p><p>Please arrange payment at your earliest convenience.</p>`,
    );
    return { ...milestone, reminderSent: sent, reminderSentTo: contact.email };
  }

  async getEscalationEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    const record = await this.findOne(id, caller);
    if (record.status === 'Overdue') {
      return [
        { id: `${record.id}-reminder`, at: record.dueDate.toISOString(), label: 'Reminder sent to customer' },
        { id: `${record.id}-overdue`, at: record.updatedAt.toISOString(), label: 'Overdue · Accounts + Sales owner notified' },
      ];
    }
    return [{ id: `${record.id}-scheduled`, at: record.dueDate.toISOString(), label: 'Reminder scheduled' }];
  }

  async getReceipts(id: string, query: { page: number; limit: number }, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    await this.findOne(id, caller);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ReceiptWhereInput = { paymentMilestoneId: id };
    const [total, data] = await Promise.all([
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { receivedOn: 'asc' } }),
    ]);
    return { data: await maskRestrictedFieldsMany(data, MODULE_KEY, caller, this.prisma), total, page, limit, pages: Math.ceil(total / limit) };
  }
}
