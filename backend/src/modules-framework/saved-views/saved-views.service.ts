import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { requireOrgId } from '../utils/require-org-id.util';
import type { CreateSavedViewDto } from '../dto/create-saved-view.dto';

export interface SavedViewRecord {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

// A user's private saved filter sets per module list. Always scoped to the caller's org AND user —
// one user's views are never visible to another, even within the same org.
@Injectable()
export class SavedViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(moduleKey: string, caller: AuthUser): Promise<SavedViewRecord[]> {
    const rows = await this.prisma.savedView.findMany({
      where: { orgId: requireOrgId(caller), userId: caller.id, moduleKey },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, filters: r.filtersJson as Record<string, unknown> }));
  }

  // Saving under an existing name replaces that view rather than creating a duplicate.
  async create(moduleKey: string, dto: CreateSavedViewDto, caller: AuthUser): Promise<SavedViewRecord> {
    const orgId = requireOrgId(caller);
    const filtersJson = dto.filters as Prisma.InputJsonObject;
    const existing = await this.prisma.savedView.findFirst({
      where: { orgId, userId: caller.id, moduleKey, name: dto.name },
    });
    const row = existing
      ? await this.prisma.savedView.update({ where: { id: existing.id }, data: { filtersJson } })
      : await this.prisma.savedView.create({ data: { orgId, userId: caller.id, moduleKey, name: dto.name, filtersJson } });
    return { id: row.id, name: row.name, filters: row.filtersJson as Record<string, unknown> };
  }

  async remove(moduleKey: string, id: string, caller: AuthUser): Promise<void> {
    const { count } = await this.prisma.savedView.deleteMany({
      where: { id, orgId: requireOrgId(caller), userId: caller.id, moduleKey },
    });
    if (count === 0) throw new NotFoundException(`Saved view '${id}' not found.`);
  }
}
