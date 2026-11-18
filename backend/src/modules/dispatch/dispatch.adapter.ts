import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { UpdateDispatchDto } from './dto/update-dispatch.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class DispatchAdapter implements ModuleAdapter {
  constructor(private readonly dispatches: DispatchService, registry: ModuleRegistryService) {
    registry.register('dispatch', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.dispatches.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.dispatches.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.dispatches.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.dispatches.create(await validateBody(CreateDispatchDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.dispatches.update(id, await validateBody(UpdateDispatchDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.dispatches.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.dispatches.performAction(id, action, payload, caller);
  }
}
