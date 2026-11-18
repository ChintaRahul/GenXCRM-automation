import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class HolidaysAdapter implements ModuleAdapter {
  constructor(private readonly holidays: HolidaysService, registry: ModuleRegistryService) {
    registry.register('holidays', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.holidays.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.holidays.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.holidays.create(await validateBody(CreateHolidayDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.holidays.update(id, await validateBody(UpdateHolidayDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.holidays.archive(id, caller);
  }
}
