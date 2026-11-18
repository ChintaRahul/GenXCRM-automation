import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { isModuleFullyRestricted } from '../../modules-framework/utils/field-permission.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { CreateCostingSheetDto } from './dto/create-costing-sheet.dto';
import type { UpdateCostingSheetDto } from './dto/update-costing-sheet.dto';

const ENTITY_TYPE = 'CostingSheet';
const MODULE_KEY = 'costing';
const RESTRICTED_FIELD_LABEL = 'Costing & margin';
const LIST_FILTERS = {
  moduleKey: 'costing',
  ownerField: 'ownerId',
  facetFields: [],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['status', 'sellingPrice', 'createdAt'];

const COST_COMPONENTS: readonly [string, string][] = [
  ['material', 'Material'],
  ['boughtOut', 'Bought-out items'],
  ['fabrication', 'Fabrication'],
  ['electrical', 'Electrical'],
  ['software', 'Software'],
  ['labor', 'Labour'],
  ['installation', 'Installation'],
  ['freight', 'Freight'],
  ['packing', 'Packing'],
  ['travel', 'Travel'],
  ['overhead', 'Overhead'],
  ['contingency', 'Contingency'],
  ['other', 'Other'],
];

export interface CostingSheetListQuery extends ModuleListQuery {
  opportunityId?: string;
  accountId?: string;
}

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  Approve: { to: 'Approved', when: ['Approval pending', 'Submitted'] },
  Reject: { to: 'Rejected', when: ['Approval pending', 'Submitted'], requires: 'rej' },
};

@Injectable()
export class CostingSheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  // Total cost, gross margin and margin % are always shown (not only after Submit), so the margin a sheet will route on is visible while it is being filled in.
  private withMargin<T extends object>(row: T): T & { total: number; gm: number; gmPct: number } {
    return { ...row, ...this.computeTotals(row as Record<string, unknown>) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.CostingSheetWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  private async assertNotRestricted(caller: AuthUser): Promise<void> {
    if (await isModuleFullyRestricted(this.prisma, caller, MODULE_KEY, RESTRICTED_FIELD_LABEL)) {
      throw new ForbiddenException('Costing is restricted.');
    }
  }

  private async baseWhere(query: CostingSheetListQuery, caller: AuthUser): Promise<Prisma.CostingSheetWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.search ? { opportunityId: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };
  }

  async getFacets(query: CostingSheetListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.costingSheet as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: CostingSheetListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    await this.assertNotRestricted(caller);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.CostingSheetWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.costingSheet.count({ where }),
      this.prisma.costingSheet.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(this.withMargin(row))));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    await this.assertNotRestricted(caller);
    const record = await this.prisma.costingSheet.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Costing sheet '${id}' not found.`);
    return this.withSlaState(this.withMargin(record));
  }

  private async assertOpportunityInOrg(opportunityId: string, caller: AuthUser): Promise<void> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, orgId: caller.orgId ?? '' } });
    if (!opportunity) throw new BadRequestException(`Opportunity '${opportunityId}' not found in your organization.`);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  // Costing waits for engineering: when the opportunity has RFQs, at least one must be Approved for
  // costing. A deal with no RFQ at all (no technical review needed) is not held up.
  private async assertRfqApproved(opportunityId: string, caller: AuthUser): Promise<void> {
    const rfqs = await this.prisma.rfq.findMany({
      where: { opportunityId, orgId: caller.orgId ?? '', isDeleted: false },
      select: { status: true },
    });
    if (rfqs.length > 0 && !rfqs.some((r) => r.status === 'Approved for costing')) {
      throw new BadRequestException(`Costing can start once the RFQ for this opportunity is Approved for costing (it is currently '${rfqs[0].status}').`);
    }
  }

  async create(dto: CreateCostingSheetDto, caller: AuthUser) {
    await this.assertOpportunityInOrg(dto.opportunityId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    await this.assertRfqApproved(dto.opportunityId, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    const sheet = await this.prisma.costingSheet.create({
      data: { ...dto, ownerId, orgId: requireOrgId(caller), status: 'Draft' },
    });
    // SLA-10 'Costing preparation': the RFQ-level 'Approved for costing' event is what the policy
    // names, but a costing sheet doesn't exist until this create() call, so this is the earliest
    // point the timer can actually track. `sellingPrice` drives its "Value ≥ ₹1 Cr" target.
    await this.slaEngine.startTimer(sheet.orgId, MODULE_KEY, ENTITY_TYPE, sheet.id, 'Approved for costing', undefined, sheet.sellingPrice);
    return sheet;
  }

  async update(id: string, dto: UpdateCostingSheetDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    return this.prisma.costingSheet.update({
      where: { id },
      data: dto,
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.costingSheet.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (action === 'Submit') return this.submit(id, caller);
    if (action === 'New revision') return this.createRevision(id, caller);
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for costing sheets.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a costing sheet in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.CostingSheetUncheckedUpdateInput = { status: transition.to };
    if (action === 'Approve') data.approvedById = caller.id;
    return this.prisma.costingSheet.update({ where: { id }, data });
  }

  // Costing has no separate revision-history table (unlike RFQs/quotes) -- the sheet itself is
  // reopened for editing, with the revision counter bumped to mark that it's been redone.
  async createRevision(id: string, caller: AuthUser) {
    const sheet = await this.findOne(id, caller);
    if (sheet.status === 'Draft') {
      throw new BadRequestException(`Costing sheet '${id}' is already in Draft.`);
    }
    const updated = await this.prisma.costingSheet.update({
      where: { id },
      data: { revision: (sheet.revision ?? 0) + 1, status: 'Draft' },
    });
    await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Costing submitted');
    await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Approved for costing', undefined, updated.sellingPrice);
    return updated;
  }

  async getBreakdownTable(id: string, caller: AuthUser): Promise<ModuleTableResult> {
    const record = await this.findOne(id, caller);
    return {
      columns: [
        { key: 'component', label: 'Component', type: 'text' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows: COST_COMPONENTS.map(([key, label]) => ({
        component: label,
        value: (record as Record<string, unknown>)[key] ?? 0,
      })),
    };
  }

  private computeTotals(record: Record<string, unknown>): { total: number; gm: number; gmPct: number } {
    const total = COST_COMPONENTS.reduce((sum, [key]) => sum + ((record[key] as number | undefined) ?? 0), 0);
    const sellingPrice = record.sellingPrice as number;
    const gm = sellingPrice - total;
    const gmPct = sellingPrice ? (gm / sellingPrice) * 100 : 0;
    return { total, gm, gmPct };
  }

  private async findMatchingApprovalRule(type: string, value: number, caller: AuthUser) {
    const rules = await this.prisma.approvalRule.findMany({
      where: { orgId: caller.orgId ?? '', type, isActive: true, isDeleted: false },
      orderBy: { min: 'asc' },
    });
    if (!rules.length) return null;
    const inRange = rules.find((r) => value >= r.min && value < r.max);
    if (inRange) return inRange;
    if (value < rules[0].min) return rules[0];
    if (value >= rules[rules.length - 1].max) return rules[rules.length - 1];
    return null;
  }

  async submit(id: string, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (!['Draft', 'Rejected'].includes(record.status)) {
      throw new BadRequestException(`Cannot submit a costing sheet in status '${record.status}'.`);
    }
    // SLA-10 'Costing preparation' stops the moment the sheet is submitted for approval.
    await this.slaEngine.stopTimer(record.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Costing submitted');
    const { total, gm, gmPct } = this.computeTotals(record);
    const rule = await this.findMatchingApprovalRule('Margin', gmPct, caller);
    if (rule) {
      const approval = await this.prisma.approval.create({
        data: {
          orgId: requireOrgId(caller),
          title: `Costing approval — CS-${record.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          entityType: 'Costing',
          entityId: record.id,
          type: 'Margin',
          requestedById: caller.id,
          currentApprover: rule.approverRole,
          matchedRule: rule.id,
          reason: `GM% ${gmPct.toFixed(2)} matched approval rule AR-${rule.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          status: 'Requested',
        },
      });
      // SLA-14 'Approval turnaround': starts for this auto-created approval too, not just ones
      // created directly through the Approvals module.
      await this.slaEngine.startTimer(approval.orgId, 'approvals', 'Approval', approval.id, 'Approval requested', approval.currentApprover ?? undefined);
      const updated = await this.prisma.costingSheet.update({ where: { id }, data: { status: 'Approval pending' } });
      return { ...updated, total, gm, gmPct };
    }
    const updated = await this.prisma.costingSheet.update({ where: { id }, data: { status: 'Approved' } });
    return { ...updated, total, gm, gmPct };
  }
}
