import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';
import { ORDERABLE_CORE_FIELD_KEYS, resolveOrgFields } from '../../common/utils/field-mapping.util';
import type { BackfillLeadsDto } from './dto/backfill-leads.dto';

const BATCH_SIZE = 500;
const MAX_LEADS = 20000;

export interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
}

@Injectable()
export class LeadBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}

  // Re-applies the org's *current* Field Mappings to each lead's stored original answers
  // (Lead.rawFields, saved at ingestion from every source). Fill-only-empty: a value a rep
  // or an earlier ingestion already set is never overwritten.
  async backfill(dto: BackfillLeadsDto, caller: AuthUser): Promise<BackfillResult> {
    const { orgId } = caller;
    if (!orgId) throw new BadRequestException(ErrorMessages.integrations.unknownOrg);

    const mapping = await this.organizations.getFieldMappingsForOrg(orgId);
    const selected = new Set(dto.fields ?? [...ORDERABLE_CORE_FIELD_KEYS, ...mapping.customFieldDefs.map((d) => d.id)]);
    const where: Prisma.LeadWhereInput = {
      orgId,
      isDeleted: false,
      rawFields: { not: Prisma.DbNull },
      ...(dto.sources?.length && { source: { in: dto.sources } }),
    };

    const result: BackfillResult = { scanned: 0, updated: 0, skipped: 0 };
    let cursor: string | undefined;

    while (result.scanned < MAX_LEADS) {
      const leads = await this.prisma.lead.findMany({
        where,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: {
          id: true,
          rawFields: true,
          altPhone: true,
          course: true,
          location: true,
          language: true,
          tags: true,
          customFields: true,
        },
      });
      if (leads.length === 0) break;
      cursor = leads.at(-1)?.id;

      const updates: Prisma.PrismaPromise<unknown>[] = [];
      for (const lead of leads) {
        result.scanned += 1;
        const { core, customFields } = resolveOrgFields(lead.rawFields as Record<string, string>, mapping);
        const data: Prisma.LeadUpdateInput = {};
        for (const key of ['altPhone', 'course', 'location', 'language'] as const) {
          if (selected.has(key) && !lead[key] && core[key]) data[key] = core[key];
        }
        if (selected.has('tags') && !lead.tags.length && core.tags) {
          data.tags = core.tags.split(',').map((t) => t.trim()).filter(Boolean);
        }
        const existing = (lead.customFields as Record<string, string> | null) ?? {};
        const added = Object.fromEntries(
          Object.entries(customFields).filter(([id]) => selected.has(id) && !existing[id]),
        );
        if (Object.keys(added).length) data.customFields = { ...existing, ...added };

        if (Object.keys(data).length === 0) {
          result.skipped += 1;
          continue;
        }
        result.updated += 1;
        updates.push(this.prisma.lead.update({ where: { id: lead.id }, data }));
      }
      if (updates.length) await this.prisma.$transaction(updates);
      if (leads.length < BATCH_SIZE) break;
    }
    return result;
  }
}
