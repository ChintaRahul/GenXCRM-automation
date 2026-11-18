import { Module } from '@nestjs/common';
import { AutomationRulesModule } from '../automation-rules/automation-rules.module';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersAdapter } from './purchase-orders.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AutomationRulesModule, SlaTimersModule, NotificationsModule],
  providers: [PurchaseOrdersService, PurchaseOrdersAdapter],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
