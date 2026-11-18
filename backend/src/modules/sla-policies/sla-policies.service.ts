import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import type { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

const SORTABLE_FIELDS = ['moduleKey', 'name', 'createdAt'];

@Injectable()
export class SlaPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
  ) {}

  private scopeFilter(caller: AuthUser): Prisma.SlaPolicyWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.SlaPolicyWhereInput = {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.slaPolicy.count({ where }),
      this.prisma.slaPolicy.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.slaPolicy.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`SLA policy '${id}' not found.`);
    return record;
  }

  async create(dto: CreateSlaPolicyDto, caller: AuthUser) {
    return this.prisma.slaPolicy.create({
      data: {
        ...dto,
        targets: dto.targets as Prisma.InputJsonValue,
        escalationLevels: dto.escalationLevels as Prisma.InputJsonValue,
        pauseStatuses: dto.pauseStatuses ?? [],
        orgId: requireOrgId(caller),
        isActive: true,
      },
    });
  }

  async update(id: string, dto: UpdateSlaPolicyDto, caller: AuthUser) {
    await this.findOne(id, caller);
    const { targets, escalationLevels, ...rest } = dto;
    return this.prisma.slaPolicy.update({
      where: { id },
      data: {
        ...rest,
        ...(targets ? { targets: targets as Prisma.InputJsonValue } : {}),
        ...(escalationLevels ? { escalationLevels: escalationLevels as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.slaPolicy.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (action === 'Run checks now') {
      // Lets an admin trigger the escalation check and the date-based alerts on demand instead of waiting for the 5-minute / hourly schedule (used when testing short SLA targets).
      if (caller.role !== Role.DIRECTOR) throw new ForbiddenException('Only an administrator can run the SLA checks.');
      await this.slaEngine.tick();
      await this.slaEngine.runDateTriggeredSweep();
      return record;
    }
    if (action === 'Deactivate') {
      if (!record.isActive) throw new BadRequestException(`SLA policy '${id}' is already inactive.`);
      return this.prisma.slaPolicy.update({ where: { id }, data: { isActive: false } });
    }
    if (action === 'Activate') {
      if (record.isActive) throw new BadRequestException(`SLA policy '${id}' is already active.`);
      return this.prisma.slaPolicy.update({ where: { id }, data: { isActive: true } });
    }
    throw new BadRequestException(`Unknown action '${action}' for SLA policies.`);
  }
}
