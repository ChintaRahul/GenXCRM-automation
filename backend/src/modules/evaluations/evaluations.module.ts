import { Module } from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';
import { EvaluationsAdapter } from './evaluations.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [SlaTimersModule],
  providers: [EvaluationsService, EvaluationsAdapter],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
