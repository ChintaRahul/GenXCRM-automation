import { Module } from '@nestjs/common';
import { MfgActivitiesService } from './mfg-activities.service';
import { MfgActivitiesAdapter } from './mfg-activities.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [SlaTimersModule],
  providers: [MfgActivitiesService, MfgActivitiesAdapter],
  exports: [MfgActivitiesService],
})
export class MfgActivitiesModule {}
