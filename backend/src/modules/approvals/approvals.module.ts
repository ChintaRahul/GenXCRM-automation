import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsAdapter } from './approvals.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';

@Module({
  imports: [SlaTimersModule],
  providers: [ApprovalsService, ApprovalsAdapter],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
