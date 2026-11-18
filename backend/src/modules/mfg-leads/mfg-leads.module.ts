import { Module } from '@nestjs/common';
import { AutomationRulesModule } from '../automation-rules/automation-rules.module';
import { NurturingModule } from '../nurturing/nurturing.module';
import { MfgLeadsService } from './mfg-leads.service';
import { MfgLeadsAdapter } from './mfg-leads.adapter';
import { MfgActivitiesModule } from '../mfg-activities/mfg-activities.module';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [AutomationRulesModule, MfgActivitiesModule, SlaTimersModule, NurturingModule],
  providers: [MfgLeadsService, MfgLeadsAdapter],
  exports: [MfgLeadsService],
})
export class MfgLeadsModule {}
