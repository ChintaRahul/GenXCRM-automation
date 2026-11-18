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
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import type { CreateOpportunityDto } from './dto/create-opportunity.dto';
import type { UpdateOpportunityDto } from './dto/update-opportunity.dto';

const ENTITY_TYPE = 'Opportunity';
const MODULE_KEY = 'opps';
const LIST_FILTERS = {
  moduleKey: 'opps',
  entityType: ENTITY_TYPE,
  statusField: 'stage',
  ownerField: 'ownerId',
  dateField: 'closeDate',
  valueField: 'value',
  facetFields: ['product', 'currency', 'competitor', 'source'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['title', 'stage', 'value', 'closeDate', 'createdAt'];

// Lost reasons that mean "not now" rather than "never".
const POSTPONED_REASONS = ['Budget', 'Internal approval', 'No response'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: 'lost' }> = {
  'Mark won': { to: 'Won', when: ['PO received', 'PO expected', 'Negotiation'] },
  'Mark lost': { to: 'Lost', when: ['Qualified', 'Requirement collected', 'Technical discussion', 'Site visit', 'Demo / trial', 'Solution proposed', 'Costing', 'Quotation sent', 'Negotiation', 'Approval pending', 'PO expected', 'PO received'], requires: 'lost' },
};
const SPECIAL_ACTIONS = new Set(['Advance stage', 'Log activity']);

// Win probability follows the stage (the 'stages' master): shown on the record, never stored.
const STAGE_PROBABILITY: Record<string, number> = {
  Qualified: 10,
  'Requirement collected': 15,
  'Technical discussion': 20,
  'Site visit': 25,
  'Demo / trial': 30,
  'Solution proposed': 40,
  Costing: 45,
  'Quotation sent': 50,
  Negotiation: 60,
  'Approval pending': 65,
  'PO expected': 80,
  'PO received': 95,
  Won: 100,
  Lost: 0,
};
const LOST_REASONS = ['Price', 'Competitor', 'Technical mismatch', 'Delivery time', 'Budget', 'Project cancelled', 'No response', 'Existing vendor', 'Payment terms', 'Internal approval', 'Other'];

export interface OpportunityListQuery extends ModuleListQuery {
  accountId?: string;
}

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly nurturing: MfgNurturingService,
    private readonly automation: AutomationEngineService,
  ) {}

  // SLA-03 'Stage stagnation' / SLA-04 'High-value deal attention' both start on 'Stage entered'
  // and stop on 'Stage changed'; the new stage name is passed as context so pickTarget can match
  // a per-stage target bracket, and `value` drives SLA-04's "Value ≥ ₹1 Cr" target.
  private async onStageChanged(orgId: string, id: string, fromStage: string, toStage: string, value: number): Promise<void> {
    await this.slaEngine.stopTimer(orgId, MODULE_KEY, ENTITY_TYPE, id, 'Stage changed');
    await this.slaEngine.startTimer(orgId, MODULE_KEY, ENTITY_TYPE, id, 'Stage entered', toStage, value);
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.OpportunityWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  private async baseWhere(query: OpportunityListQuery, caller: AuthUser): Promise<Prisma.OpportunityWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { id: { contains: query.search.trim(), mode: 'insensitive' } }] } : {}),
    };
  }

  async getFacets(query: OpportunityListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.opportunity as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: OpportunityListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');

    const where: Prisma.OpportunityWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };

    const [total, data] = await Promise.all([
      this.prisma.opportunity.count({ where }),
      this.prisma.opportunity.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);

    const withAge = await Promise.all(
      data.map(async (record) => ({
        ...record,
        age: this.computeAge(record.createdAt),
        prob: STAGE_PROBABILITY[record.stage],
        sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id),
      })),
    );
    return { data: withAge, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.opportunity.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Opportunity '${id}' not found.`);
    const latestStageChange = await this.prisma.opportunityStageHistory.findFirst({
      where: { opportunityId: id },
      orderBy: { changedAt: 'desc' },
    });
    return {
      ...record,
      age: this.computeAge(record.createdAt),
      prob: STAGE_PROBABILITY[record.stage],
      daysInStage: this.computeAge(latestStageChange?.changedAt ?? record.createdAt),
      sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id),
    };
  }

  private computeAge(since: Date): number {
    return Math.floor((Date.now() - since.getTime()) / 86400000);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  private async assertContactInOrg(contactId: string, caller: AuthUser): Promise<void> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: caller.orgId ?? '' } });
    if (!contact) throw new BadRequestException(`Contact '${contactId}' not found in your organization.`);
    if (contact.status === 'Inactive') throw new BadRequestException(`Contact '${contact.name}' is inactive and can't be used on a new opportunity.`);
  }

  async create(dto: CreateOpportunityDto, caller: AuthUser) {
    await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.contactId) await this.assertContactInOrg(dto.contactId, caller);
    // ownerId/technicalOwnerId org-membership checks deferred — see final review Important finding I3
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    const created = await this.prisma.opportunity.create({
      data: {
        ...dto,
        ownerId,
        currency: dto.currency ?? 'INR',
        orgId: requireOrgId(caller),
        closeDate: new Date(dto.closeDate),
        nextActionDate: new Date(dto.nextActionDate),
        // The history tab starts with "Created at <stage>".
        stageHistory: { create: { fromStage: null, toStage: dto.stage, changedById: caller.id } },
      },
    });
    // The stagnation timers (SLA-03/04) start the moment the deal enters its first stage.
    await this.slaEngine.startTimer(created.orgId, MODULE_KEY, ENTITY_TYPE, created.id, 'Stage entered', created.stage, created.value);
    return created;
  }

  async update(id: string, dto: UpdateOpportunityDto, caller: AuthUser) {
    const existing = await this.findOne(id, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.contactId) await this.assertContactInOrg(dto.contactId, caller);
    if (dto.stage && ['Won', 'Lost'].includes(dto.stage)) {
      throw new BadRequestException(`Use the 'Mark won'/'Mark lost' actions (via performAction) to move an opportunity to '${dto.stage}'.`);
    }
    if (dto.stage && dto.stage !== existing.stage && ['Won', 'Lost'].includes(existing.stage)) {
      throw new BadRequestException(`A ${existing.stage} opportunity can't be moved to another stage.`);
    }
    if (dto.stage && (!dto.nextAction || !dto.nextActionDate)) {
      throw new BadRequestException(`'nextAction' and 'nextActionDate' are required when updating an active opportunity's stage.`);
    }
    if (dto.stage && dto.nextActionDate && new Date(dto.nextActionDate).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`'nextActionDate' can't be in the past.`);
    }
    const data: Prisma.OpportunityUpdateInput = {
      ...dto,
      ...(dto.closeDate ? { closeDate: new Date(dto.closeDate) } : {}),
      ...(dto.nextActionDate ? { nextActionDate: new Date(dto.nextActionDate) } : {}),
    };
    if (dto.stage && dto.stage !== existing.stage) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.opportunityStageHistory.create({
          data: { opportunityId: id, fromStage: existing.stage, toStage: dto.stage, changedById: caller.id },
        }),
        this.prisma.opportunity.update({ where: { id }, data }),
      ]);
      await this.onStageChanged(updated.orgId, id, existing.stage, dto.stage, updated.value);
      return updated;
    }
    return this.prisma.opportunity.update({ where: { id }, data });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.opportunity.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (SPECIAL_ACTIONS.has(action)) throw new NotImplementedException(`'${action}' is not yet implemented.`);
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for opportunities.`);
    if (!transition.when.includes(record.stage)) {
      throw new BadRequestException(`Cannot ${action} an opportunity in stage '${record.stage}'.`);
    }
    const lostReason = String(payload?.lost ?? '').trim();
    if (transition.requires && !lostReason) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    if (transition.requires === 'lost' && !LOST_REASONS.includes(lostReason)) {
      throw new BadRequestException(`'${lostReason}' is not a valid lost reason.`);
    }
    const data: Prisma.OpportunityUpdateInput = { stage: transition.to };
    if (transition.requires === 'lost') {
      data.lostReason = lostReason;
      Object.assign(data, this.lostDetails(payload));
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.opportunity.update({ where: { id }, data }),
      this.prisma.opportunityStageHistory.create({
        data: { opportunityId: id, fromStage: record.stage, toStage: transition.to, changedById: caller.id },
      }),
    ]);
    await this.onStageChanged(updated.orgId, id, record.stage, transition.to, updated.value);
    if (transition.requires === 'lost' && POSTPONED_REASONS.includes(lostReason)) {
      await this.scheduleReactivation(updated, lostReason);
      await this.nurturing.enroll(updated.orgId, 'opportunity_lost', ENTITY_TYPE, id);
    }
    if (transition.requires === 'lost') {
      await this.automation.fire(updated.orgId, 'Opportunity lost', { link: `/opportunities/${id}`, title: `${updated.title} was lost (${lostReason})`, ownerId: updated.ownerId, accountId: updated.accountId, opportunityId: id, value: updated.value });
    }
    return updated;
  }

  // Optional competitor details given with "Mark lost": product, price, decision date, customer feedback.
  private lostDetails(payload: Record<string, unknown> | undefined): Prisma.OpportunityUpdateInput {
    const text = (key: string): string | undefined => String(payload?.[key] ?? '').trim() || undefined;
    const price = text('competitorPrice');
    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
      throw new BadRequestException('Competitor price must be a positive number.');
    }
    const decision = text('decisionDate');
    if (decision !== undefined && Number.isNaN(new Date(decision).getTime())) {
      throw new BadRequestException('Decision date is not a valid date.');
    }
    return {
      ...(text('competitorProduct') ? { competitorProduct: text('competitorProduct') } : {}),
      ...(price !== undefined ? { competitorPrice: Number(price) } : {}),
      ...(decision !== undefined ? { decisionDate: new Date(decision) } : {}),
      ...(text('lostFeedback') ? { lostFeedback: text('lostFeedback') } : {}),
    };
  }

  // A deal lost to timing rather than to a competitor gets a re-engagement call 90 days out.
  private async scheduleReactivation(opportunity: { orgId: string; id: string; accountId: string; contactId: string | null; ownerId: string | null; title: string }, reason: string): Promise<void> {
    await this.prisma.mfgActivity.create({
      data: {
        orgId: opportunity.orgId,
        type: 'Call',
        subject: `Re-engage: ${opportunity.title} (lost — ${reason})`,
        opportunityId: opportunity.id,
        accountId: opportunity.accountId,
        contactId: opportunity.contactId,
        ownerId: opportunity.ownerId,
        priority: 'Medium',
        status: 'Open',
        dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // Everything that happened on the deal in one chronological list: tasks and calls, visits, trials, quotations and POs.
  async getTimelineEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    const { orgId } = await this.findOne(id, caller);
    const where = { orgId, opportunityId: id, isDeleted: false };
    const [activities, visits, evaluations, quotations, purchaseOrders] = await Promise.all([
      this.prisma.mfgActivity.findMany({ where, include: { owner: { select: { name: true } } } }),
      this.prisma.siteVisit.findMany({ where }),
      this.prisma.evaluation.findMany({ where }),
      this.prisma.quotation.findMany({ where }),
      this.prisma.purchaseOrder.findMany({ where }),
    ]);
    const events: ModuleEventItem[] = [
      ...activities.map((a) => ({ id: `act-${a.id}`, at: (a.dueDate ?? a.createdAt).toISOString(), label: `${a.type}: ${a.subject}`, description: [a.status, a.outcome].filter(Boolean).join(' · '), actor: a.owner?.name })),
      ...visits.map((v) => ({ id: `visit-${v.id}`, at: v.visitDate.toISOString(), label: `Site visit: ${v.title}`, description: v.status })),
      ...evaluations.map((e) => ({ id: `eval-${e.id}`, at: e.plannedDate.toISOString(), label: `${e.type}: ${e.title}`, description: e.status })),
      ...quotations.map((q) => ({ id: `quote-${q.id}`, at: q.quotationDate.toISOString(), label: `Quotation v${q.version}`, description: q.status })),
      ...purchaseOrders.map((p) => ({ id: `po-${p.id}`, at: p.poDate.toISOString(), label: `Purchase order ${p.poNo}`, description: p.status })),
    ];
    return [...events].sort((a, b) => b.at.localeCompare(a.at));
  }

  async getHistoryEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    await this.findOne(id, caller);
    const rows = await this.prisma.opportunityStageHistory.findMany({
      where: { opportunityId: id },
      orderBy: { changedAt: 'asc' },
      include: { changedBy: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      at: row.changedAt.toISOString(),
      label: row.fromStage ? `${row.fromStage} → ${row.toStage}` : `Created at ${row.toStage}`,
      actor: row.changedBy?.name,
    }));
  }
}
