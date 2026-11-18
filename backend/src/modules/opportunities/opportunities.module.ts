import { Module } from '@nestjs/common';
import { AutomationRulesModule } from '../automation-rules/automation-rules.module';
import { NurturingModule } from '../nurturing/nurturing.module';
import { OpportunitiesService } from './opportunities.service';
import { OpportunitiesAdapter } from './opportunities.adapter';
import { MfgActivitiesModule } from '../mfg-activities/mfg-activities.module';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { ContactsModule } from '../contacts/contacts.module';
import { RfqsModule } from '../rfqs/rfqs.module';
import { SiteVisitsModule } from '../site-visits/site-visits.module';
import { EvaluationsModule } from '../evaluations/evaluations.module';
import { CostingSheetsModule } from '../costing-sheets/costing-sheets.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';

@Module({
  imports: [
    AutomationRulesModule,
    NurturingModule,
    MfgActivitiesModule,
    SlaTimersModule,
    ContactsModule,
    RfqsModule,
    SiteVisitsModule,
    EvaluationsModule,
    CostingSheetsModule,
    QuotationsModule,
    PurchaseOrdersModule,
  ],
  providers: [OpportunitiesService, OpportunitiesAdapter],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
