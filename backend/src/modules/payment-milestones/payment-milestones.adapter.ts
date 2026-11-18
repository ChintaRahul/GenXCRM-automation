import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { PaymentMilestonesService } from './payment-milestones.service';
import { CreatePaymentMilestoneDto } from './dto/create-payment-milestone.dto';
import { UpdatePaymentMilestoneDto } from './dto/update-payment-milestone.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class PaymentMilestonesAdapter implements ModuleAdapter {
  constructor(private readonly paymentMilestones: PaymentMilestonesService, registry: ModuleRegistryService) {
    registry.register('payments', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.paymentMilestones.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.paymentMilestones.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.paymentMilestones.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.paymentMilestones.create(await validateBody(CreatePaymentMilestoneDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.paymentMilestones.update(id, await validateBody(UpdatePaymentMilestoneDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.paymentMilestones.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.paymentMilestones.performAction(id, action, payload, caller);
  }
  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'esc') throw new NotFoundException(`Event tab '${tabKey}' is not available for payment milestones.`);
    return this.paymentMilestones.getEscalationEvents(id, caller);
  }
  async getRelated(id: string, tabKey: string, query: { page: number; limit: number }, caller: AuthUser) {
    if (tabKey !== 'receipts') throw new NotFoundException(`Related tab '${tabKey}' is not available for payment milestones.`);
    return this.paymentMilestones.getReceipts(id, query, caller);
  }
}
