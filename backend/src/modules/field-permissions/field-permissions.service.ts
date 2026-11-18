import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateFieldPermissionDto } from './dto/create-field-permission.dto';
import type { UpdateFieldPermissionDto } from './dto/update-field-permission.dto';

const SORTABLE_FIELDS = ['moduleKey', 'createdAt'];

@Injectable()
export class FieldPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.FieldPermissionWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.FieldPermissionWhereInput = { ...this.scopeFilter(caller), isDeleted: false };
    const [total, data] = await Promise.all([
      this.prisma.fieldPermission.count({ where }),
      this.prisma.fieldPermission.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.fieldPermission.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Field permission '${id}' not found.`);
    return record;
  }

  async create(dto: CreateFieldPermissionDto, caller: AuthUser) {
    return this.prisma.fieldPermission.create({
      data: { ...dto, restrictedToRoles: dto.restrictedToRoles ?? [], orgId: requireOrgId(caller) },
    });
  }

  async update(id: string, dto: UpdateFieldPermissionDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.fieldPermission.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.fieldPermission.update({ where: { id }, data: { isDeleted: true } });
  }
}
