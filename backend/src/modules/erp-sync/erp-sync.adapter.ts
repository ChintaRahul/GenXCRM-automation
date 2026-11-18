import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { ErpSyncService } from './erp-sync.service';
import { CreateErpConnectionDto } from './dto/create-erp-connection.dto';
import { UpdateErpConnectionDto } from './dto/update-erp-connection.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class ErpSyncAdapter implements ModuleAdapter {
  constructor(
    private readonly erp: ErpSyncService,
    registry: ModuleRegistryService,
  ) {
    registry.register('erp', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.erp.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.erp.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.erp.create(await validateBody(CreateErpConnectionDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.erp.update(id, await validateBody(UpdateErpConnectionDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.erp.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.erp.performAction(id, action, payload, caller);
  }
  getEvents(id: string, tabKey: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    if (tabKey !== 'log') throw new NotFoundException(`Event tab '${tabKey}' is not available for ERP connections.`);
    return this.erp.getLogEvents(id, caller);
  }
}
