import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { requireOrgId } from '../utils/require-org-id.util';

// Server-maintained or derived fields: their changes are noise, not user edits.
const IGNORED_FIELDS: ReadonlySet<string> = new Set(['id', 'orgId', 'createdAt', 'updatedAt', 'isDeleted', 'sla', 'age']);
const LIST_LIMIT = 200;

export interface AuditEntryView {
  id: string;
  at: string;
  user: string;
  field: string;
  oldValue: string;
  newValue: string;
}

const display = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// Field-level change history for manufacturing module records. Written centrally from the
// modules controller after each update / action / archive, so every module gets an audit trail
// without per-adapter code. Always scoped to the caller's org.
@Injectable()
export class ModuleAuditService {
  private readonly logger = new Logger(ModuleAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Diffs two snapshots of the same record and stores one row per changed field. An audit
  // failure must never undo or block the edit that triggered it, so errors are logged and swallowed.
  async recordChanges(
    moduleKey: string,
    recordId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    caller: AuthUser,
  ): Promise<void> {
    try {
      const orgId = requireOrgId(caller);
      const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
      const data = [...fields]
        .filter((field) => !IGNORED_FIELDS.has(field))
        .map((field) => ({ field, oldValue: display(before[field]), newValue: display(after[field]) }))
        .filter(({ oldValue, newValue }) => oldValue !== newValue)
        .map((change) => ({ orgId, userId: caller.id, moduleKey, recordId, ...change }));
      if (data.length > 0) await this.prisma.moduleAuditEntry.createMany({ data });
    } catch (err) {
      this.logger.error(`Could not record audit entries for ${moduleKey}/${recordId}`, err instanceof Error ? err.stack : undefined);
    }
  }

  async list(moduleKey: string, recordId: string, caller: AuthUser): Promise<AuditEntryView[]> {
    const rows = await this.prisma.moduleAuditEntry.findMany({
      where: { orgId: requireOrgId(caller), moduleKey, recordId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      user: r.user.name,
      field: r.field,
      oldValue: r.oldValue ?? '—',
      newValue: r.newValue ?? '—',
    }));
  }
}
