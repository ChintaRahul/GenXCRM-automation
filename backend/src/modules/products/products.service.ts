import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { maskRestrictedFields, maskRestrictedFieldsMany } from '../../modules-framework/utils/field-permission.util';
import type { CreateProductDto } from './dto/create-product.dto';
import type { UpdateProductDto } from './dto/update-product.dto';

const MODULE_KEY = 'products';
const LIST_FILTERS = {
  moduleKey: 'products',
  valueField: 'price',
  facetFields: ['category', 'uom', 'gstRate'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['model', 'category', 'price', 'createdAt'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[] }> = {
  Deactivate: { to: 'Inactive', when: ['Active'] },
  Activate: { to: 'Active', when: ['Inactive'] },
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // Products carry no ownerId — org scoping is the only tier that applies (same
  // simplification as Contacts in Phase 3a).
  private scopeFilter(caller: AuthUser): Prisma.ProductWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  private async baseWhere(query: ModuleListQuery, caller: AuthUser): Promise<Prisma.ProductWhereInput> {
    return {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.search
        ? { OR: [{ model: { contains: query.search, mode: 'insensitive' } }, { sku: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
  }

  async getFacets(query: ModuleListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.product as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.ProductWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
    };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await maskRestrictedFieldsMany(rows, MODULE_KEY, caller, this.prisma);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.product.findFirst({
      where: { id, ...this.scopeFilter(caller), isDeleted: false },
      include: { attrs: { select: { name: true, value: true } } },
    });
    if (!record) throw new NotFoundException(`Product '${id}' not found.`);
    return maskRestrictedFields(record, MODULE_KEY, caller, this.prisma);
  }

  async create(dto: CreateProductDto, caller: AuthUser) {
    return this.prisma.product.create({ data: { ...dto, orgId: requireOrgId(caller), status: 'Active' } });
  }

  async update(id: string, dto: UpdateProductDto, caller: AuthUser) {
    await this.findOne(id, caller);
    const { attrs, ...rest } = dto;
    await this.prisma.$transaction([
      this.prisma.product.update({ where: { id }, data: rest }),
      ...(attrs
        ? [
            this.prisma.productAttribute.deleteMany({ where: { productId: id } }),
            this.prisma.productAttribute.createMany({ data: attrs.map((attr) => ({ ...attr, productId: id })) }),
          ]
        : []),
    ]);
    return this.findOne(id, caller);
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.product.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, _payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for products.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a product in status '${record.status}'.`);
    }
    return this.prisma.product.update({ where: { id }, data: { status: transition.to } });
  }
}
