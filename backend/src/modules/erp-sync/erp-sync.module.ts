import { Module } from '@nestjs/common';
import { ErpSyncService } from './erp-sync.service';
import { ErpSyncAdapter } from './erp-sync.adapter';

@Module({
  providers: [ErpSyncService, ErpSyncAdapter],
  exports: [ErpSyncService],
})
export class ErpSyncModule {}
