import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { ServiceTicketsService } from './service-tickets.service';
import { CreateServiceTicketDto } from './dto/create-service-ticket.dto';
import { UpdateServiceTicketDto } from './dto/update-service-ticket.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class ServiceTicketsAdapter implements ModuleAdapter {
  constructor(private readonly serviceTickets: ServiceTicketsService, registry: ModuleRegistryService) {
    registry.register('service', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.serviceTickets.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.serviceTickets.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.serviceTickets.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.serviceTickets.create(await validateBody(CreateServiceTicketDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.serviceTickets.update(id, await validateBody(UpdateServiceTicketDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.serviceTickets.archive(id, caller);
  }
  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.serviceTickets.performAction(id, action, payload, caller);
  }
}
