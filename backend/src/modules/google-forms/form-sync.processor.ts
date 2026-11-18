import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { FormSyncService } from './form-sync.service';

// A single repeatable "tick" pulls new Google Form responses for every connected form.
@Processor('form-sync')
export class FormSyncProcessor implements OnModuleInit {
  private readonly logger = new Logger(FormSyncProcessor.name);

  constructor(
    @InjectQueue('form-sync') private readonly queue: Queue,
    private readonly sync: FormSyncService,
  ) {}

  async onModuleInit() {
    const every = Number(process.env.FORM_SYNC_TICK_MS) || 120_000;
    // Fixed jobId keeps a single repeatable schedule across restarts.
    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every },
        jobId: 'form-sync-tick',
        removeOnComplete: true,
        // Retrying a periodic tick only overlaps the next one; failed forms are retried on the next tick anyway.
        attempts: 1,
      },
    );
  }

  @Process('tick')
  async handleTick() {
    await this.sync.syncAllActive();
  }

  @OnQueueFailed()
  handleFailed(job: Job, err: Error) {
    this.logger.error(`Form sync tick ${job.id} failed: ${err.message}`);
  }
}
