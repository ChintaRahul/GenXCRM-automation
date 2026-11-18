import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import axios from 'axios';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { FacebookLeadBackfillService } from './facebook-lead-backfill.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FacebookService } from '../../integrations/facebook/facebook.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../common/crypto.utils', () => ({
  decryptToken: jest.fn((ciphertext: string) => `decrypted-${ciphertext}`),
}));

const mockPrisma = {
  orgIntegration: { findUnique: jest.fn(), update: jest.fn() },
};
const mockFacebook = { ingestLead: jest.fn().mockResolvedValue({ id: 'lead-1' }) };
const mockQueue = { add: jest.fn() };

const baseIntegration = {
  orgId: 'org-1',
  provider: IntegrationProvider.FACEBOOK,
  status: IntegrationStatus.CONNECTED,
  accessToken: 'enc-token',
  metadata: null,
};

describe('FacebookLeadBackfillService', () => {
  let service: FacebookLeadBackfillService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        FacebookLeadBackfillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FacebookService, useValue: mockFacebook },
        { provide: getQueueToken('facebook-lead-backfill'), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(FacebookLeadBackfillService);
  });

  describe('enqueueBackfill', () => {
    it('adds a retryable backfill job with the org, page, and since window', async () => {
      const since = new Date('2026-08-01T00:00:00Z');
      await service.enqueueBackfill('org-1', 'page-1', since);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'backfill',
        { orgId: 'org-1', pageId: 'page-1', since: since.toISOString() },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    });
  });

  describe('runBackfill', () => {
    it('throws when the org has no Facebook token on file', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ ...baseIntegration, accessToken: null });
      await expect(service.runBackfill('org-1', 'page-1', new Date())).rejects.toThrow();
    });

    it('walks every lead form, ingests leads newer than `since`, and stops once older leads appear', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(baseIntegration);
      const since = new Date('2026-08-01T00:00:00Z');

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('leadgen_forms')) {
          return Promise.resolve({ data: { data: [{ id: 'form-1' }] } });
        }
        if (url.includes('/form-1/leads') || url.endsWith('/form-1/leads')) {
          return Promise.resolve({
            data: {
              data: [
                {
                  id: 'leadgen-new',
                  created_time: '2026-08-05T00:00:00Z',
                  field_data: [
                    { name: 'full_name', values: ['New Lead'] },
                    { name: 'phone_number', values: ['9876543210'] },
                  ],
                },
                {
                  id: 'leadgen-old',
                  created_time: '2026-07-01T00:00:00Z',
                  field_data: [
                    { name: 'full_name', values: ['Old Lead'] },
                    { name: 'phone_number', values: ['1112223333'] },
                  ],
                },
              ],
            },
          });
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });

      const result = await service.runBackfill('org-1', 'page-1', since);

      expect(result.leadsProcessed).toBe(1);
      expect(mockFacebook.ingestLead).toHaveBeenCalledTimes(1);
      expect(mockFacebook.ingestLead).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Lead', phone: '9876543210' }),
        'org-1',
      );
      expect(mockPrisma.orgIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.FACEBOOK } },
          data: expect.objectContaining({
            disconnectedAt: null,
            metadata: expect.objectContaining({ lastBackfill: expect.objectContaining({ leadsProcessed: 1 }) }),
          }),
        }),
      );
    });

    it('retries once after a rate-limit error (80004) instead of failing the backfill', async () => {
      jest.useFakeTimers();
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(baseIntegration);
      const since = new Date('2026-08-01T00:00:00Z');
      let formsCallCount = 0;

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('leadgen_forms')) {
          formsCallCount += 1;
          if (formsCallCount === 1) {
            const rateLimitErr = Object.assign(new Error('rate limited'), {
              isAxiosError: true,
              response: { data: { error: { code: 80004 } } },
            });
            return Promise.reject(rateLimitErr);
          }
          return Promise.resolve({ data: { data: [] } });
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });
      mockedAxios.isAxiosError.mockImplementation((err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true);

      const resultPromise = service.runBackfill('org-1', 'page-1', since);
      await jest.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;

      expect(formsCallCount).toBe(2);
      expect(result.leadsProcessed).toBe(0);
      jest.useRealTimers();
    });

    it('skips leads with no phone field', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(baseIntegration);
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('leadgen_forms')) {
          return Promise.resolve({ data: { data: [{ id: 'form-1' }] } });
        }
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'leadgen-nophone',
                created_time: '2026-08-05T00:00:00Z',
                field_data: [{ name: 'full_name', values: ['No Phone'] }],
              },
            ],
          },
        });
      });

      const result = await service.runBackfill('org-1', 'page-1', new Date('2026-08-01T00:00:00Z'));

      expect(result.leadsProcessed).toBe(0);
      expect(mockFacebook.ingestLead).not.toHaveBeenCalled();
    });
  });
});
