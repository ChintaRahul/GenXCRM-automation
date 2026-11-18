import { Module } from '@nestjs/common';
import { AutomationRulesModule } from '../automation-rules/automation-rules.module';
import { NurturingModule } from '../nurturing/nurturing.module';
import { BullModule } from '@nestjs/bull';
import { SlaTimersService } from './sla-timers.service';
import { SlaTimersAdapter } from './sla-timers.adapter';
import { SlaEngineService } from './sla-engine.service';
import { SlaProcessor } from './sla.processor';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AutomationRulesModule, MailModule, NotificationsModule, NurturingModule, BullModule.registerQueue({ name: 'sla' })],
  providers: [SlaTimersService, SlaTimersAdapter, SlaEngineService, SlaProcessor],
  exports: [SlaTimersService, SlaEngineService],
})
export class SlaTimersModule {}
