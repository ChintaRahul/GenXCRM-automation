import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CommType, IntegrationProvider } from '@prisma/client';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../common/crypto.utils', () => ({
  decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')),
}));

const mockPrisma = {
  lead: { findFirst: jest.fn(), update: jest.fn() },
  communication: { create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  orgIntegration: { findUnique: jest.fn(), findMany: jest.fn() },
  whatsAppGlobalConversation: { findUnique: jest.fn() },
};

const matchedLead = { id: 'lead-1', phone: '919876543210' };
const orgId = 'org-1';

describe('WhatsappWebhookService', () => {
  let service: WhatsappWebhookService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [WhatsappWebhookService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(WhatsappWebhookService);
  });

  // ── verifyWebhook ───────────────────────────────────────────────────────────

  describe('verifyWebhook', () => {
    it(`returns the challenge when mode=subscribe and token matches the org's stored verifyToken`, async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ metadata: { verifyToken: 'vtok-1' } });
      await expect(service.verifyWebhook(orgId, 'subscribe', 'vtok-1', 'ch-abc')).resolves.toBe('ch-abc');
      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
        }),
      );
    });

    it('returns null when the token does not match', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ metadata: { verifyToken: 'vtok-1' } });
      await expect(service.verifyWebhook(orgId, 'subscribe', 'wrong', 'ch-abc')).resolves.toBeNull();
    });

    it('returns null when the org has no WhatsApp integration', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.verifyWebhook(orgId, 'subscribe', 'vtok-1', 'ch-abc')).resolves.toBeNull();
    });

    it('returns null when mode is not subscribe', async () => {
      await expect(service.verifyWebhook(orgId, 'unsubscribe', 'vtok-1', 'ch-abc')).resolves.toBeNull();
      expect(mockPrisma.orgIntegration.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── verifySignature ─────────────────────────────────────────────────────────

  describe('verifySignature', () => {
    it('returns false when the org has no stored webhook secret (never connected)', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
      await expect(service.verifySignature(orgId, 'body', 'sha256=anything')).resolves.toBe(false);
    });

    it(`returns true for a valid HMAC-SHA256 signature computed with the org's own secret`, async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'enc:test-secret' });
      const body = 'test-body';
      const sig = `sha256=${crypto.createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
      await expect(service.verifySignature(orgId, body, sig)).resolves.toBe(true);
    });

    it('returns false for an incorrect signature of the correct length', async () => {
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'enc:test-secret' });
      const badSig = `sha256=${'0'.repeat(64)}`;
      await expect(service.verifySignature(orgId, 'test-body', badSig)).resolves.toBe(false);
    });

    it('returns false (not a raw 500) when decrypting the stored webhookSecret throws', async () => {
      const { decryptToken } = jest.requireMock('../../common/crypto.utils');
      decryptToken.mockImplementationOnce(() => {
        throw new Error('bad decrypt');
      });
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({ webhookSecret: 'enc:test-secret' });
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.verifySignature(orgId, 'test-body', 'sha256=anything')).resolves.toBe(false);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(orgId), expect.any(String));
      errorSpy.mockRestore();
    });
  });

  // ── processEvent — inbound messages ─────────────────────────────────────────

  describe('processEvent — inbound messages', () => {
    it('creates an inbound Communication row scoped to orgId when the sender matches a lead phone', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(matchedLead);
      mockPrisma.lead.update.mockResolvedValue(matchedLead);
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });

      service.processEvent(orgId, {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [{ from: '919876543210', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId, isDeleted: false, phone: { endsWith: '9876543210' } }),
        }),
      );
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 'lead-1',
            type: CommType.WHATSAPP,
            direction: 'inbound',
            body: 'Hi',
            externalId: 'wamid.1',
          }),
        }),
      );
    });

    it('skips a message whose sender matches no lead in this org', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      service.processEvent(orgId, {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [{ from: '910000000000', id: 'wamid.2', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.communication.create).not.toHaveBeenCalled();
    });

    it('ignores changes where field is not "messages"', () => {
      service.processEvent(orgId, {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-1', changes: [{ field: 'other', value: { messaging_product: 'whatsapp' } }] }],
      });
      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });

    it('handles an empty entry array without throwing', () => {
      expect(() => service.processEvent(orgId, { object: 'whatsapp_business_account', entry: [] })).not.toThrow();
    });
  });

  // ── processEvent — status updates ───────────────────────────────────────────

  describe('processEvent — status updates', () => {
    it(`updates the matching Communication row status by externalId, scoped to this org's leads`, async () => {
      mockPrisma.communication.updateMany.mockResolvedValue({ count: 1 });

      service.processEvent(orgId, {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1', recipient_id: '919876543210' }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.communication.updateMany).toHaveBeenCalledWith({
        where: { externalId: 'wamid.1', lead: { orgId } },
        data: { status: 'delivered' },
      });
    });

    it('captures the failure reason from a failed status update into metadata, preserving existing fields', async () => {
      mockPrisma.communication.findFirst.mockResolvedValue({
        id: 'comm-1',
        metadata: { sentBy: 'user-1' },
      });

      service.processEvent(orgId, {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [
                    {
                      id: 'wamid.2',
                      status: 'failed',
                      timestamp: '1',
                      recipient_id: '919876543210',
                      errors: [{ code: 131047, title: 'Re-engagement message', message: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.communication.findFirst).toHaveBeenCalledWith({
        where: { externalId: 'wamid.2', lead: { orgId } },
      });
      expect(mockPrisma.communication.update).toHaveBeenCalledWith({
        where: { id: 'comm-1' },
        data: {
          status: 'failed',
          metadata: {
            sentBy: 'user-1',
            error: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
          },
        },
      });
      expect(mockPrisma.communication.updateMany).not.toHaveBeenCalled();
    });

    it('logs and skips when a failed status update matches no known message', async () => {
      mockPrisma.communication.findFirst.mockResolvedValue(null);

      service.processEvent(orgId, {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [
                    {
                      id: 'wamid.3',
                      status: 'failed',
                      timestamp: '1',
                      recipient_id: '919876543210',
                      errors: [{ code: 131047, title: 'Re-engagement message' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.communication.update).not.toHaveBeenCalled();
    });
  });

  // ── processEmbeddedSignupEvent ──────────────────────────────────────────────

  describe('processEmbeddedSignupEvent', () => {
    const embeddedOrgIntegration = {
      orgId: 'org-embedded-1',
      metadata: { businessAccountId: 'enc:waba-1', connectMethod: 'EMBEDDED_SIGNUP' },
    };
    const manualOrgIntegration = {
      orgId: 'org-manual-1',
      metadata: { verifyToken: 'vtok', businessAccountId: 'enc:waba-9' }, // no connectMethod → manual-paste row
    };

    it('resolves the org by decrypting businessAccountId and processes inbound messages for it', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([embeddedOrgIntegration, manualOrgIntegration]);
      mockPrisma.lead.findFirst.mockResolvedValue(matchedLead);
      mockPrisma.lead.update.mockResolvedValue(matchedLead);
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });

      await service.processEmbeddedSignupEvent({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [{ from: '919876543210', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-embedded-1' }) }),
      );
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-1' }) }),
      );
    });

    it('skips an event whose WABA id matches no connected embedded-signup org', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([manualOrgIntegration]);

      await service.processEmbeddedSignupEvent({
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-unknown', changes: [] }],
      });

      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });

    it('ignores manual-paste rows (no connectMethod: EMBEDDED_SIGNUP) even if the WABA id would match', async () => {
      mockPrisma.orgIntegration.findMany.mockResolvedValue([
        { orgId: 'org-manual-1', metadata: { businessAccountId: 'enc:waba-1' } },
      ]);

      await service.processEmbeddedSignupEvent({
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-1', changes: [] }],
      });

      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── processEmbeddedSignupEvent — shared global-fallback WABA ────────────────

  describe('processEmbeddedSignupEvent — global fallback WABA', () => {
    const globalWabaId = 'global-waba-9';

    beforeEach(() => {
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = globalWabaId;
    });

    afterEach(() => {
      delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    });

    it('routes an inbound message via WhatsAppGlobalConversation instead of per-org resolution', async () => {
      mockPrisma.whatsAppGlobalConversation.findUnique.mockResolvedValue({
        phone: '9876543210',
        orgId: 'org-fallback-1',
        leadId: 'lead-fallback-1',
      });
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });

      await service.processEmbeddedSignupEvent({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: globalWabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [{ from: '919876543210', id: 'wamid.g1', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.orgIntegration.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.whatsAppGlobalConversation.findUnique).toHaveBeenCalledWith({
        where: { phone: '9876543210' },
      });
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-fallback-1', externalId: 'wamid.g1' }) }),
      );
    });

    it('skips an inbound message whose phone matches no tracked global conversation', async () => {
      mockPrisma.whatsAppGlobalConversation.findUnique.mockResolvedValue(null);

      await service.processEmbeddedSignupEvent({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: globalWabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [{ from: '910000000000', id: 'wamid.g2', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.communication.create).not.toHaveBeenCalled();
    });

    it('updates a status by externalId with no org filter (unscoped, since Meta message ids are globally unique)', async () => {
      mockPrisma.communication.updateMany.mockResolvedValue({ count: 1 });

      await service.processEmbeddedSignupEvent({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: globalWabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [{ id: 'wamid.g3', status: 'delivered', timestamp: '1', recipient_id: '919876543210' }],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrisma.communication.updateMany).toHaveBeenCalledWith({
        where: { externalId: 'wamid.g3' },
        data: { status: 'delivered' },
      });
    });
  });
});
