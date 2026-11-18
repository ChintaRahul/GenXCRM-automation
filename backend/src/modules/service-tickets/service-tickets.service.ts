import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import type { CreateServiceTicketDto } from './dto/create-service-ticket.dto';
import type { UpdateServiceTicketDto } from './dto/update-service-ticket.dto';

const ENTITY_TYPE = 'ServiceTicket';
const MODULE_KEY = 'service';
const LIST_FILTERS = {
  moduleKey: 'service',
  entityType: ENTITY_TYPE,
  ownerField: 'engineerId',
  facetFields: ['complaintType', 'priority', 'coverage', 'customerConfirmation'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['priority', 'status', 'createdAt'];

export interface ServiceTicketListQuery extends ModuleListQuery {
  assetId?: string;
  accountId?: string;
}

interface Transition {
  to: string;
  when: string[];
  requires?: string;
}

const PLAIN_TRANSITIONS: Record<string, Transition> = {
  'Assign engineer': { to: 'Assigned', when: ['Open'], requires: 'engineer' },
  'Schedule visit': { to: 'Visit scheduled', when: ['Assigned'], requires: 'visitDate' },
  'Start work': { to: 'In progress', when: ['Visit scheduled', 'Assigned', 'Parts required'] },
  'Parts required': { to: 'Parts required', when: ['In progress'], requires: 'parts' },
  Resolve: { to: 'Resolved', when: ['In progress'], requires: 'resolution' },
  'Request confirmation': { to: 'Customer confirmation', when: ['Resolved'] },
  Close: { to: 'Closed', when: ['Customer confirmation', 'Resolved'] },
};

@Injectable()
export class ServiceTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly automation: AutomationEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  // Which tickets the caller may see follows their role's record-access setting (a Service Manager sees
  // all tickets, so she can read her own new ones and assign an engineer; a Service Engineer only theirs).
  private async scopeFilter(caller: AuthUser): Promise<Prisma.ServiceTicketWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const { ownerId } = (await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) as { ownerId?: string | { in: string[] } };
    return ownerId === undefined ? orgFilter : { ...orgFilter, engineerId: ownerId };
  }

  private async baseWhere(query: ServiceTicketListQuery, caller: AuthUser): Promise<Prisma.ServiceTicketWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search ? { description: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: ServiceTicketListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.serviceTicket as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: ServiceTicketListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.ServiceTicketWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.serviceTicket.count({ where }),
      this.prisma.serviceTicket.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.serviceTicket.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Service ticket '${id}' not found.`);
    return this.withSlaState(record);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  private async assertAssetInOrg(assetId: string, caller: AuthUser): Promise<{ status: string }> {
    const asset = await this.prisma.installedAsset.findFirst({ where: { id: assetId, orgId: caller.orgId ?? '' } });
    if (!asset) throw new BadRequestException(`Installed asset '${assetId}' not found in your organization.`);
    return asset;
  }

  async create(dto: CreateServiceTicketDto, caller: AuthUser) {
    await this.assertAccountInOrg(dto.accountId, caller);
    const asset = dto.assetId ? await this.assertAssetInOrg(dto.assetId, caller) : null;
    // Coverage and chargeability follow the asset's current cover unless the engineer states them.
    const coverage = dto.coverage ?? (asset?.status === 'Under warranty' ? 'In warranty' : asset?.status === 'Under AMC' ? 'Under AMC' : asset ? 'Chargeable' : undefined);
    const ticket = await this.prisma.serviceTicket.create({
      data: { ...dto, coverage, chargeable: dto.chargeable ?? (coverage ? coverage === 'Chargeable' : undefined), orgId: requireOrgId(caller), status: 'Open' },
    });
    // SLA-19 'Service first response' and SLA-20 'Service resolution' both start here — they
    // share the same startEvent, so one call covers both policies; priority is passed as
    // context so each picks its own per-priority target.
    await this.slaEngine.startTimer(ticket.orgId, MODULE_KEY, ENTITY_TYPE, ticket.id, 'Ticket created', ticket.priority);
    if (ticket.assetId) await this.flagRepeatFailures(ticket.orgId, ticket.assetId, ticket.accountId);
    await this.automation.fire(ticket.orgId, 'Service ticket created', { link: `/service-tickets/${ticket.id}`, title: `Service ticket raised (${ticket.priority})`, ownerId: ticket.engineerId, accountId: ticket.accountId });
    return ticket;
  }

  // Three or more tickets on one asset within 180 days is a pattern: put a review task in front of the account owner (once).
  private async flagRepeatFailures(orgId: string, assetId: string, accountId: string): Promise<void> {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const failures = await this.prisma.serviceTicket.count({ where: { orgId, assetId, isDeleted: false, createdAt: { gte: since } } });
    if (failures < 3) return;
    const subject = 'Review repeat failures on asset';
    const alreadyFlagged = await this.prisma.mfgActivity.findFirst({ where: { orgId, accountId, subject, status: 'Open', isDeleted: false }, select: { id: true } });
    if (alreadyFlagged) return;
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId }, select: { ownerId: true } });
    await this.prisma.mfgActivity.create({
      data: { orgId, type: 'Service follow-up', subject, notes: `${failures} service tickets raised on this asset in the last 180 days.`, accountId, ownerId: account?.ownerId, priority: 'High', status: 'Open', dueDate: new Date() },
    });
  }

  async update(id: string, dto: UpdateServiceTicketDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.assetId) await this.assertAssetInOrg(dto.assetId, caller);
    return this.prisma.serviceTicket.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.serviceTicket.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for service tickets.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a service ticket in status '${record.status}'.`);
    }
    if (transition.requires && !payload?.[transition.requires]) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    const data: Prisma.ServiceTicketUncheckedUpdateInput = { status: transition.to };
    if (action === 'Assign engineer') data.engineerId = payload!.engineer as string;
    if (action === 'Schedule visit') data.visitDate = new Date(payload!.visitDate as string);
    if (action === 'Parts required') data.partsRequired = payload!.parts as string;
    if (action === 'Resolve') data.resolution = payload!.resolution as string;
    const updated = await this.prisma.serviceTicket.update({ where: { id }, data });
    if (action === 'Assign engineer') {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Engineer assigned + customer contacted');
    } else if (action === 'Resolve') {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Resolved');
    }
    return updated;
  }
}
