import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { MfgReportsService } from './mfg-reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class MfgReportsAdapter implements ModuleAdapter {
  constructor(private readonly reports: MfgReportsService, registry: ModuleRegistryService) {
    registry.register('reports', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.reports.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.reports.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.reports.create(await validateBody(CreateReportDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.reports.update(id, await validateBody(UpdateReportDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.reports.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.reports.performAction(id, action, payload, caller);
  }
  async getTable(id: string, tabKey: string, caller: AuthUser): Promise<ModuleTableResult> {
    if (tabKey !== 'data') throw new NotFoundException(`Table tab '${tabKey}' is not available for reports.`);
    return this.reports.getDataTable(id, caller);
  }
  async getEvents(id: string, tabKey: string, caller: AuthUser) {
    if (tabKey !== 'schedule') throw new NotFoundException(`Event tab '${tabKey}' is not available for reports.`);
    return this.reports.getScheduleEvents(id, caller);
  }
  getPdf(id: string, caller: AuthUser) {
    return this.reports.buildPdf(id, caller);
  }
  getCsv(id: string, caller: AuthUser) {
    return this.reports.buildCsv(id, caller);
  }
}
