import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { EvaluationsService } from './evaluations.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { UpdateEvaluationDto } from './dto/update-evaluation.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class EvaluationsAdapter implements ModuleAdapter {
  constructor(private readonly evaluations: EvaluationsService, registry: ModuleRegistryService) {
    registry.register('demos', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.evaluations.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.evaluations.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.evaluations.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.evaluations.create(await validateBody(CreateEvaluationDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.evaluations.update(id, await validateBody(UpdateEvaluationDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.evaluations.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.evaluations.performAction(id, action, payload, caller);
  }
}
