import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { FieldPermissionsService } from './field-permissions.service';
import { CreateFieldPermissionDto } from './dto/create-field-permission.dto';
import { UpdateFieldPermissionDto } from './dto/update-field-permission.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class FieldPermissionsAdapter implements ModuleAdapter {
  constructor(private readonly fieldPermissions: FieldPermissionsService, registry: ModuleRegistryService) {
    registry.register('fieldPermissions', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.fieldPermissions.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.fieldPermissions.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.fieldPermissions.create(await validateBody(CreateFieldPermissionDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.fieldPermissions.update(id, await validateBody(UpdateFieldPermissionDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.fieldPermissions.archive(id, caller);
  }
}
