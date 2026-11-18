import { Module } from '@nestjs/common';
import { MasterValuesService } from './master-values.service';
import { MasterValuesAdapter } from './master-values.adapter';

@Module({
  providers: [MasterValuesService, MasterValuesAdapter],
  exports: [MasterValuesService],
})
export class MasterValuesModule {}
