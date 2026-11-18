import { Module } from '@nestjs/common';
import { CostingSheetsService } from './costing-sheets.service';
import { CostingSheetsAdapter } from './costing-sheets.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [SlaTimersModule],
  providers: [CostingSheetsService, CostingSheetsAdapter],
  exports: [CostingSheetsService],
})
export class CostingSheetsModule {}
