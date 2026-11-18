import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { SlaEngineService } from './sla-engine.service';

// Recomputes every open SlaTimer's state (ON_TRACK/AT_RISK/BREACHED) and fires any newly
// crossed escalation level, on a fixed interval. Mirrors nurturing.processor.ts's pattern.
@Processor('sla')
export class SlaProcessor implements OnModuleInit {
  private readonly logger = new Logger(SlaProcessor.name);

  constructor(
    @InjectQueue('sla') private readonly queue: Queue,
    private readonly slaEngine: SlaEngineService,
  ) {}

  async onModuleInit() {
    const every = Number(process.env.SLA_TICK_MS) || 300_000;
    await this.queue.add('tick', {}, { repeat: { every }, jobId: 'sla-tick', removeOnComplete: true });
    const sweepEvery = Number(process.env.SLA_DATE_SWEEP_MS) || 3_600_000;
    await this.queue.add('date-sweep', {}, { repeat: { every: sweepEvery }, jobId: 'sla-date-sweep', removeOnComplete: true });
  }

  @Process('tick')
  async handleTick() {
    await this.slaEngine.tick();
  }

  @Process('date-sweep')
  async handleDateSweep() {
    await this.slaEngine.runDateTriggeredSweep();
  }

  @OnQueueFailed()
  handleFailed(job: Job, err: Error) {
    this.logger.error(`SLA tick job ${job.id} failed: ${err.message}`);
  }
}
