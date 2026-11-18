import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ContactsService } from './contacts.service';
import { MfgActivitiesService } from '../mfg-activities/mfg-activities.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactsAdapter implements ModuleAdapter {
  constructor(
    private readonly contacts: ContactsService,
    private readonly activities: MfgActivitiesService,
    registry: ModuleRegistryService,
  ) {
    registry.register('contacts', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.contacts.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.contacts.getFacets(query, caller);
  }
  findOne(id: string, caller: AuthUser): Promise<Record<string, unknown>> {
    return this.contacts.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser): Promise<Record<string, unknown>> {
    const validated = await validateBody(CreateContactDto, dto);
    return this.contacts.create(validated, caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser): Promise<Record<string, unknown>> {
    const validated = await validateBody(UpdateContactDto, dto);
    return this.contacts.update(id, validated, caller);
  }
  archive(id: string, caller: AuthUser): Promise<void> {
    return this.contacts.archive(id, caller);
  }
  performAction(id: string, action: string, _payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.contacts.performAction(id, action, caller);
  }

  async getRelated(
    id: string,
    tabKey: string,
    query: { page: number; limit: number },
    caller: AuthUser,
  ): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    if (tabKey === 'acts') return this.activities.findAll({ ...query, contactId: id }, caller);
    if (tabKey === 'opps') return this.contacts.findOpportunities(id, query, caller);
    throw new NotFoundException(`Related tab '${tabKey}' is not yet implemented for contacts.`);
  }
}
