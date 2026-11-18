import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { TendersService } from './tenders.service';
import { CreateTenderDto } from './dto/create-tender.dto';
import { UpdateTenderDto } from './dto/update-tender.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class TendersAdapter implements ModuleAdapter {
  constructor(
    private readonly tenders: TendersService,
    registry: ModuleRegistryService,
  ) {
    registry.register('tenders', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.tenders.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.tenders.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.tenders.create(await validateBody(CreateTenderDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.tenders.update(id, await validateBody(UpdateTenderDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.tenders.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.tenders.performAction(id, action, payload, caller);
  }
}
