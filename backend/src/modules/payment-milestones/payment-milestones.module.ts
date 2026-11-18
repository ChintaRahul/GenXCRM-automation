import { Module } from '@nestjs/common';
import { PaymentMilestonesService } from './payment-milestones.service';
import { PaymentMilestonesAdapter } from './payment-milestones.adapter';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [SlaTimersModule, MailModule],
  providers: [PaymentMilestonesService, PaymentMilestonesAdapter],
  exports: [PaymentMilestonesService],
})
export class PaymentMilestonesModule {}
