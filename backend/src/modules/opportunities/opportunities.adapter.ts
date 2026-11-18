import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult, ModuleEventItem } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { OpportunitiesService } from './opportunities.service';
import { MfgActivitiesService } from '../mfg-activities/mfg-activities.service';
import { ContactsService } from '../contacts/contacts.service';
import { RfqsService } from '../rfqs/rfqs.service';
import { SiteVisitsService } from '../site-visits/site-visits.service';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { CostingSheetsService } from '../costing-sheets/costing-sheets.service';
import { QuotationsService } from '../quotations/quotations.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class OpportunitiesAdapter implements ModuleAdapter {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly activities: MfgActivitiesService,
    private readonly contacts: ContactsService,
    private readonly rfqs: RfqsService,
    private readonly siteVisits: SiteVisitsService,
    private readonly evaluations: EvaluationsService,
    private readonly costingSheets: CostingSheetsService,
    private readonly quotations: QuotationsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    registry: ModuleRegistryService,
  ) {
    registry.register('opps', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.opportunities.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.opportunities.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.opportunities.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(CreateOpportunityDto, dto);
    return this.opportunities.create(validated, caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(UpdateOpportunityDto, dto);
    return this.opportunities.update(id, validated, caller);
  }

  archive(id: string, caller: AuthUser): Promise<void> {
    return this.opportunities.archive(id, caller);
  }

  performAction(
    id: string,
    action: string,
    payload: Record<string, unknown> | undefined,
    caller: AuthUser,
  ) {
    return this.opportunities.performAction(id, action, payload, caller);
  }

  getEvents(id: string, tabKey: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    if (tabKey === 'timeline') return this.opportunities.getTimelineEvents(id, caller);
    if (tabKey !== 'history') throw new NotFoundException(`Event tab '${tabKey}' is not available for opportunities.`);
    return this.opportunities.getHistoryEvents(id, caller);
  }

  async getRelated(
    id: string,
    tabKey: string,
    query: { page: number; limit: number },
    caller: AuthUser,
  ): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    if (tabKey === 'acts') return this.activities.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'rfqs') return this.rfqs.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'visits') return this.siteVisits.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'demos') return this.evaluations.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'costing') return this.costingSheets.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'quotes') return this.quotations.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'pos') return this.purchaseOrders.findAll({ ...query, opportunityId: id }, caller);
    if (tabKey === 'contacts') {
      // Contact has no opportunityId — this opportunity's account's contacts stand in for it.
      const opportunity = await this.opportunities.findOne(id, caller);
      return this.contacts.findAll({ ...query, accountId: opportunity.accountId }, caller);
    }
    throw new NotFoundException(`Related tab '${tabKey}' is not yet implemented for opportunities.`);
  }
}
