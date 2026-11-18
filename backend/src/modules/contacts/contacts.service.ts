import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';

const LIST_FILTERS = {
  moduleKey: 'contacts',
  facetFields: ['department', 'channel', 'role', 'influence'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['name', 'role', 'status', 'createdAt'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[] }> = {
  'Mark inactive': { to: 'Inactive', when: ['Active'] },
  Reactivate: { to: 'Active', when: ['Inactive'] },
};

export interface ContactListQuery extends ModuleListQuery {
  accountId?: string;
}

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  // Contacts carry no ownerId of their own — they belong to an Account — so a Sales Rep sees the
  // contacts of the accounts they own (the same rule AccountsService applies), everyone else the org.
  private async scopeFilter(caller: AuthUser): Promise<Prisma.ContactWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    const { ownerId } = (await resolveOwnerScope(this.prisma, caller, 'contacts')) as { ownerId?: string | { in: string[] } };
    return ownerId === undefined ? orgFilter : { ...orgFilter, account: { ownerId } };
  }

  private async baseWhere(query: ContactListQuery, caller: AuthUser): Promise<Prisma.ContactWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async getFacets(query: ContactListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.contact as unknown as FacetDelegate, (await this.baseWhere(query, caller)), caller, LIST_FILTERS);
  }

  async findAll(query: ContactListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');

    const where: Prisma.ContactWhereInput = {
      ...((await this.baseWhere(query, caller))),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };

    const [total, data] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.contact.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Contact '${id}' not found.`);
    return record;
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  // The same phone or email on the same account is the same person.
  private async assertNotDuplicate(
    dto: { accountId?: string; phone?: string; email?: string },
    caller: AuthUser,
    existing?: { id: string; accountId: string },
  ): Promise<void> {
    const accountId = dto.accountId ?? existing?.accountId;
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    if (!accountId || (!phone && !email)) return;
    const clash = await this.prisma.contact.findFirst({
      where: {
        orgId: requireOrgId(caller),
        accountId,
        isDeleted: false,
        ...(existing ? { id: { not: existing.id } } : {}),
        OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])],
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new ConflictException(`This account already has a contact with the same phone or email: ${clash.name} (C-${clash.id.replace(/-/g, '').slice(0, 6).toUpperCase()}).`);
    }
  }

  // A contact's plant must be one of its own account's plants.
  private async assertPlantOnAccount(plant: string | undefined, accountId: string): Promise<void> {
    if (!plant) return;
    const found = await this.prisma.plant.findFirst({ where: { accountId, name: plant } });
    if (!found) throw new BadRequestException(`'${plant}' is not a plant of this account. Add it on the account's Plants tab first.`);
  }

  async create(dto: CreateContactDto, caller: AuthUser) {
    await this.assertAccountInOrg(dto.accountId, caller);
    await this.assertPlantOnAccount(dto.plant, dto.accountId);
    await this.assertNotDuplicate(dto, caller);
    return this.prisma.contact.create({ data: { ...dto, orgId: requireOrgId(caller), status: 'Active' } });
  }

  async update(id: string, dto: UpdateContactDto, caller: AuthUser) {
    const existing = await this.findOne(id, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.plant || dto.accountId) await this.assertPlantOnAccount(dto.plant ?? existing.plant ?? undefined, dto.accountId ?? existing.accountId);
    if (dto.phone || dto.email || dto.accountId) await this.assertNotDuplicate({ phone: dto.phone, email: dto.email, accountId: dto.accountId }, caller, existing);
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.contact.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for contacts.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a contact in status '${record.status}'.`);
    }
    return this.prisma.contact.update({ where: { id }, data: { status: transition.to } });
  }

  // Opportunities this contact is the buyer on, limited to what the caller may see.
  async findOpportunities(id: string, query: { page: number; limit: number }, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    await this.findOne(id, caller);
    const where: Prisma.OpportunityWhereInput = {
      ...(caller.orgId ? { orgId: caller.orgId } : {}),
      ...(await resolveOwnerScope(this.prisma, caller, 'opps')),
      isDeleted: false,
      contactId: id,
    };
    const [total, data] = await Promise.all([
      this.prisma.opportunity.count({ where }),
      this.prisma.opportunity.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: 'desc' } }),
    ]);
    return { data, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
  }
}
