import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateSlaTimerDto } from './dto/create-sla-timer.dto';
import type { UpdateSlaTimerDto } from './dto/update-sla-timer.dto';

const SORTABLE_FIELDS = ['status', 'createdAt'];

@Injectable()
export class SlaTimersService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.SlaTimerWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.SlaTimerWhereInput = {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.status?.length ? { status: { in: query.status } } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.slaTimer.count({ where }),
      this.prisma.slaTimer.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.slaTimer.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`SLA timer '${id}' not found.`);
    return record;
  }

  private async assertSlaPolicyInOrg(slaPolicyId: string, caller: AuthUser): Promise<void> {
    const policy = await this.prisma.slaPolicy.findFirst({ where: { id: slaPolicyId, orgId: caller.orgId ?? '' } });
    if (!policy) throw new BadRequestException(`SLA policy '${slaPolicyId}' not found in your organization.`);
  }

  async create(dto: CreateSlaTimerDto, caller: AuthUser) {
    await this.assertSlaPolicyInOrg(dto.slaPolicyId, caller);
    return this.prisma.slaTimer.create({
      data: { ...dto, orgId: requireOrgId(caller), status: 'Not started' },
    });
  }

  async update(id: string, dto: UpdateSlaTimerDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.slaPolicyId) await this.assertSlaPolicyInOrg(dto.slaPolicyId, caller);
    return this.prisma.slaTimer.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.slaTimer.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    await this.findOne(id, caller);
    if (action === 'Start') {
      return this.prisma.slaTimer.update({ where: { id }, data: { startedAt: new Date(), status: 'On track' } });
    }
    if (action === 'Stop') {
      return this.prisma.slaTimer.update({ where: { id }, data: { stoppedAt: new Date(), status: 'Met' } });
    }
    if (action === 'Pause') {
      return this.prisma.slaTimer.update({ where: { id }, data: { pausedAt: new Date() } });
    }
    throw new BadRequestException(`Unknown action '${action}' for SLA timers.`);
  }
}
