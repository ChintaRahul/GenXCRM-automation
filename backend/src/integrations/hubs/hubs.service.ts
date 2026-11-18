import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WorkspaceType } from '@prisma/client';
import { MfgLeadsService } from '../../modules/mfg-leads/mfg-leads.service';
import { WebhookService } from '../webhook/webhook.service';
import { HUBS, mapEnquiry, unwrapEnquiries, type HubSlug } from './hubs.util';

export interface HubIngestResult {
  received: number;
  created: number;
  duplicates: number;
  skipped: number;
}

@Injectable()
export class HubsService {
  private readonly logger = new Logger(HubsService.name);

  constructor(
    private readonly mfgLeads: MfgLeadsService,
    private readonly webhook: WebhookService,
  ) {}

  // One call may carry several enquiries. An enquiry we cannot use (e.g. no phone number) is
  // skipped and counted, never an error: marketplaces retry non-2xx responses forever.
  async ingest(hub: HubSlug, body: unknown, orgId: string, workspaceType: WorkspaceType): Promise<HubIngestResult> {
    const enquiries = unwrapEnquiries(body);
    const result: HubIngestResult = { received: enquiries.length, created: 0, duplicates: 0, skipped: 0 };

    for (const enquiry of enquiries) {
      const { rawProduct: _rawProduct, ...payload } = mapEnquiry(hub, enquiry);
      try {
        const outcome =
          workspaceType === WorkspaceType.MANUFACTURING
            ? await this.mfgLeads.ingest(payload, orgId, { freeTextProduct: true })
            : await this.webhook.ingestLead(
                { name: payload.name ?? '', phone: payload.phone ?? '', email: payload.email, source: HUBS[hub].source },
                orgId,
              );
        if ('error' in outcome) result.skipped += 1;
        else if ('duplicate' in outcome) result.duplicates += 1;
        else result.created += 1;
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
        result.skipped += 1;
        this.logger.warn(`${hub} enquiry skipped for orgId=${orgId}: ${err.message}`);
      }
    }
    return result;
  }
}
