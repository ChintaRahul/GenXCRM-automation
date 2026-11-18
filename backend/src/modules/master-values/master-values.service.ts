import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateMasterValueDto } from './dto/create-master-value.dto';
import type { UpdateMasterValueDto } from './dto/update-master-value.dto';

const SORTABLE_FIELDS = ['category', 'sortOrder', 'createdAt'];

@Injectable()
export class MasterValuesService {
  constructor(private readonly prisma: PrismaService) {}

  // No ownerId on this model — org-only scoping for every role (matches Dispatch/InstalledAsset).
  private scopeFilter(caller: AuthUser): Prisma.MasterValueWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.MasterValueWhereInput = {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.search
        ? {
            OR: [
              { category: { contains: query.search, mode: 'insensitive' } },
              { label: { contains: query.search, mode: 'insensitive' } },
              { value: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.masterValue.count({ where }),
      this.prisma.masterValue.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.masterValue.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Master value '${id}' not found.`);
    return record;
  }

  async create(dto: CreateMasterValueDto, caller: AuthUser) {
    return this.prisma.masterValue.create({
      data: { ...dto, orgId: requireOrgId(caller), isActive: true },
    });
  }

  async update(id: string, dto: UpdateMasterValueDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.masterValue.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.masterValue.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (action === 'Deactivate') {
      if (!record.isActive) throw new BadRequestException(`Master value '${id}' is already inactive.`);
      return this.prisma.masterValue.update({ where: { id }, data: { isActive: false } });
    }
    if (action === 'Activate') {
      if (record.isActive) throw new BadRequestException(`Master value '${id}' is already active.`);
      return this.prisma.masterValue.update({ where: { id }, data: { isActive: true } });
    }
    throw new BadRequestException(`Unknown action '${action}' for master values.`);
  }
}
