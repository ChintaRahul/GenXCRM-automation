import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { FacebookLeadBackfillService, BackfillJobData } from './facebook-lead-backfill.service';

@Processor('facebook-lead-backfill')
export class FacebookLeadBackfillProcessor {
  private readonly logger = new Logger(FacebookLeadBackfillProcessor.name);

  constructor(private readonly backfill: FacebookLeadBackfillService) {}

  @Process('backfill')
  async handleBackfill(job: Job<BackfillJobData>) {
    const { orgId, pageId, since } = job.data;
    await this.backfill.runBackfill(orgId, pageId, new Date(since));
  }

  @OnQueueFailed()
  handleFailed(job: Job<BackfillJobData>, err: Error) {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // will be retried, not terminal yet

    this.logger.error(
      `Facebook lead backfill failed for orgId=${job.data.orgId} after ${job.attemptsMade} attempts: ${err.message}`,
    );
  }
}
