import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { SiteVisitsService } from './site-visits.service';
import { CreateSiteVisitDto } from './dto/create-site-visit.dto';
import { UpdateSiteVisitDto } from './dto/update-site-visit.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class SiteVisitsAdapter implements ModuleAdapter {
  constructor(private readonly visits: SiteVisitsService, registry: ModuleRegistryService) {
    registry.register('visits', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.visits.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.visits.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.visits.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.visits.create(await validateBody(CreateSiteVisitDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.visits.update(id, await validateBody(UpdateSiteVisitDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.visits.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.visits.performAction(id, action, payload, caller);
  }
  getPdf(id: string, caller: AuthUser) {
    return this.visits.buildPdf(id, caller);
  }
}
