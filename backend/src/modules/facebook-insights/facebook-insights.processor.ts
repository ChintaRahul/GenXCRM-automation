import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { FacebookInsightsService } from './facebook-insights.service';

type SyncOrgJobData = { orgId: string };

@Processor('facebook-insights')
export class FacebookInsightsProcessor {
  private readonly logger = new Logger(FacebookInsightsProcessor.name);

  constructor(private readonly insights: FacebookInsightsService) {}

  @Process('sync-org')
  async handleSyncOrg(job: Job<SyncOrgJobData>) {
    await this.insights.syncOrg(job.data.orgId);
  }

  @Process('sync-all')
  async handleSyncAll() {
    await this.insights.enqueueSyncAllOrgs();
  }

  @OnQueueFailed()
  handleFailed(job: Job<SyncOrgJobData>, err: Error) {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // will be retried, not terminal yet

    this.logger.error(
      `Facebook Insights sync failed for orgId=${job.data.orgId} after ${job.attemptsMade} attempts: ${err.message}`,
    );
  }
}
