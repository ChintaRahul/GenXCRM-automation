import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import type { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';

const SORTABLE_FIELDS = ['trigger', 'createdAt'];

@Injectable()
export class AutomationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.AutomationRuleWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.AutomationRuleWhereInput = {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.search ? { trigger: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.automationRule.count({ where }),
      this.prisma.automationRule.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.automationRule.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Automation rule '${id}' not found.`);
    return record;
  }

  async create(dto: CreateAutomationRuleDto, caller: AuthUser) {
    return this.prisma.automationRule.create({ data: { ...dto, orgId: requireOrgId(caller), isActive: true } });
  }

  async update(id: string, dto: UpdateAutomationRuleDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.automationRule.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.automationRule.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (action === 'Deactivate') {
      if (!record.isActive) throw new BadRequestException(`Automation rule '${id}' is already inactive.`);
      return this.prisma.automationRule.update({ where: { id }, data: { isActive: false } });
    }
    if (action === 'Activate') {
      if (record.isActive) throw new BadRequestException(`Automation rule '${id}' is already active.`);
      return this.prisma.automationRule.update({ where: { id }, data: { isActive: true } });
    }
    throw new BadRequestException(`Unknown action '${action}' for automation rules.`);
  }

  async getRunEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    await this.findOne(id, caller);
    const rows = await this.prisma.automationRun.findMany({ where: { automationRuleId: id }, orderBy: { runAt: 'desc' } });
    return rows.map((row) => ({
      id: row.id,
      at: row.runAt.toISOString(),
      label: row.status,
      description: row.details ?? undefined,
    }));
  }
}
