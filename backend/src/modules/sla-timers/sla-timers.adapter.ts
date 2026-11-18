import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { SlaTimersService } from './sla-timers.service';
import { CreateSlaTimerDto } from './dto/create-sla-timer.dto';
import { UpdateSlaTimerDto } from './dto/update-sla-timer.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class SlaTimersAdapter implements ModuleAdapter {
  constructor(private readonly slaTimers: SlaTimersService, registry: ModuleRegistryService) {
    registry.register('slaTimers', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.slaTimers.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.slaTimers.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.slaTimers.create(await validateBody(CreateSlaTimerDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.slaTimers.update(id, await validateBody(UpdateSlaTimerDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.slaTimers.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.slaTimers.performAction(id, action, payload, caller);
  }
}
