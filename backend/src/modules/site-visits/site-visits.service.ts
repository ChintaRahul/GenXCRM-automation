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
import { PdfService } from '../pdf/pdf.service';
import type { CreateSiteVisitDto } from './dto/create-site-visit.dto';
import type { UpdateSiteVisitDto } from './dto/update-site-visit.dto';

const ENTITY_TYPE = 'SiteVisit';
const MODULE_KEY = 'visits';
const LIST_FILTERS = {
  moduleKey: 'visits',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  dateField: 'visitDate',
  facetFields: [],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['title', 'status', 'visitDate', 'createdAt'];

export interface SiteVisitListQuery extends ModuleListQuery {
  opportunityId?: string;
  accountId?: string;
}

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  Confirm: { to: 'Confirmed', when: ['Planned', 'Rescheduled'] },
  'Complete visit': { to: 'Completed', when: ['Planned', 'Confirmed'], requires: 'next' },
  Reschedule: { to: 'Rescheduled', when: ['Planned', 'Confirmed'], requires: 'date' },
  Cancel: { to: 'Cancelled', when: ['Planned', 'Confirmed', 'Rescheduled'] },
};

@Injectable()
export class SiteVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly pdf: PdfService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.SiteVisitWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, 'visits')) };
  }

  private async baseWhere(query: SiteVisitListQuery, caller: AuthUser): Promise<Prisma.SiteVisitWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: SiteVisitListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.siteVisit as unknown as FacetDelegate, (await this.baseWhere(query, caller)), caller, LIST_FILTERS);
  }

  async findAll(query: SiteVisitListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.SiteVisitWhereInput = {
      ...((await this.baseWhere(query, caller))),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.siteVisit.count({ where }),
      this.prisma.siteVisit.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.siteVisit.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Site visit '${id}' not found.`);
    return this.withSlaState(record);
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  private async assertOpportunityInOrg(opportunityId: string, caller: AuthUser): Promise<void> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, orgId: caller.orgId ?? '' } });
    if (!opportunity) throw new BadRequestException(`Opportunity '${opportunityId}' not found in your organization.`);
  }

  // A visit can be planned for today or later; the date is compared at day granularity (UTC).
  private assertNotPast(date: string, label: string): void {
    const day = new Date(date).toISOString().slice(0, 10);
    if (day < new Date().toISOString().slice(0, 10)) throw new BadRequestException(`${label} cannot be in the past.`);
  }

  async create(dto: CreateSiteVisitDto, caller: AuthUser) {
    this.assertNotPast(dto.visitDate, 'Visit date');
    await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, 'visits')) ? (dto.ownerId ?? caller.id) : caller.id;
    return this.prisma.siteVisit.create({
      data: { ...dto, ownerId, visitDate: new Date(dto.visitDate), orgId: requireOrgId(caller), status: 'Planned' },
    });
  }

  async update(id: string, dto: UpdateSiteVisitDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.visitDate) this.assertNotPast(dto.visitDate, 'Visit date');
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.opportunityId) await this.assertOpportunityInOrg(dto.opportunityId, caller);
    const updated = await this.prisma.siteVisit.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.visitDate ? { visitDate: new Date(dto.visitDate) } : {}),
        ...(dto.nextActionDate ? { nextActionDate: new Date(dto.nextActionDate) } : {}),
      },
    });
    if (dto.recommendation) {
      // SLA-08 'Site visit report submission': there is no dedicated "submit report" action —
      // the Findings-section fields are saved via this same plain update() — so a non-empty
      // `recommendation` (the report's final field) is treated as the report being complete.
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Report submitted');
    }
    return updated;
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.siteVisit.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for site visits.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a site visit in status '${record.status}'.`);
    }
    if (transition.requires && !String(payload?.[transition.requires] ?? '').trim()) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    // A next action describes something to do, so digits alone ("12345") don't count.
    if (action === 'Complete visit' && !/\p{L}/u.test(String(payload!.next))) {
      throw new BadRequestException('Next action must describe what to do next, e.g. "Send revised quotation by 20 Oct".');
    }
    if (action === 'Reschedule') this.assertNotPast(payload!.date as string, 'New date');
    const data: Prisma.SiteVisitUpdateInput = { status: transition.to };
    if (action === 'Reschedule') data.visitDate = new Date(payload!.date as string);
    if (action === 'Complete visit') data.nextAction = String(payload!.next).trim();
    const updated = await this.prisma.siteVisit.update({ where: { id }, data });
    if (action === 'Complete visit') {
      // SLA-08 'Site visit report submission': starts once the visit itself is marked complete.
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Visit completed');
    }
    return updated;
  }

  async buildPdf(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }> {
    const visit = await this.findOne(id, caller);
    if (visit.status !== 'Completed') {
      throw new BadRequestException(`The visit report is available once the visit is Completed (current status: '${visit.status}').`);
    }
    const account = await this.prisma.account.findUnique({ where: { id: visit.accountId }, select: { name: true } });
    const buffer = await this.pdf.render((doc) => {
      doc.fontSize(18).font('Helvetica-Bold').text('Site Visit Report');
      doc.fontSize(10).font('Helvetica').text(id);
      doc.moveDown();
      this.pdf.fieldBlock(doc, [
        ['Account', account?.name ?? '—'],
        ['Plant', visit.plant ?? '—'],
        ['Visit date', visit.visitDate.toLocaleDateString('en-IN')],
        ['Objective', visit.objective],
        ['Engineers', visit.engineers ?? '—'],
      ]);
      doc.font('Helvetica-Bold').fontSize(11).text('Findings');
      this.pdf.fieldBlock(doc, [
        ['Existing system', visit.existingSystem ?? '—'],
        ['Customer problem', visit.customerProblem ?? '—'],
        ['Measurements', visit.measurements ?? '—'],
        ['Observations', visit.observations ?? '—'],
        ['Recommendation', visit.recommendation ?? '—'],
        ['Customer comments', visit.customerComments ?? '—'],
      ]);
      if (visit.nextAction) {
        doc.font('Helvetica-Bold').fontSize(10).text(`Next action: `, { continued: true });
        doc.font('Helvetica').text(visit.nextAction);
      }
    });
    return { filename: `Site-Visit-Report-${id}.pdf`, buffer };
  }
}
