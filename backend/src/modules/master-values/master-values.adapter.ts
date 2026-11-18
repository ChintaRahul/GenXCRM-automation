import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { MasterValuesService } from './master-values.service';
import { CreateMasterValueDto } from './dto/create-master-value.dto';
import { UpdateMasterValueDto } from './dto/update-master-value.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class MasterValuesAdapter implements ModuleAdapter {
  constructor(private readonly masterValues: MasterValuesService, registry: ModuleRegistryService) {
    registry.register('masters', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.masterValues.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.masterValues.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.masterValues.create(await validateBody(CreateMasterValueDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.masterValues.update(id, await validateBody(UpdateMasterValueDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.masterValues.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.masterValues.performAction(id, action, payload, caller);
  }
}
