import { Module } from '@nestjs/common';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplatesAdapter } from './document-templates.adapter';

@Module({
  providers: [DocumentTemplatesService, DocumentTemplatesAdapter],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
