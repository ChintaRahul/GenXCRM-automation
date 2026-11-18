import { Module } from '@nestjs/common';
import { AutomationRulesModule } from '../automation-rules/automation-rules.module';
import { NurturingModule } from '../nurturing/nurturing.module';
import { QuotationsService } from './quotations.service';
import { QuotationsAdapter } from './quotations.adapter';
import { ApprovalsModule } from '../approvals/approvals.module';
import { MfgActivitiesModule } from '../mfg-activities/mfg-activities.module';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [AutomationRulesModule, ApprovalsModule, MfgActivitiesModule, SlaTimersModule, PdfModule, NurturingModule],
  providers: [QuotationsService, QuotationsAdapter],
  exports: [QuotationsService],
})
export class QuotationsModule {}
