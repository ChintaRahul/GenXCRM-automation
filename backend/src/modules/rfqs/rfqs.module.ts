import { Module } from '@nestjs/common';
import { RfqsService } from './rfqs.service';
import { RfqsAdapter } from './rfqs.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SlaTimersModule, NotificationsModule],
  providers: [RfqsService, RfqsAdapter],
  exports: [RfqsService],
})
export class RfqsModule {}
