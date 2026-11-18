import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { QuotationsService } from './quotations.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MfgActivitiesService } from '../mfg-activities/mfg-activities.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class QuotationsAdapter implements ModuleAdapter {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly approvals: ApprovalsService,
    private readonly activities: MfgActivitiesService,
    registry: ModuleRegistryService,
  ) {
    registry.register('quotes', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.quotations.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.quotations.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.quotations.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.quotations.create(await validateBody(CreateQuotationDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.quotations.update(id, await validateBody(UpdateQuotationDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.quotations.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.quotations.performAction(id, action, payload, caller);
  }
  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'versions') throw new NotFoundException(`Event tab '${tabKey}' is not available for quotations.`);
    return this.quotations.getVersionEvents(id, caller);
  }
  getPdf(id: string, caller: AuthUser) {
    return this.quotations.buildPdf(id, caller);
  }

  async getRelated(id: string, tabKey: string, query: { page: number; limit: number }, caller: AuthUser) {
    if (tabKey === 'approvals') {
      return this.approvals.findAll({ ...query, entityType: 'Quotation', entityId: id }, caller);
    }
    if (tabKey === 'follow') {
      const quotation = await this.quotations.findOne(id, caller);
      return this.activities.findAll({ ...query, opportunityId: quotation.opportunityId }, caller);
    }
    throw new NotFoundException(`Related tab '${tabKey}' is not yet implemented for quotations.`);
  }
}
