import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { CostingSheetsService } from './costing-sheets.service';
import { CreateCostingSheetDto } from './dto/create-costing-sheet.dto';
import { UpdateCostingSheetDto } from './dto/update-costing-sheet.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class CostingSheetsAdapter implements ModuleAdapter {
  constructor(private readonly costingSheets: CostingSheetsService, registry: ModuleRegistryService) {
    registry.register('costing', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.costingSheets.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.costingSheets.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.costingSheets.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.costingSheets.create(await validateBody(CreateCostingSheetDto, dto), caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.costingSheets.update(id, await validateBody(UpdateCostingSheetDto, dto), caller);
  }

  archive(id: string, caller: AuthUser) {
    return this.costingSheets.archive(id, caller);
  }

  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.costingSheets.performAction(id, action, payload, caller);
  }

  async getTable(id: string, tabKey: string, caller: AuthUser): Promise<ModuleTableResult> {
    if (tabKey !== 'breakdown') throw new NotFoundException(`Table tab '${tabKey}' is not available for costing sheets.`);
    return this.costingSheets.getBreakdownTable(id, caller);
  }
}
