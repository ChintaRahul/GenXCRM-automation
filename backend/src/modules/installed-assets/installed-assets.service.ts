import { BadRequestException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateInstalledAssetDto } from './dto/create-installed-asset.dto';
import type { UpdateInstalledAssetDto } from './dto/update-installed-asset.dto';

const LIST_FILTERS = {
  moduleKey: 'assets',
  dateField: 'installedOn',
  facetFields: ['customerSignoff'],
} satisfies ModuleFilterConfig;
const COVERAGE_STATUSES = ['Under warranty', 'Under AMC', 'Out of coverage', 'Decommissioned'];
const SORTABLE_FIELDS = ['serial', 'status', 'createdAt'];

const SPECIAL_ACTIONS = new Set(['Raise service ticket', 'Create AMC renewal']);

export interface InstalledAssetListQuery extends ModuleListQuery {
  accountId?: string;
  salesOrderId?: string;
}

@Injectable()
export class InstalledAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  // InstalledAsset has no ownerId column — org-only scoping for every role (matches Dispatch in Phase 3c).
  private scopeFilter(caller: AuthUser): Prisma.InstalledAssetWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  private async baseWhere(query: InstalledAssetListQuery, caller: AuthUser): Promise<Prisma.InstalledAssetWhereInput> {
    return {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.search ? { serial: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async getFacets(query: InstalledAssetListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.installedAsset as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: InstalledAssetListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.InstalledAssetWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, data] = await Promise.all([
      this.prisma.installedAsset.count({ where }),
      this.prisma.installedAsset.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.installedAsset.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Installed asset '${id}' not found.`);
    return record;
  }

  private async assertAccountInOrg(accountId: string, caller: AuthUser): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '' } });
    if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
  }

  private async assertSalesOrderInOrg(salesOrderId: string, caller: AuthUser): Promise<void> {
    const salesOrder = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, orgId: caller.orgId ?? '' } });
    if (!salesOrder) throw new BadRequestException(`Sales order '${salesOrderId}' not found in your organization.`);
  }

  async create(dto: CreateInstalledAssetDto, caller: AuthUser) {
    await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.salesOrderId) await this.assertSalesOrderInOrg(dto.salesOrderId, caller);
    return this.prisma.installedAsset.create({
      data: {
        ...dto,
        ...(dto.installedOn ? { installedOn: new Date(dto.installedOn) } : {}),
        ...(dto.commissionedOn ? { commissionedOn: new Date(dto.commissionedOn) } : {}),
        ...(dto.warrantyStart ? { warrantyStart: new Date(dto.warrantyStart) } : {}),
        ...(dto.warrantyEnd ? { warrantyEnd: new Date(dto.warrantyEnd) } : {}),
        orgId: requireOrgId(caller),
        status: 'Under warranty',
      },
    });
  }

  async update(id: string, dto: UpdateInstalledAssetDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.accountId) await this.assertAccountInOrg(dto.accountId, caller);
    if (dto.salesOrderId) await this.assertSalesOrderInOrg(dto.salesOrderId, caller);
    return this.prisma.installedAsset.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.installedOn ? { installedOn: new Date(dto.installedOn) } : {}),
        ...(dto.commissionedOn ? { commissionedOn: new Date(dto.commissionedOn) } : {}),
        ...(dto.warrantyStart ? { warrantyStart: new Date(dto.warrantyStart) } : {}),
        ...(dto.warrantyEnd ? { warrantyEnd: new Date(dto.warrantyEnd) } : {}),
      },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.installedAsset.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser): Promise<Record<string, unknown>> {
    if (SPECIAL_ACTIONS.has(action)) throw new NotImplementedException(`'${action}' is not yet implemented.`);
    await this.findOne(id, caller);
    // Manual override of the coverage status the hourly sweep otherwise derives (e.g. to decommission an asset).
    if (action === 'Set coverage status') {
      const status = String(payload?.status ?? '').trim();
      if (!COVERAGE_STATUSES.includes(status)) throw new BadRequestException(`'${status}' is not a valid coverage status.`);
      return this.prisma.installedAsset.update({ where: { id }, data: { status } });
    }
    throw new BadRequestException(`Unknown action '${action}' for installed assets.`);
  }
}
