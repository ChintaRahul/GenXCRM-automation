import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStage, type StageConfig } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { MANDATORY_STAGES, MAX_CUSTOM_STAGES, type StageColor } from '../../common/constants/lead.constants';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { LEAD_STAGE_DEFAULTS, LEAD_STAGE_ORDER } from './lead-stage-defaults';
import type { CreateStageDto } from './dto/create-stage.dto';
import type { UpdateStageDto } from './dto/update-stage.dto';

export interface StageView {
  key: string;
  id: string | null;
  label: string;
  color: StageColor;
  sortOrder: number;
  isHidden: boolean;
  mandatory: boolean;
  isCustom: boolean;
  countsAs: LeadStage | null;
}

const isBuiltInKey = (key: string): key is LeadStage => key in LEAD_STAGE_DEFAULTS;

@Injectable()
export class LeadStagesService {
  constructor(private readonly prisma: PrismaService) {}

  private buildViews(rows: StageConfig[]): StageView[] {
    const overrides = new Map<LeadStage, StageConfig>();
    for (const r of rows) if (r.baseStage) overrides.set(r.baseStage, r);
    const builtIns = LEAD_STAGE_ORDER.map((stage, i): StageView => {
      const override = overrides.get(stage);
      const defaults = LEAD_STAGE_DEFAULTS[stage];
      return {
        key: stage,
        id: override?.id ?? null,
        label: override?.label ?? defaults.label,
        color: (override?.color as StageColor | undefined) ?? defaults.color,
        sortOrder: override?.sortOrder ?? (i + 1) * 10,
        isHidden: override?.isHidden ?? false,
        mandatory: MANDATORY_STAGES.includes(stage),
        isCustom: false,
        countsAs: null,
      };
    });
    const customs = rows
      .filter((r) => !r.baseStage)
      .map(
        (r): StageView => ({
          key: r.id,
          id: r.id,
          label: r.label,
          color: r.color as StageColor,
          sortOrder: r.sortOrder,
          isHidden: r.isHidden,
          mandatory: false,
          isCustom: true,
          countsAs: r.countsAs,
        }),
      );
    return [...builtIns, ...customs].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  private loadRows(orgId: string) {
    return this.prisma.stageConfig.findMany({ where: { orgId } });
  }

  private assertLabelFree(views: StageView[], label: string, exceptKey?: string) {
    const wanted = label.trim().toLowerCase();
    if (views.some((v) => v.key !== exceptKey && v.label.trim().toLowerCase() === wanted)) {
      throw new ConflictException(`A stage named '${label}' already exists.`);
    }
  }

  async list(caller: AuthUser, includeHidden: boolean): Promise<StageView[]> {
    const rows = await this.loadRows(requireOrgId(caller));
    const views = this.buildViews(rows);
    return includeHidden ? views : views.filter((v) => !v.isHidden);
  }

  async create(dto: CreateStageDto, caller: AuthUser): Promise<StageView> {
    const orgId = requireOrgId(caller);
    const rows = await this.loadRows(orgId);
    if (rows.filter((r) => !r.baseStage).length >= MAX_CUSTOM_STAGES) {
      throw new BadRequestException(`You can have at most ${MAX_CUSTOM_STAGES} custom stages.`);
    }
    const views = this.buildViews(rows);
    this.assertLabelFree(views, dto.label);
    const sortOrder = Math.max(0, ...views.map((v) => v.sortOrder)) + 10;
    const created = await this.prisma.stageConfig.create({
      data: { orgId, label: dto.label.trim(), color: dto.color, countsAs: dto.countsAs, sortOrder },
    });
    return this.buildViews([created]).find((v) => v.key === created.id) as StageView;
  }

  async update(key: string, dto: UpdateStageDto, caller: AuthUser): Promise<StageView> {
    const orgId = requireOrgId(caller);
    const rows = await this.loadRows(orgId);
    const views = this.buildViews(rows);
    if (dto.label !== undefined) this.assertLabelFree(views, dto.label, key);

    if (isBuiltInKey(key)) {
      if (dto.countsAs !== undefined) throw new BadRequestException('Only custom stages can set what they count as.');
      if (dto.isHidden && MANDATORY_STAGES.includes(key)) {
        throw new BadRequestException(`'${LEAD_STAGE_DEFAULTS[key].label}' is required and cannot be hidden.`);
      }
      const current = views.find((v) => v.key === key) as StageView;
      const fields = {
        label: dto.label?.trim() ?? current.label,
        color: dto.color ?? current.color,
        isHidden: dto.isHidden ?? current.isHidden,
      };
      const row = await this.prisma.stageConfig.upsert({
        where: { orgId_baseStage: { orgId, baseStage: key } },
        create: { orgId, baseStage: key, sortOrder: current.sortOrder, ...fields },
        update: fields,
      });
      return this.buildViews([row]).find((v) => v.key === key) as StageView;
    }

    const existing = rows.find((r) => r.id === key && !r.baseStage);
    if (!existing) throw new NotFoundException(`Stage '${key}' not found.`);
    const row = await this.prisma.stageConfig.update({
      where: { id: key },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.isHidden !== undefined ? { isHidden: dto.isHidden } : {}),
        ...(dto.countsAs !== undefined ? { countsAs: dto.countsAs } : {}),
      },
    });
    return this.buildViews([row]).find((v) => v.key === key) as StageView;
  }

  async reorder(keys: string[], caller: AuthUser): Promise<StageView[]> {
    const orgId = requireOrgId(caller);
    const rows = await this.loadRows(orgId);
    const known = new Set(this.buildViews(rows).map((v) => v.key));
    const unknown = keys.find((k) => !known.has(k));
    if (unknown) throw new NotFoundException(`Stage '${unknown}' not found.`);
    if (new Set(keys).size !== keys.length || keys.length !== known.size) {
      throw new BadRequestException('Provide every stage exactly once to reorder.');
    }
    await this.prisma.$transaction(
      keys.map((key, i) => {
        const sortOrder = (i + 1) * 10;
        if (isBuiltInKey(key)) {
          const { label, color } = LEAD_STAGE_DEFAULTS[key];
          return this.prisma.stageConfig.upsert({
            where: { orgId_baseStage: { orgId, baseStage: key } },
            create: { orgId, baseStage: key, label, color, sortOrder },
            update: { sortOrder },
          });
        }
        return this.prisma.stageConfig.update({ where: { id: key }, data: { sortOrder } });
      }),
    );
    return this.list(caller, true);
  }

  async remove(id: string, caller: AuthUser): Promise<void> {
    const orgId = requireOrgId(caller);
    const row = await this.prisma.stageConfig.findFirst({ where: { id, orgId } });
    if (!row) throw new NotFoundException(`Stage '${id}' not found.`);
    if (row.baseStage) throw new BadRequestException('Built-in stages cannot be deleted. Hide them instead.');
    await this.prisma.$transaction([
      this.prisma.lead.updateMany({ where: { orgId, customStageId: id }, data: { customStageId: null } }),
      this.prisma.stageConfig.delete({ where: { id } }),
    ]);
  }
}
