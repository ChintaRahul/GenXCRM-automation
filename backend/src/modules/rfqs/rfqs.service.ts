import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateRfqDto } from './dto/create-rfq.dto';
import type { UpdateRfqDto } from './dto/update-rfq.dto';

const ENTITY_TYPE = 'Rfq';
const MODULE_KEY = 'rfqs';
const LIST_FILTERS = {
  moduleKey: 'rfqs',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'receivedOn',
  facetFields: ['product', 'environment', 'protocol'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['custNo', 'status', 'receivedOn', 'createdAt'];

export interface RfqListQuery extends ModuleListQuery {
  opportunityId?: string;
  accountId?: string;
}

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  'Request clarification': { to: 'Clarification required', when: ['Received', 'Technically feasible'], requires: 'clarification' },
  'Mark feasible': { to: 'Technically feasible', when: ['Received', 'Clarification required'] },
  'Approve for costing': { to: 'Approved for costing', when: ['Technically feasible'] },
  'Not feasible': { to: 'Not feasible', when: ['Received', 'Clarification required'], requires: 'nf' },
};

@Injectable()
export class RfqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.RfqWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, 'rfqs')) };
  }

  private async baseWhere(query: RfqListQuery, caller: AuthUser): Promise<Prisma.RfqWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search ? { custNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: RfqListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.rfq as unknown as FacetDelegate, (await this.baseWhere(query, caller)), caller, LIST_FILTERS);
  }

  async findAll(query: RfqListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.RfqWhereInput = {
      ...((await this.baseWhere(query, caller))),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.rfq.count({ where }),
      this.prisma.rfq.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.rfq.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`RFQ '${id}' not found.`);
    return this.withSlaState(record);
  }

  private async assertOpportunityInOrg(opportunityId: string, caller: AuthUser): Promise<void> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, orgId: caller.orgId ?? '' } });
    if (!opportunity) throw new BadRequestException(`Opportunity '${opportunityId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  async create(dto: CreateRfqDto, caller: AuthUser) {
    await this.assertOpportunityInOrg(dto.opportunityId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, 'rfqs')) ? (dto.ownerId ?? caller.id) : caller.id;
    const rfq = await this.prisma.rfq.create({
      data: { ...dto, ownerId, receivedOn: new Date(dto.receivedOn), orgId: requireOrgId(caller), status: 'Received', revision: 1 },
    });
    // SLA-07 'Technical feasibility response': starts the moment an RFQ is received.
    await this.slaEngine.startTimer(rfq.orgId, MODULE_KEY, ENTITY_TYPE, rfq.id, 'RFQ received');
    return rfq;
  }

  async update(id: string, dto: UpdateRfqDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    return this.prisma.rfq.update({
      where: { id },
      data: { ...dto, ...(dto.receivedOn ? { receivedOn: new Date(dto.receivedOn) } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.rfq.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (action === 'New revision') return this.createRevision(id, payload, caller);
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for RFQs.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} an RFQ in status '${record.status}'.`);
    }
    const note = String(payload?.[transition.requires ?? ''] ?? '').trim();
    if (transition.requires && !note) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.RfqUpdateInput = { status: transition.to };
    if (action === 'Request clarification') data.clarificationNote = note;
    if (action === 'Not feasible') data.notFeasibleReason = note;
    const updated = await this.prisma.rfq.update({ where: { id }, data });
    await this.notifySalesOwner(updated, record.status, action, note);
    if (['Mark feasible', 'Not feasible', 'Request clarification'].includes(action)) {
      // SLA-07 'Technical feasibility response' stops once a feasibility decision (or a
      // clarification request) has been logged.
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Feasible / Not feasible / Clarification');
    }
    return updated;
  }

  // The sales owner of the opportunity hears when engineering asks the customer a question, and
  // when that question has been answered and the RFQ is feasible again.
  private async notifySalesOwner(rfq: { id: string; orgId: string; custNo: string; opportunityId: string }, fromStatus: string, action: string, note: string): Promise<void> {
    const asked = action === 'Request clarification';
    const answered = action === 'Mark feasible' && fromStatus === 'Clarification required';
    if (!asked && !answered) return;
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: rfq.opportunityId, orgId: rfq.orgId }, select: { ownerId: true } });
    if (!opportunity?.ownerId) return;
    await this.notifications.create(
      rfq.orgId,
      opportunity.ownerId,
      asked ? 'RFQ needs clarification' : 'RFQ clarification completed',
      asked ? `Engineering asked about RFQ ${rfq.custNo}: ${note}` : `RFQ ${rfq.custNo} is technically feasible again after clarification.`,
      `/rfqs/${rfq.id}`,
    );
  }

  // Updated requirements arrived from the customer: bump the revision counter, log it, and
  // send the RFQ back through feasibility review from the top — SLA-07 restarts accordingly.
  async createRevision(id: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const rfq = await this.findOne(id, caller);
    const nextRevision = (rfq.revision ?? 0) + 1;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.rfqRevision.create({
        data: { rfqId: id, revisionNumber: nextRevision, note: (payload?.note as string) ?? null, createdById: caller.id },
      }),
      this.prisma.rfq.update({ where: { id }, data: { revision: nextRevision, status: 'Received' } }),
    ]);
    await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Feasible / Not feasible / Clarification');
    await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'RFQ received');
    return updated;
  }

  async getRevisionEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    await this.findOne(id, caller);
    const rows = await this.prisma.rfqRevision.findMany({
      where: { rfqId: id },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      label: `Revision ${row.revisionNumber}`,
      description: row.note ?? undefined,
      actor: row.createdBy?.name,
    }));
  }
}
