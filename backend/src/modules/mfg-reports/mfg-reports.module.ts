import { Module } from '@nestjs/common';
import { MfgReportsService } from './mfg-reports.service';
import { MfgReportsAdapter } from './mfg-reports.adapter';
import { PdfModule } from '../pdf/pdf.module';
import { MailModule } from '../mail/mail.module';
import { MfgReportDeliveryService } from './mfg-report-delivery.service';

@Module({
  imports: [PdfModule, MailModule],
  providers: [MfgReportsService, MfgReportsAdapter, MfgReportDeliveryService],
  exports: [MfgReportsService],
})
export class MfgReportsModule {}
