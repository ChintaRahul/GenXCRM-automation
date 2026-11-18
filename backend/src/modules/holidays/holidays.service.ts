import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateHolidayDto } from './dto/create-holiday.dto';
import type { UpdateHolidayDto } from './dto/update-holiday.dto';

const SORTABLE_FIELDS = ['date', 'createdAt'];

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.HolidayWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'date');
    const where: Prisma.HolidayWhereInput = { ...this.scopeFilter(caller), isDeleted: false };
    const [total, data] = await Promise.all([
      this.prisma.holiday.count({ where }),
      this.prisma.holiday.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.holiday.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Holiday '${id}' not found.`);
    return record;
  }

  async create(dto: CreateHolidayDto, caller: AuthUser) {
    return this.prisma.holiday.create({
      data: { ...dto, date: new Date(dto.date), orgId: requireOrgId(caller) },
    });
  }

  async update(id: string, dto: UpdateHolidayDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.holiday.update({
      where: { id },
      data: { ...dto, ...(dto.date ? { date: new Date(dto.date) } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.holiday.update({ where: { id }, data: { isDeleted: true } });
  }
}
