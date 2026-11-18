import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleAdapter, ModuleImportResult, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { MfgLeadsService } from './mfg-leads.service';
import { MfgActivitiesService } from '../mfg-activities/mfg-activities.service';
import { CreateMfgLeadDto } from './dto/create-mfg-lead.dto';
import { UpdateMfgLeadDto } from './dto/update-mfg-lead.dto';

@Injectable()
export class MfgLeadsAdapter implements ModuleAdapter {
  constructor(
    private readonly leads: MfgLeadsService,
    private readonly activities: MfgActivitiesService,
    registry: ModuleRegistryService,
  ) {
    registry.register('leads', this);
  }

  list(query: ModuleListQuery, caller: AuthUser) {
    return this.leads.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.leads.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.leads.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(CreateMfgLeadDto, dto);
    return this.leads.create(validated, caller);
  }

  importRows(rows: Record<string, unknown>[], caller: AuthUser): Promise<ModuleImportResult> {
    return this.leads.importLeads(rows, caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(UpdateMfgLeadDto, dto);
    return this.leads.update(id, validated, caller);
  }

  archive(id: string, caller: AuthUser) {
    return this.leads.archive(id, caller);
  }

  performAction(
    id: string,
    action: string,
    payload: Record<string, unknown> | undefined,
    caller: AuthUser,
  ) {
    return this.leads.performAction(id, action, payload, caller);
  }

  async getRelated(
    id: string,
    tabKey: string,
    query: { page: number; limit: number },
    caller: AuthUser,
  ): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    if (tabKey === 'acts') return this.activities.findAll({ ...query, mfgLeadId: id }, caller);
    throw new NotFoundException(`Related tab '${tabKey}' is not yet implemented for leads.`);
  }
}
