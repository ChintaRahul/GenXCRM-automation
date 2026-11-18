import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import type { ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { CreatePlantDto } from './dto/create-plant.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';

const LIST_FILTERS = {
  moduleKey: 'accounts',
  ownerField: 'ownerId',
  valueField: 'potential',
  facetFields: ['type', 'industry', 'territory', 'source'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['name', 'short', 'territory', 'potential', 'createdAt'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[] }> = {
  'Mark dormant': { to: 'Dormant', when: ['Active', 'On hold'] },
  Reactivate: { to: 'Active', when: ['Dormant', 'On hold'] },
};

// "Shree Steel Pvt. Ltd." and "Shree Steel Private Limited" are the same company.
const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?|corporation|corp\.?)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private async scopeFilter(caller: AuthUser): Promise<Prisma.AccountWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, 'accounts')) };
  }

  private async baseWhere(query: ModuleListQuery, caller: AuthUser): Promise<Prisma.AccountWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { short: { contains: query.search, mode: 'insensitive' } },
              { gstin: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async getFacets(query: ModuleListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.account as unknown as FacetDelegate, (await this.baseWhere(query, caller)), caller, LIST_FILTERS);
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');

    const where: Prisma.AccountWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };

    const [total, data] = await Promise.all([
      this.prisma.account.count({ where }),
      this.prisma.account.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.account.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Account '${id}' not found.`);
    return record;
  }

  private async assertNotDuplicate(dto: { name?: string; gstin?: string }, caller: AuthUser, excludeId?: string) {
    const gstin = dto.gstin?.trim().toUpperCase();
    const name = dto.name ? normalizeName(dto.name) : '';
    if (!gstin && !name) return;
    const candidates = await this.prisma.account.findMany({
      where: { orgId: requireOrgId(caller), isDeleted: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true, gstin: true },
    });
    const clash = candidates.find((a) => (gstin && a.gstin?.toUpperCase() === gstin) || (name && normalizeName(a.name) === name));
    if (clash) {
      throw new ConflictException(`An account with the same ${gstin && clash.gstin?.toUpperCase() === gstin ? 'GSTIN' : 'name'} already exists: ${clash.name} (A-${clash.id.replace(/-/g, '').slice(0, 6).toUpperCase()}).`);
    }
  }

  async create(dto: CreateAccountDto, caller: AuthUser) {
    await this.assertNotDuplicate(dto, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, 'accounts')) ? (dto.ownerId ?? caller.id) : caller.id;
    return this.prisma.account.create({ data: { ...dto, ownerId, orgId: requireOrgId(caller), status: 'Active' } });
  }

  async update(id: string, dto: UpdateAccountDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.name || dto.gstin) await this.assertNotDuplicate(dto, caller, id);
    return this.prisma.account.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.account.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    if (action === 'Reassign owner') return this.reassignOwner(id, payload?.owner, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for accounts.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} an account in status '${record.status}'.`);
    }
    return this.prisma.account.update({ where: { id }, data: { status: transition.to } });
  }

  private async reassignOwner(id: string, owner: unknown, caller: AuthUser) {
    if (typeof owner !== 'string' || !owner) throw new BadRequestException(`'owner' is required to Reassign owner.`);
    const target = await this.prisma.user.findFirst({ where: { id: owner, orgId: requireOrgId(caller) }, select: { id: true } });
    if (!target) throw new BadRequestException(`User '${owner}' not found in your organization.`);
    return this.prisma.account.update({ where: { id }, data: { ownerId: target.id } });
  }

  async getPlantsTable(id: string, caller: AuthUser): Promise<ModuleTableResult> {
    const account = await this.findOne(id, caller);
    const plants = await this.prisma.plant.findMany({ where: { accountId: id } });
    return {
      columns: [
        { key: 'name', label: 'Plant', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'city', label: 'City', type: 'text' },
        { key: 'address', label: 'Address', type: 'text' },
        { key: 'territory', label: 'Territory', type: 'text' },
      ],
      rows: plants.map((p) => ({ id: p.id, name: p.name, type: p.type, city: p.city, address: p.address, territory: account.territory })),
    };
  }

  async addPlant(id: string, dto: CreatePlantDto, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    const name = dto.name.trim();
    const clash = await this.prisma.plant.findFirst({ where: { accountId: id, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new ConflictException(`This account already has a plant called '${clash.name}'.`);
    await this.prisma.plant.create({ data: { accountId: id, name, type: dto.type, city: dto.city.trim(), ...(dto.address?.trim() ? { address: dto.address.trim() } : {}) } });
  }

  async removePlant(id: string, plantId: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    const plant = await this.prisma.plant.findFirst({ where: { id: plantId, accountId: id } });
    if (!plant) throw new NotFoundException(`Plant '${plantId}' not found on this account.`);
    await this.prisma.plant.delete({ where: { id: plantId } });
  }
}
