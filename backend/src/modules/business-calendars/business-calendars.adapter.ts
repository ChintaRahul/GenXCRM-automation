import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { BusinessCalendarsService } from './business-calendars.service';
import { CreateBusinessCalendarDto } from './dto/create-business-calendar.dto';
import { UpdateBusinessCalendarDto } from './dto/update-business-calendar.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class BusinessCalendarsAdapter implements ModuleAdapter {
  constructor(private readonly businessCalendars: BusinessCalendarsService, registry: ModuleRegistryService) {
    registry.register('businessCalendar', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.businessCalendars.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.businessCalendars.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.businessCalendars.create(await validateBody(CreateBusinessCalendarDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.businessCalendars.update(id, await validateBody(UpdateBusinessCalendarDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.businessCalendars.archive(id, caller);
  }
}
