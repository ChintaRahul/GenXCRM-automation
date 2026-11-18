import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { InstalledAssetsService } from './installed-assets.service';
import { CoverageService } from '../coverage/coverage.service';
import { ServiceTicketsService } from '../service-tickets/service-tickets.service';
import { CreateInstalledAssetDto } from './dto/create-installed-asset.dto';
import { UpdateInstalledAssetDto } from './dto/update-installed-asset.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class InstalledAssetsAdapter implements ModuleAdapter {
  constructor(
    private readonly assets: InstalledAssetsService,
    private readonly coverage: CoverageService,
    private readonly serviceTickets: ServiceTicketsService,
    registry: ModuleRegistryService,
  ) {
    registry.register('assets', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.assets.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.assets.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.assets.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.assets.create(await validateBody(CreateInstalledAssetDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.assets.update(id, await validateBody(UpdateInstalledAssetDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.assets.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.assets.performAction(id, action, payload, caller);
  }
  async getRelated(id: string, tabKey: string, query: { page: number; limit: number }, caller: AuthUser) {
    if (tabKey === 'coverage') return this.coverage.findAll({ ...query, assetId: id }, caller);
    if (tabKey === 'service') return this.serviceTickets.findAll({ ...query, assetId: id }, caller);
    throw new NotFoundException(`Related tab '${tabKey}' is not available for installed assets.`);
  }
}
