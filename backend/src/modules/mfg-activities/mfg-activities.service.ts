import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { CreateMfgActivityDto } from './dto/create-mfg-activity.dto';
import type { UpdateMfgActivityDto } from './dto/update-mfg-activity.dto';

const ENTITY_TYPE = 'MfgActivity';
const MODULE_KEY = 'activities';
const LIST_FILTERS = {
  moduleKey: 'activities',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'dueDate',
  facetFields: ['type', 'priority'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['subject', 'dueDate', 'priority', 'status', 'createdAt'];

const TRANSITIONS: Record<string, { to: string; when: string[]; requires?: 'outcome' }> = {
  Complete: { to: 'Completed', when: ['Open'], requires: 'outcome' },
  Cancel: { to: 'Cancelled', when: ['Open'] },
};

export interface MfgActivityListQuery extends ModuleListQuery {
  accountId?: string;
  opportunityId?: string;
  contactId?: string;
  mfgLeadId?: string;
}

@Injectable()
export class MfgActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.MfgActivityWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, 'activities')) };
  }

  private async baseWhere(query: MfgActivityListQuery, caller: AuthUser): Promise<Prisma.MfgActivityWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.mfgLeadId ? { mfgLeadId: query.mfgLeadId } : {}),
      ...(query.search ? { subject: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: MfgActivityListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.mfgActivity as unknown as FacetDelegate, (await this.baseWhere(query, caller)), caller, LIST_FILTERS);
  }

  async findAll(query: MfgActivityListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');

    const where: Prisma.MfgActivityWhereInput = {
      ...((await this.baseWhere(query, caller))),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };

    const [total, rows] = await Promise.all([
      this.prisma.mfgActivity.count({ where }),
      this.prisma.mfgActivity.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [field]: direction },
      }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.mfgActivity.findFirst({
      where: { id, ...(await this.scopeFilter(caller)), isDeleted: false },
    });
    if (!record) throw new NotFoundException(`Activity '${id}' not found.`);
    return this.withSlaState(record);
  }

  private async assertFksInOrg(
    dto: { accountId?: string; opportunityId?: string; contactId?: string; mfgLeadId?: string },
    caller: AuthUser,
  ): Promise<{ opportunityAccountId?: string; contactAccountId?: string }> {
    const orgId = caller.orgId ?? '';
    const found: { opportunityAccountId?: string; contactAccountId?: string } = {};
    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, orgId } });
      if (!account) throw new BadRequestException(`Account '${dto.accountId}' not found in your organization.`);
    }
    if (dto.opportunityId) {
      const opportunity = await this.prisma.opportunity.findFirst({ where: { id: dto.opportunityId, orgId } });
      if (!opportunity) throw new BadRequestException(`Opportunity '${dto.opportunityId}' not found in your organization.`);
      found.opportunityAccountId = opportunity.accountId;
    }
    if (dto.contactId) {
      const contact = await this.prisma.contact.findFirst({ where: { id: dto.contactId, orgId } });
      if (!contact) throw new BadRequestException(`Contact '${dto.contactId}' not found in your organization.`);
      found.contactAccountId = contact.accountId;
    }
    if (dto.mfgLeadId) {
      const mfgLead = await this.prisma.mfgLead.findFirst({ where: { id: dto.mfgLeadId, orgId } });
      if (!mfgLead) throw new BadRequestException(`Lead '${dto.mfgLeadId}' not found in your organization.`);
    }
    // ownerId org-membership check deferred — see final review Important finding I3
    return found;
  }

  async create(dto: CreateMfgActivityDto, caller: AuthUser) {
    if (dto.dueDate && new Date(dto.dueDate).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('Scheduled date cannot be in the past.');
    }
    const linked = await this.assertFksInOrg(dto, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, 'activities')) ? (dto.ownerId ?? caller.id) : caller.id;
    // An activity on an opportunity or contact belongs to that customer too, so it shows on the
    // account's Activities tab (the unified timeline) without picking the account again.
    const accountId = dto.accountId ?? linked.opportunityAccountId ?? linked.contactAccountId;
    return this.prisma.mfgActivity.create({
      data: {
        ...dto,
        ...(accountId ? { accountId } : {}),
        ownerId,
        orgId: requireOrgId(caller),
        status: 'Open',
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
      },
    });
  }

  async update(id: string, dto: UpdateMfgActivityDto, caller: AuthUser) {
    await this.findOne(id, caller);
    await this.assertFksInOrg(dto, caller);
    return this.prisma.mfgActivity.update({
      where: { id },
      data: { ...dto, ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.mfgActivity.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for activities.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} an activity in status '${record.status}'.`);
    }
    if (transition.requires && !String(payload?.[transition.requires] ?? '').trim()) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.MfgActivityUpdateInput = { status: transition.to };
    if (transition.requires) data.outcome = String(payload![transition.requires]).trim();
    const updated = await this.prisma.mfgActivity.update({ where: { id }, data });
    if (action === 'Complete') {
      // SLA-06 'Follow-up completion' stops on the activity itself.
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Activity completed');
      // SLA-05 'Next action overdue' (opps) also stops here when this activity belongs to an
      // opportunity — that policy's timer lives on the OPPORTUNITY entity, not this activity.
      if (record.opportunityId) {
        await this.slaEngine.stopTimer(updated.orgId, 'opps', 'Opportunity', record.opportunityId, 'Activity completed');
      }
    }
    return updated;
  }
}
