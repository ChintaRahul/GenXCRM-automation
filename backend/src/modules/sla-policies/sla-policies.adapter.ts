import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { SlaPoliciesService } from './sla-policies.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class SlaPoliciesAdapter implements ModuleAdapter {
  constructor(private readonly slaPolicies: SlaPoliciesService, registry: ModuleRegistryService) {
    registry.register('slaPolicies', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.slaPolicies.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.slaPolicies.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.slaPolicies.create(await validateBody(CreateSlaPolicyDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.slaPolicies.update(id, await validateBody(UpdateSlaPolicyDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.slaPolicies.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.slaPolicies.performAction(id, action, payload, caller);
  }
}
