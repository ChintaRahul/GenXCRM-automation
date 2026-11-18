import { Module } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrdersAdapter } from './sales-orders.adapter';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentMilestonesModule } from '../payment-milestones/payment-milestones.module';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { InstalledAssetsModule } from '../installed-assets/installed-assets.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [DispatchModule, PaymentMilestonesModule, SlaTimersModule, InstalledAssetsModule, PdfModule],
  providers: [SalesOrdersService, SalesOrdersAdapter],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
