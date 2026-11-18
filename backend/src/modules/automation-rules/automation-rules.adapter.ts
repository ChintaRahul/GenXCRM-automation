import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { AutomationRulesService } from './automation-rules.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class AutomationRulesAdapter implements ModuleAdapter {
  constructor(private readonly automationRules: AutomationRulesService, registry: ModuleRegistryService) {
    registry.register('automationRules', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.automationRules.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.automationRules.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.automationRules.create(await validateBody(CreateAutomationRuleDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.automationRules.update(id, await validateBody(UpdateAutomationRuleDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.automationRules.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.automationRules.performAction(id, action, payload, caller);
  }
  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'runs') throw new NotFoundException(`Event tab '${tabKey}' is not available for automation rules.`);
    return this.automationRules.getRunEvents(id, caller);
  }
}
