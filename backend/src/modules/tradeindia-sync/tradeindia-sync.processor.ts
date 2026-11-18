import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { TradeIndiaSyncService } from './tradeindia-sync.service';

// Off unless TRADEINDIA_POLL_ENABLED=true: the TradeIndia request format is still unverified.
@Processor('tradeindia-sync')
export class TradeIndiaSyncProcessor implements OnModuleInit {
  private readonly logger = new Logger(TradeIndiaSyncProcessor.name);

  constructor(
    @InjectQueue('tradeindia-sync') private readonly queue: Queue,
    private readonly sync: TradeIndiaSyncService,
  ) {}

  async onModuleInit() {
    if (process.env.TRADEINDIA_POLL_ENABLED !== 'true') return;
    const every = Number(process.env.TRADEINDIA_POLL_MS) || 900_000;
    await this.queue.add('poll', {}, { repeat: { every }, jobId: 'tradeindia-poll', removeOnComplete: true });
  }

  @Process('poll')
  async handlePoll() {
    await this.sync.syncAll();
  }

  @OnQueueFailed()
  handleFailed(job: Job, err: Error) {
    this.logger.error(`TradeIndia poll job ${job.id} failed: ${err.message}`);
  }
}
