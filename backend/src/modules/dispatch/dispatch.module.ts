import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { DispatchAdapter } from './dispatch.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SlaTimersModule, NotificationsModule],
  providers: [DispatchService, DispatchAdapter],
  exports: [DispatchService],
})
export class DispatchModule {}
