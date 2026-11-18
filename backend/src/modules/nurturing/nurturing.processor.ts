import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { NurturingService } from './nurturing.service';
import { MfgNurturingService } from './mfg-nurturing.service';

// Drives nurturing sequences forward. A single repeatable "tick" job fires on an
// interval (NURTURING_TICK_MS, default 5 min) and advances every due enrollment.
@Processor('nurturing')
export class NurturingProcessor implements OnModuleInit {
  private readonly logger = new Logger(NurturingProcessor.name);

  constructor(
    @InjectQueue('nurturing') private readonly queue: Queue,
    private readonly nurturing: NurturingService,
    private readonly mfgNurturing: MfgNurturingService,
  ) {}

  async onModuleInit() {
    const every = Number(process.env.NURTURING_TICK_MS) || 300_000;
    // Fixed jobId keeps a single repeatable schedule across restarts.
    await this.queue.add('tick', {}, { repeat: { every }, jobId: 'nurturing-tick', removeOnComplete: true });
  }

  @Process('tick')
  async handleTick() {
    await this.nurturing.executeDueEnrollments();
    await this.mfgNurturing.executeDue();
  }

  @OnQueueFailed()
  handleFailed(job: Job, err: Error) {
    this.logger.error(`Nurturing tick job ${job.id} failed: ${err.message}`);
  }
}
