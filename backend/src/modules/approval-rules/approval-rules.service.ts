import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateApprovalRuleDto } from './dto/create-approval-rule.dto';
import type { UpdateApprovalRuleDto } from './dto/update-approval-rule.dto';

const SORTABLE_FIELDS = ['type', 'createdAt'];

@Injectable()
export class ApprovalRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.ApprovalRuleWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.ApprovalRuleWhereInput = { ...this.scopeFilter(caller), isDeleted: false };
    const [total, data] = await Promise.all([
      this.prisma.approvalRule.count({ where }),
      this.prisma.approvalRule.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.approvalRule.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Approval rule '${id}' not found.`);
    return record;
  }

  async create(dto: CreateApprovalRuleDto, caller: AuthUser) {
    return this.prisma.approvalRule.create({ data: { ...dto, orgId: requireOrgId(caller), isActive: true } });
  }

  async update(id: string, dto: UpdateApprovalRuleDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.approvalRule.update({ where: { id }, data: dto });
  }

  // Costing sheets are routed by Margin rules; with none active every sheet would skip approval.
  private async assertNotLastActiveMargin(record: { id: string; type: string; isActive: boolean }, caller: AuthUser): Promise<void> {
    if (record.type !== 'Margin' || !record.isActive) return;
    const others = await this.prisma.approvalRule.count({
      where: { ...this.scopeFilter(caller), type: 'Margin', isActive: true, isDeleted: false, id: { not: record.id } },
    });
    if (others === 0) throw new BadRequestException('At least one active Margin rule is required — add another before removing or deactivating this one.');
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    const record = await this.findOne(id, caller);
    await this.assertNotLastActiveMargin(record, caller);
    await this.prisma.approvalRule.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (action === 'Deactivate') {
      if (!record.isActive) throw new BadRequestException(`Approval rule '${id}' is already inactive.`);
      await this.assertNotLastActiveMargin(record, caller);
      return this.prisma.approvalRule.update({ where: { id }, data: { isActive: false } });
    }
    if (action === 'Activate') {
      if (record.isActive) throw new BadRequestException(`Approval rule '${id}' is already active.`);
      return this.prisma.approvalRule.update({ where: { id }, data: { isActive: true } });
    }
    throw new BadRequestException(`Unknown action '${action}' for approval rules.`);
  }
}
