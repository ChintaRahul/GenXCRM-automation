import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { DealersService } from './dealers.service';
import { CreateDealerDto } from './dto/create-dealer.dto';
import { CreateDealerDealDto } from './dto/create-dealer-deal.dto';
import { UpdateDealerDto } from './dto/update-dealer.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class DealersAdapter implements ModuleAdapter {
  constructor(
    private readonly dealers: DealersService,
    registry: ModuleRegistryService,
  ) {
    registry.register('dealers', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.dealers.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.dealers.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.dealers.create(await validateBody(CreateDealerDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.dealers.update(id, await validateBody(UpdateDealerDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.dealers.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.dealers.performAction(id, action, payload, caller);
  }

  getTable(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'deals') throw new NotFoundException(`Table tab '${tabKey}' is not available for dealers.`);
    return this.dealers.getDealsTable(id, caller);
  }
  async addTableRow(id: string, tabKey: string, dto: Record<string, unknown>, caller: AuthUser): Promise<void> {
    if (tabKey !== 'deals') throw new NotFoundException(`Table tab '${tabKey}' is not available for dealers.`);
    await this.dealers.registerDeal(id, await validateBody(CreateDealerDealDto, { ...dto, value: Number(dto.value) }), caller);
  }
  removeTableRow(id: string, tabKey: string, rowId: string, caller: AuthUser): Promise<void> {
    if (tabKey !== 'deals') throw new NotFoundException(`Table tab '${tabKey}' is not available for dealers.`);
    return this.dealers.removeDeal(id, rowId, caller);
  }
}
