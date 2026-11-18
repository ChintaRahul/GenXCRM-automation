import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { RfqsService } from './rfqs.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto } from './dto/update-rfq.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class RfqsAdapter implements ModuleAdapter {
  constructor(private readonly rfqs: RfqsService, registry: ModuleRegistryService) {
    registry.register('rfqs', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.rfqs.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.rfqs.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.rfqs.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.rfqs.create(await validateBody(CreateRfqDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.rfqs.update(id, await validateBody(UpdateRfqDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.rfqs.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.rfqs.performAction(id, action, payload, caller);
  }
  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'revs') throw new NotFoundException(`Event tab '${tabKey}' is not available for RFQs.`);
    return this.rfqs.getRevisionEvents(id, caller);
  }
}
