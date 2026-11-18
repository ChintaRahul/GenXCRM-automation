import { Module } from '@nestjs/common';
import { AutomationRulesModule } from '../automation-rules/automation-rules.module';
import { ServiceTicketsService } from './service-tickets.service';
import { ServiceTicketsAdapter } from './service-tickets.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [AutomationRulesModule, SlaTimersModule],
  providers: [ServiceTicketsService, ServiceTicketsAdapter],
  exports: [ServiceTicketsService],
})
export class ServiceTicketsModule {}
