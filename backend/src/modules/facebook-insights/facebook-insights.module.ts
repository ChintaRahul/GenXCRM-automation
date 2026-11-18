import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { FacebookInsightsService } from './facebook-insights.service';
import { FacebookInsightsProcessor } from './facebook-insights.processor';
import { FacebookInsightsController } from './facebook-insights.controller';

const DAILY_SYNC_CRON = '0 3 * * *'; // 3 AM UTC — low-traffic window

@Module({
  imports: [BullModule.registerQueue({ name: 'facebook-insights' })],
  controllers: [FacebookInsightsController],
  providers: [FacebookInsightsService, FacebookInsightsProcessor],
  exports: [FacebookInsightsService],
})
export class FacebookInsightsModule implements OnModuleInit {
  constructor(@InjectQueue('facebook-insights') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Idempotent: Bull dedupes repeatable jobs with the same name+cron+data, so this
    // is safe to run on every app boot without stacking duplicate schedules.
    await this.queue.add('sync-all', {}, { repeat: { cron: DAILY_SYNC_CRON }, attempts: 3 });
  }
}
