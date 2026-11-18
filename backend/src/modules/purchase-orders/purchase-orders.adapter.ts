import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class PurchaseOrdersAdapter implements ModuleAdapter {
  constructor(private readonly purchaseOrders: PurchaseOrdersService, registry: ModuleRegistryService) {
    registry.register('pos', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.purchaseOrders.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.purchaseOrders.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.purchaseOrders.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.purchaseOrders.create(await validateBody(CreatePurchaseOrderDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.purchaseOrders.update(id, await validateBody(UpdatePurchaseOrderDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.purchaseOrders.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.purchaseOrders.performAction(id, action, payload, caller);
  }
  async getTable(id: string, tabKey: string, caller: AuthUser): Promise<ModuleTableResult> {
    if (tabKey !== 'compare') throw new NotFoundException(`Table tab '${tabKey}' is not available for purchase orders.`);
    return this.purchaseOrders.getCompareTable(id, caller);
  }
}
