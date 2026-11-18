import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { CreateApprovalDto } from './dto/create-approval.dto';
import type { UpdateApprovalDto } from './dto/update-approval.dto';

const ENTITY_TYPE = 'Approval';
const MODULE_KEY = 'approvals';
const LIST_FILTERS = {
  moduleKey: 'approvals',
  entityType: ENTITY_TYPE,
  ownerField: 'requestedById',
  dateField: 'requestedAt',
  facetFields: ['entityType', 'type', 'currentApprover'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['title', 'status', 'requestedAt', 'createdAt'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  Approve: { to: 'Approved', when: ['Pending', 'Requested'] },
  'Return for revision': { to: 'Returned for revision', when: ['Pending', 'Requested'], requires: 'comments' },
  Reject: { to: 'Rejected', when: ['Pending', 'Requested'], requires: 'comments' },
};

export interface ApprovalListQuery extends ModuleListQuery {
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  // Approval carries no ownerId — org scoping only, same as Products/Contacts.
  private scopeFilter(caller: AuthUser): Prisma.ApprovalWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  private async baseWhere(query: ApprovalListQuery, caller: AuthUser): Promise<Prisma.ApprovalWhereInput> {
    return {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: ApprovalListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.approval as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: ApprovalListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.ApprovalWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.approval.count({ where }),
      this.prisma.approval.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.approval.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Approval '${id}' not found.`);
    return this.withSlaState(record);
  }

  async create(dto: CreateApprovalDto, caller: AuthUser) {
    const approval = await this.prisma.approval.create({
      data: { ...dto, requestedById: caller.id, orgId: requireOrgId(caller), status: 'Requested' },
    });
    // SLA-14 'Approval turnaround': the target bracket is picked by the routed approver's level.
    await this.slaEngine.startTimer(approval.orgId, MODULE_KEY, ENTITY_TYPE, approval.id, 'Approval requested', approval.currentApprover ?? undefined);
    return approval;
  }

  async update(id: string, dto: UpdateApprovalDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.approval.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.approval.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for approvals.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} an approval in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.ApprovalUpdateInput = { status: transition.to };
    if (payload?.comments) data.approverComments = payload.comments as string;
    const updated = await this.prisma.approval.update({ where: { id }, data });
    // SLA-14 'Approval turnaround' stops on any terminal decision: approved, rejected, or
    // returned for revision.
    await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Approved / rejected / returned');
    await this.applyDecisionToEntity(updated, action);
    return updated;
  }

  // The approval an auto-created request points at (a quotation or a costing sheet) sits in
  // 'Approval pending' until someone decides; carry the decision through so both stay in step.
  private async applyDecisionToEntity(approval: { orgId: string; entityType: string | null; entityId: string | null }, action: string) {
    const { orgId, entityType, entityId } = approval;
    if (!entityId) return;
    const approved = action === 'Approve';
    if (entityType === 'Quotation') {
      const { count } = await this.prisma.quotation.updateMany({
        where: { id: entityId, orgId, status: 'Approval pending' },
        data: { status: approved ? 'Approved' : 'Draft' },
      });
      // SLA-11 'Quotation issue' starts once the quotation is approved, same as approving it directly.
      if (approved && count > 0) await this.slaEngine.startTimer(orgId, 'quotes', 'Quotation', entityId, 'Costing approved');
    } else if (entityType === 'Costing') {
      await this.prisma.costingSheet.updateMany({
        where: { id: entityId, orgId, status: 'Approval pending' },
        data: { status: approved ? 'Approved' : action === 'Reject' ? 'Rejected' : 'Draft' },
      });
    }
  }

  async getChainEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    const record = await this.findOne(id, caller);
    const events: ModuleEventItem[] = [
      { id: `${record.id}-requested`, at: record.requestedAt.toISOString(), label: 'Requested' },
    ];
    if (record.status !== 'Requested' && record.status !== 'Pending') {
      events.push({ id: `${record.id}-${record.status}`, at: record.updatedAt.toISOString(), label: record.status });
    }
    return events;
  }
}
