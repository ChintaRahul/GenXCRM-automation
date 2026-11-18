import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import type { CreateDocumentTemplateDto } from './dto/create-document-template.dto';
import type { UpdateDocumentTemplateDto } from './dto/update-document-template.dto';

const SORTABLE_FIELDS = ['name', 'createdAt'];

@Injectable()
export class DocumentTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(caller: AuthUser): Prisma.DocumentTemplateWhereInput {
    return caller.orgId ? { orgId: caller.orgId } : {};
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.DocumentTemplateWhereInput = {
      ...this.scopeFilter(caller),
      isDeleted: false,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.documentTemplate.count({ where }),
      this.prisma.documentTemplate.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.documentTemplate.findFirst({ where: { id, ...this.scopeFilter(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`Document template '${id}' not found.`);
    return record;
  }

  async create(dto: CreateDocumentTemplateDto, caller: AuthUser) {
    return this.prisma.documentTemplate.create({ data: { ...dto, orgId: requireOrgId(caller) } });
  }

  async update(id: string, dto: UpdateDocumentTemplateDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.documentTemplate.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.documentTemplate.update({ where: { id }, data: { isDeleted: true } });
  }
}
