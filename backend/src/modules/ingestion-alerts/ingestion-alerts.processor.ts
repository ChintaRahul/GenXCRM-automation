import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { IngestionAlertsService } from './ingestion-alerts.service';

// A repeatable "tick" job (INGESTION_ALERT_TICK_MS, default 5 min) sends the digest for any
// org whose 8h alert window has elapsed while failures were waiting.
@Processor('ingestion-alerts')
export class IngestionAlertsProcessor implements OnModuleInit {
  private readonly logger = new Logger(IngestionAlertsProcessor.name);

  constructor(
    @InjectQueue('ingestion-alerts') private readonly queue: Queue,
    private readonly alerts: IngestionAlertsService,
  ) {}

  async onModuleInit() {
    const every = Number(process.env.INGESTION_ALERT_TICK_MS) || 300_000;
    await this.queue.add('tick', {}, { repeat: { every }, jobId: 'ingestion-alerts-tick', removeOnComplete: true });
  }

  @Process('tick')
  async handleTick() {
    await this.alerts.sendDueDigests();
  }

  @OnQueueFailed()
  handleFailed(job: Job, err: Error) {
    this.logger.error(`Ingestion-alerts tick job ${job.id} failed: ${err.message}`);
  }
}
