import { Global, Module } from '@nestjs/common';
import { ModuleRegistryService } from './module-registry.service';
import { ModulesController } from './modules.controller';
import { SavedViewsService } from './saved-views/saved-views.service';
import { ColumnPrefsService } from './column-prefs/column-prefs.service';
import { ModuleAuditService } from './module-audit/module-audit.service';
import { ModuleDocumentsService } from './module-documents/module-documents.service';
import { StorageModule } from '../modules/storage/storage.module';

@Global()
@Module({
  imports: [StorageModule],
  providers: [ModuleRegistryService, SavedViewsService, ColumnPrefsService, ModuleAuditService, ModuleDocumentsService],
  controllers: [ModulesController],
  exports: [ModuleRegistryService],
})
export class ModulesFrameworkModule {}
