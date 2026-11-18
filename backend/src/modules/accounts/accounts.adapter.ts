import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { AccountsService } from './accounts.service';
import { ContactsService } from '../contacts/contacts.service';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { MfgActivitiesService } from '../mfg-activities/mfg-activities.service';
import { QuotationsService } from '../quotations/quotations.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { InstalledAssetsService } from '../installed-assets/installed-assets.service';
import { ServiceTicketsService } from '../service-tickets/service-tickets.service';
import { PaymentMilestonesService } from '../payment-milestones/payment-milestones.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreatePlantDto } from './dto/create-plant.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class AccountsAdapter implements ModuleAdapter {
  constructor(
    private readonly accounts: AccountsService,
    private readonly contacts: ContactsService,
    private readonly opportunities: OpportunitiesService,
    private readonly activities: MfgActivitiesService,
    private readonly quotations: QuotationsService,
    private readonly salesOrders: SalesOrdersService,
    private readonly installedAssets: InstalledAssetsService,
    private readonly serviceTickets: ServiceTicketsService,
    private readonly paymentMilestones: PaymentMilestonesService,
    registry: ModuleRegistryService,
  ) {
    registry.register('accounts', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.accounts.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.accounts.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.accounts.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(CreateAccountDto, dto);
    return this.accounts.create(validated, caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    const validated = await validateBody(UpdateAccountDto, dto);
    return this.accounts.update(id, validated, caller);
  }

  archive(id: string, caller: AuthUser): Promise<void> {
    return this.accounts.archive(id, caller);
  }

  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.accounts.performAction(id, action, payload, caller);
  }

  getTable(id: string, tabKey: string, caller: AuthUser): Promise<ModuleTableResult> {
    if (tabKey !== 'plants') throw new NotFoundException(`Table tab '${tabKey}' is not available for accounts.`);
    return this.accounts.getPlantsTable(id, caller);
  }

  async addTableRow(id: string, tabKey: string, dto: Record<string, unknown>, caller: AuthUser): Promise<void> {
    if (tabKey !== 'plants') throw new NotFoundException(`Table tab '${tabKey}' is not available for accounts.`);
    await this.accounts.addPlant(id, await validateBody(CreatePlantDto, dto), caller);
  }

  removeTableRow(id: string, tabKey: string, rowId: string, caller: AuthUser): Promise<void> {
    if (tabKey !== 'plants') throw new NotFoundException(`Table tab '${tabKey}' is not available for accounts.`);
    return this.accounts.removePlant(id, rowId, caller);
  }

  async getRelated(
    id: string,
    tabKey: string,
    query: { page: number; limit: number },
    caller: AuthUser,
  ): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    if (tabKey === 'contacts') return this.contacts.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'opps') return this.opportunities.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'acts') return this.activities.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'quotes') return this.quotations.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'orders') return this.salesOrders.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'assets') return this.installedAssets.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'service') return this.serviceTickets.findAll({ ...query, accountId: id }, caller);
    if (tabKey === 'payments') return this.paymentMilestones.findAll({ ...query, accountId: id }, caller);
    throw new NotFoundException(`Related tab '${tabKey}' is not yet implemented for accounts.`);
  }
}
