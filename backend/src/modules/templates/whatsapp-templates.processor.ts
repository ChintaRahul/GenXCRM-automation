import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { TemplatesService } from './templates.service';

// Polls Meta for WhatsApp template approval results. A single repeatable "tick" job fires on an
// interval (WHATSAPP_TEMPLATE_SYNC_MS, default 24h — template approval takes hours, not minutes,
// and this now fans out to every connected org's own WABA, so it stays infrequent) and refreshes
// every PENDING template. The "Refresh status" button in the UI covers the need-it-now case.
@Processor('whatsapp-templates')
export class WhatsappTemplatesProcessor implements OnModuleInit {
  private readonly logger = new Logger(WhatsappTemplatesProcessor.name);

  constructor(
    @InjectQueue('whatsapp-templates') private readonly queue: Queue,
    private readonly templates: TemplatesService,
  ) {}

  async onModuleInit() {
    const every = Number(process.env.WHATSAPP_TEMPLATE_SYNC_MS) || 86_400_000;
    // Fixed jobId keeps a single repeatable schedule across restarts.
    await this.queue.add('tick', {}, { repeat: { every }, jobId: 'wa-template-sync', removeOnComplete: true });
  }

  @Process('tick')
  async handleTick() {
    await this.templates.syncPendingStatuses();
  }

  @OnQueueFailed()
  handleFailed(job: Job, err: Error) {
    this.logger.error(`WhatsApp template sync job ${job.id} failed: ${err.message}`);
  }
}
