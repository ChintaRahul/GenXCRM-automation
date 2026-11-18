import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import type { UpdateRolePermissionDto } from './dto/update-role-permission.dto';

const SORTABLE_FIELDS = ['role', 'moduleKey', 'createdAt'];

@Injectable()
export class RolePermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.RolePermissionWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.RolePermissionWhereInput = { ...this.scopeFilter(caller), isDeleted: false };
    const [total, data] = await Promise.all([
      this.prisma.rolePermission.count({ where }),
      this.prisma.rolePermission.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.rolePermission.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Role permission '${id}' not found.`);
    return record;
  }

  async create(dto: CreateRolePermissionDto, caller: AuthUser) {
    return this.prisma.rolePermission.create({ data: { ...dto, orgId: requireOrgId(caller) } });
  }

  async update(id: string, dto: UpdateRolePermissionDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.rolePermission.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.rolePermission.update({ where: { id }, data: { isDeleted: true } });
  }
}
