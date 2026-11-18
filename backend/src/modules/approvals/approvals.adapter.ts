import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { ApprovalsService } from './approvals.service';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class ApprovalsAdapter implements ModuleAdapter {
  constructor(private readonly approvals: ApprovalsService, registry: ModuleRegistryService) {
    registry.register('approvals', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.approvals.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.approvals.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.approvals.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.approvals.create(await validateBody(CreateApprovalDto, dto), caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.approvals.update(id, await validateBody(UpdateApprovalDto, dto), caller);
  }

  archive(id: string, caller: AuthUser) {
    return this.approvals.archive(id, caller);
  }

  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.approvals.performAction(id, action, payload, caller);
  }

  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'chain') throw new NotFoundException(`Event tab '${tabKey}' is not available for approvals.`);
    return this.approvals.getChainEvents(id, caller);
  }
}
