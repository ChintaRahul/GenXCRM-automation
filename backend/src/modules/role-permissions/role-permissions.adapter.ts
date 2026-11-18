import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { RolePermissionsService } from './role-permissions.service';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class RolePermissionsAdapter implements ModuleAdapter {
  constructor(private readonly rolePermissions: RolePermissionsService, registry: ModuleRegistryService) {
    registry.register('rolePermissions', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.rolePermissions.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.rolePermissions.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.rolePermissions.create(await validateBody(CreateRolePermissionDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.rolePermissions.update(id, await validateBody(UpdateRolePermissionDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.rolePermissions.archive(id, caller);
  }
}
