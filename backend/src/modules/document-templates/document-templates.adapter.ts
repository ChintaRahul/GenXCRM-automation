import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { DocumentTemplatesService } from './document-templates.service';
import { CreateDocumentTemplateDto } from './dto/create-document-template.dto';
import { UpdateDocumentTemplateDto } from './dto/update-document-template.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class DocumentTemplatesAdapter implements ModuleAdapter {
  constructor(private readonly documentTemplates: DocumentTemplatesService, registry: ModuleRegistryService) {
    registry.register('docTemplates', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.documentTemplates.findAll(query, caller);
  }
  findOne(id: string, caller: AuthUser) {
    return this.documentTemplates.findOne(id, caller);
  }
  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.documentTemplates.create(await validateBody(CreateDocumentTemplateDto, dto), caller);
  }
  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.documentTemplates.update(id, await validateBody(UpdateDocumentTemplateDto, dto), caller);
  }
  archive(id: string, caller: AuthUser) {
    return this.documentTemplates.archive(id, caller);
  }
}
