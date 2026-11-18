import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { requireOrgId } from '../utils/require-org-id.util';

// A user's own chosen list columns per module. Scoped to org AND user — never shared.
@Injectable()
export class ColumnPrefsService {
  constructor(private readonly prisma: PrismaService) {}

  // null means "no choice saved yet" (the list falls back to the module's default columns).
  async get(moduleKey: string, caller: AuthUser): Promise<string[] | null> {
    const row = await this.prisma.moduleColumnPref.findFirst({
      where: { orgId: requireOrgId(caller), userId: caller.id, moduleKey },
    });
    return row ? (row.keys as string[]) : null;
  }

  async save(moduleKey: string, keys: string[], caller: AuthUser): Promise<void> {
    const orgId = requireOrgId(caller);
    await this.prisma.moduleColumnPref.upsert({
      where: { orgId_userId_moduleKey: { orgId, userId: caller.id, moduleKey } },
      create: { orgId, userId: caller.id, moduleKey, keys: keys as Prisma.InputJsonArray },
      update: { keys: keys as Prisma.InputJsonArray },
    });
  }
}
