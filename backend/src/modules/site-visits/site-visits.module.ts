import { Module } from '@nestjs/common';
import { SiteVisitsService } from './site-visits.service';
import { SiteVisitsAdapter } from './site-visits.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [SlaTimersModule, PdfModule],
  providers: [SiteVisitsService, SiteVisitsAdapter],
  exports: [SiteVisitsService],
})
export class SiteVisitsModule {}
