import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateBusinessCalendarDto } from './dto/create-business-calendar.dto';
import type { UpdateBusinessCalendarDto } from './dto/update-business-calendar.dto';

const SORTABLE_FIELDS = ['createdAt'];

@Injectable()
export class BusinessCalendarsService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.BusinessCalendarWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.BusinessCalendarWhereInput = { ...this.scopeFilter(caller), isDeleted: false };
    const [total, data] = await Promise.all([
      this.prisma.businessCalendar.count({ where }),
      this.prisma.businessCalendar.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.businessCalendar.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Business calendar '${id}' not found.`);
    return record;
  }

  async create(dto: CreateBusinessCalendarDto, caller: AuthUser) {
    return this.prisma.businessCalendar.create({
      data: {
        timezone: dto.timezone ?? 'Asia/Kolkata',
        days: dto.days as Prisma.InputJsonValue,
        orgId: requireOrgId(caller),
      },
    });
  }

  async update(id: string, dto: UpdateBusinessCalendarDto, caller: AuthUser) {
    await this.findOne(id, caller);
    const { days, ...rest } = dto;
    return this.prisma.businessCalendar.update({
      where: { id },
      data: { ...rest, ...(days ? { days: days as Prisma.InputJsonValue } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.businessCalendar.update({ where: { id }, data: { isDeleted: true } });
  }
}
