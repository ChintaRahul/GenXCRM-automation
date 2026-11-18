import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { ApprovalRulesService } from './approval-rules.service';
import { CreateApprovalRuleDto } from './dto/create-approval-rule.dto';
import { UpdateApprovalRuleDto } from './dto/update-approval-rule.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class ApprovalRulesAdapter implements ModuleAdapter {
  constructor(private readonly approvalRules: ApprovalRulesService, registry: ModuleRegistryService) {
    registry.register('approvalRules', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.approvalRules.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.approvalRules.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.approvalRules.create(await validateBody(CreateApprovalRuleDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.approvalRules.update(id, await validateBody(UpdateApprovalRuleDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.approvalRules.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.approvalRules.performAction(id, action, payload, caller);
  }
}
