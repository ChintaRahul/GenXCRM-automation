import { Module } from '@nestjs/common';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRulesAdapter } from './automation-rules.adapter';
import { AutomationEngineService } from './automation-engine.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [AutomationRulesService, AutomationRulesAdapter, AutomationEngineService],
  exports: [AutomationRulesService, AutomationEngineService],
})
export class AutomationRulesModule {}
