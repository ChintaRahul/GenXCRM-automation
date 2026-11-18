import { Module } from '@nestjs/common';
import { SlaPoliciesService } from './sla-policies.service';
import { SlaPoliciesAdapter } from './sla-policies.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [SlaTimersModule],
  providers: [SlaPoliciesService, SlaPoliciesAdapter],
  exports: [SlaPoliciesService],
})
export class SlaPoliciesModule {}
