import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { MfgActivitiesService } from './mfg-activities.service';
import { CreateMfgActivityDto } from './dto/create-mfg-activity.dto';
import { UpdateMfgActivityDto } from './dto/update-mfg-activity.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class MfgActivitiesAdapter implements ModuleAdapter {
  constructor(
    private readonly activities: MfgActivitiesService,
    registry: ModuleRegistryService,
  ) {
    registry.register('activities', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.activities.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.activities.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.activities.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(CreateMfgActivityDto, dto);
    return this.activities.create(validated, caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(UpdateMfgActivityDto, dto);
    return this.activities.update(id, validated, caller);
  }

  archive(id: string, caller: AuthUser): Promise<void> {
    return this.activities.archive(id, caller);
  }

  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.activities.performAction(id, action, payload, caller);
  }
}
