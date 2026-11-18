import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { CreateEvaluationDto } from './dto/create-evaluation.dto';
import type { UpdateEvaluationDto } from './dto/update-evaluation.dto';

const ENTITY_TYPE = 'Evaluation';
const MODULE_KEY = 'demos';
const LIST_FILTERS = {
  moduleKey: 'demos',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'plannedDate',
  facetFields: ['type'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['title', 'status', 'plannedDate', 'createdAt'];

export interface EvaluationListQuery extends ModuleListQuery {
  opportunityId?: string;
  accountId?: string;
}

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  Schedule: { to: 'Scheduled', when: ['Requested'] },
  Start: { to: 'In progress', when: ['Scheduled'] },
  'Mark successful': { to: 'Successful', when: ['In progress', 'Completed'] },
  'Mark failed': { to: 'Failed', when: ['In progress', 'Completed'], requires: 'result' },
  'Customer approved': { to: 'Customer approved', when: ['Successful'] },
  'Customer rejected': { to: 'Customer rejected', when: ['Successful', 'Completed'] },
};

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private scopeFilter(caller: AuthUser): Prisma.EvaluationWhereInput {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    if (caller.role === Role.SALES_REP) return { ...orgFilter, ownerId: caller.id };
    return orgFilter;
  }

  private async baseWhere(query: EvaluationListQuery, caller: AuthUser): Promise<Prisma.EvaluationWhereInput> {
    return {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: EvaluationListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.evaluation as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: EvaluationListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.EvaluationWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.evaluation.count({ where }),
      this.prisma.evaluation.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.evaluation.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Evaluation '${id}' not found.`);
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

  async create(dto: CreateEvaluationDto, caller: AuthUser) {
    await this.assertOpportunityInOrg(dto.opportunityId, caller);
    await this.assertAccountInOrg(dto.accountId, caller);
    const ownerId = caller.role === Role.SALES_REP ? caller.id : (dto.ownerId ?? caller.id);
    return this.prisma.evaluation.create({
      data: { ...dto, ownerId, plannedDate: new Date(dto.plannedDate), orgId: requireOrgId(caller), status: 'Requested' },
    });
  }

  async update(id: string, dto: UpdateEvaluationDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    return this.prisma.evaluation.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.plannedDate ? { plannedDate: new Date(dto.plannedDate) } : {}),
        ...(dto.actualDate ? { actualDate: new Date(dto.actualDate) } : {}),
        ...(dto.sampleDispatched ? { sampleDispatched: new Date(dto.sampleDispatched) } : {}),
        ...(dto.sampleDelivered ? { sampleDelivered: new Date(dto.sampleDelivered) } : {}),
        ...(dto.sampleTested ? { sampleTested: new Date(dto.sampleTested) } : {}),
      },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.evaluation.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for evaluations.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} an evaluation in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.EvaluationUpdateInput = { status: transition.to };
    if (action === 'Mark failed') data.result = payload!.result as string;
    const updated = await this.prisma.evaluation.update({ where: { id }, data });
    if (action === 'Start') {
      // SLA-09 'Evaluation result': starts once the demo/trial/sample execution begins, with the
      // target picked by evaluation type (Demo vs. Trial/Sample).
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Trial started', record.type);
    } else if (['Mark successful', 'Mark failed'].includes(action)) {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Result recorded');
    }
    if (action === 'Mark successful') await this.promptSolutionProposal(updated);
    return updated;
  }

  // A successful trial is the cue to propose a solution: put the next step in the owner's task list.
  private async promptSolutionProposal(evaluation: { orgId: string; opportunityId: string; accountId: string; ownerId: string | null }): Promise<void> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: evaluation.opportunityId, orgId: evaluation.orgId }, select: { stage: true } });
    if (opportunity?.stage !== 'Demo / trial') return;
    await this.prisma.mfgActivity.create({
      data: {
        orgId: evaluation.orgId,
        type: 'Meeting',
        subject: "Trial successful — move the opportunity to 'Solution proposed'",
        opportunityId: evaluation.opportunityId,
        accountId: evaluation.accountId,
        ownerId: evaluation.ownerId,
        priority: 'High',
        status: 'Open',
        dueDate: new Date(),
      },
    });
  }
}
