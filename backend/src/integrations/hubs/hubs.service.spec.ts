import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WorkspaceType } from '@prisma/client';
import { MfgLeadsService } from '../../modules/mfg-leads/mfg-leads.service';
import { WebhookService } from '../webhook/webhook.service';
import { HubsService } from './hubs.service';

describe('HubsService', () => {
  let service: HubsService;
  const mfgLeads = { ingest: jest.fn() };
  const webhook = { ingestLead: jest.fn() };
  const body = { RESPONSE: { UNIQUE_QUERY_ID: '1', SENDER_NAME: 'A', SENDER_MOBILE: '9876543210', QUERY_PRODUCT_NAME: 'Conveyor' } };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [HubsService, { provide: MfgLeadsService, useValue: mfgLeads }, { provide: WebhookService, useValue: webhook }],
    }).compile();
    service = module.get(HubsService);
  });

  it('creates a manufacturing lead scoped to the org with IndiaMART as source', async () => {
    mfgLeads.ingest.mockResolvedValue({ id: 'l1' });
    const result = await service.ingest('indiamart', body, 'org-1', WorkspaceType.MANUFACTURING);
    expect(result).toEqual({ received: 1, created: 1, duplicates: 0, skipped: 0 });
    expect(mfgLeads.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'IndiaMART', external_id: 'indiamart:1' }),
      'org-1',
      { freeTextProduct: true },
    );
  });

  it('counts a repeated enquiry as a duplicate', async () => {
    mfgLeads.ingest.mockResolvedValue({ duplicate: true, leadId: 'l1' });
    expect((await service.ingest('indiamart', body, 'org-1', WorkspaceType.MANUFACTURING)).duplicates).toBe(1);
  });

  it('skips an unusable enquiry instead of failing the call', async () => {
    mfgLeads.ingest.mockRejectedValue(new BadRequestException('name and phone are required.'));
    expect((await service.ingest('indiamart', body, 'org-1', WorkspaceType.MANUFACTURING)).skipped).toBe(1);
  });

  it('sends education workspaces through the standard lead path', async () => {
    webhook.ingestLead.mockResolvedValue({ id: 'l2' });
    await service.ingest('tradeindia', body, 'org-2', WorkspaceType.EDTECH);
    expect(webhook.ingestLead).toHaveBeenCalledWith(expect.objectContaining({ phone: '9876543210' }), 'org-2');
    expect(mfgLeads.ingest).not.toHaveBeenCalled();
  });
});
