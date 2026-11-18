import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { SalesOrdersService } from './sales-orders.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentMilestonesService } from '../payment-milestones/payment-milestones.service';
import { InstalledAssetsService } from '../installed-assets/installed-assets.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class SalesOrdersAdapter implements ModuleAdapter {
  constructor(
    private readonly salesOrders: SalesOrdersService,
    private readonly dispatches: DispatchService,
    private readonly paymentMilestones: PaymentMilestonesService,
    private readonly installedAssets: InstalledAssetsService,
    registry: ModuleRegistryService,
  ) {
    registry.register('sorders', this);
  }

  getPdf(id: string, caller: AuthUser) {
    return this.salesOrders.buildCommissioningReport(id, caller);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.salesOrders.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.salesOrders.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.salesOrders.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.salesOrders.create(await validateBody(CreateSalesOrderDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.salesOrders.update(id, await validateBody(UpdateSalesOrderDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.salesOrders.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.salesOrders.performAction(id, action, payload, caller);
  }
  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'milestones') throw new NotFoundException(`Event tab '${tabKey}' is not available for sales orders.`);
    return this.salesOrders.getMilestoneEvents(id, caller);
  }
  async getRelated(id: string, tabKey: string, query: { page: number; limit: number }, caller: AuthUser) {
    if (tabKey === 'dispatch') return this.dispatches.findAll({ ...query, salesOrderId: id }, caller);
    if (tabKey === 'payments') return this.paymentMilestones.findAll({ ...query, salesOrderId: id }, caller);
    if (tabKey === 'assets') return this.installedAssets.findAll({ ...query, salesOrderId: id }, caller);
    throw new NotFoundException(`Related tab '${tabKey}' is not available for sales orders.`);
  }
}
