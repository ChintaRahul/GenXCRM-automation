import { Test } from '@nestjs/testing';
import { CommType, CallOutcome, CallRecordingStatus, AttachmentStatus, Role, IntegrationStatus } from '@prisma/client';
import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';
import { FirebaseService, InvalidPushTokenError } from '../../integrations/firebase/firebase.service';
import type { AuthUser } from '../../common/types/auth-user.type';

jest.mock('axios');
jest.mock('../../common/crypto.utils', () => ({ decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')) }));

const mockSesSendEmailPromise = jest.fn().mockResolvedValue({});
const mockSesSendEmail = jest.fn().mockReturnValue({ promise: mockSesSendEmailPromise });
const mockSesSendRawEmailPromise = jest.fn().mockResolvedValue({});
const mockSesSendRawEmail = jest.fn().mockReturnValue({ promise: mockSesSendRawEmailPromise });
jest.mock('aws-sdk', () => ({
  SES: jest.fn().mockImplementation(() => ({ sendEmail: mockSesSendEmail, sendRawEmail: mockSesSendRawEmail })),
}));

const mockTransporterSendMail = jest.fn().mockResolvedValue({});
const mockCreateTransport = jest.fn().mockReturnValue({ sendMail: mockTransporterSendMail });
jest.mock('nodemailer', () => ({ createTransport: (...args: unknown[]) => mockCreateTransport(...args) }));

const mockPrisma = {
  lead: { findUnique: jest.fn(), findFirst: jest.fn() },
  user: { findUnique: jest.fn(), update: jest.fn() },
  communication: { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(), count: jest.fn() },
  activity: { create: jest.fn() },
  callRecording: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  attachment: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  orgIntegration: { findUnique: jest.fn() },
  whatsAppGlobalConversation: { upsert: jest.fn() },
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
};

const mockStorage = {
  buildRecordingKey: jest.fn(
    (leadId: string, recordingId: string, ext: string) => `leads/${leadId}/recordings/${recordingId}.${ext}`,
  ),
  buildAttachmentKey: jest.fn(
    (orgId: string, attachmentId: string, ext: string) => `orgs/${orgId}/attachments/${attachmentId}.${ext}`,
  ),
  getPresignedUploadUrl: jest.fn().mockResolvedValue('https://s3.example.com/upload-url'),
  getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/download-url'),
  getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('file bytes')),
};

const mockBilling = {
  hasEmailQuota: jest.fn().mockResolvedValue(true),
  recordEmailSent: jest.fn().mockResolvedValue(undefined),
  hasWhatsAppQuota: jest.fn().mockResolvedValue(true),
  recordWhatsAppSent: jest.fn().mockResolvedValue(undefined),
};

const mockFirebase = {
  sendCallAlert: jest.fn(),
};

const caller: AuthUser = {
  id: 'rep-1',
  name: 'Rep',
  email: 'rep@t.com',
  role: Role.SALES_REP,
  teamId: 'team-1',
  orgId: 'org-1',
};
const lead = { id: 'lead-1', name: 'John', email: 'john@example.com', phone: '9999999999' };

describe('CommunicationsService', () => {
  let service: CommunicationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.SES_FROM_EMAIL;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);
    mockBilling.hasEmailQuota.mockResolvedValue(true);
    mockBilling.hasWhatsAppQuota.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        CommunicationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: BillingService, useValue: mockBilling },
        { provide: FirebaseService, useValue: mockFirebase },
      ],
    }).compile();
    service = module.get(CommunicationsService);
  });

  describe('sendEmail', () => {
    it('creates a communication record with type EMAIL', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });
      await service.sendEmail('lead-1', 'Subject', 'Body', caller);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: CommType.EMAIL, leadId: 'lead-1' }) }),
      );
    });

    it('sets status to no_email when lead has no email', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, email: null });
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subj', 'Body', caller);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'no_email' }) }),
      );
    });

    it('marks status invalid_email and never calls SES for a malformed address', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genx.com';
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, email: 'not-an-email' });
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subj', 'Body', caller);
      expect(mockSesSendEmail).not.toHaveBeenCalled();
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'invalid_email' }) }),
      );
    });

    it('bumps the lead engagement score only when the email actually sends', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subj', 'Body', caller);
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('does not bump the score when the send fails', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genx.com';
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockSesSendEmailPromise.mockRejectedValueOnce(new Error('down'));
      await service.sendEmail('lead-1', 'Subj', 'Body', caller);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('marks status failed (not sent) when SES throws', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genx.com';
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockSesSendEmailPromise.mockRejectedValueOnce(new Error('Daily message quota exceeded.'));

      await service.sendEmail('lead-1', 'Subj', 'Body', caller);

      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('meters a successful send against the org email quota', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genx.com';
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, orgId: 'org-1' });
      mockPrisma.communication.create.mockResolvedValue({});

      await service.sendEmail('lead-1', 'Subj', 'Body', caller);

      expect(mockBilling.recordEmailSent).toHaveBeenCalledWith('org-1');
    });

    it('skips SES and marks status quota_exceeded when the org has no email quota left', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genx.com';
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, orgId: 'org-1' });
      mockPrisma.communication.create.mockResolvedValue({});
      mockBilling.hasEmailQuota.mockResolvedValue(false);

      await service.sendEmail('lead-1', 'Subj', 'Body', caller);

      expect(mockSesSendEmail).not.toHaveBeenCalled();
      expect(mockBilling.recordEmailSent).not.toHaveBeenCalled();
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'quota_exceeded' }) }),
      );
    });
  });

  describe('sendSms', () => {
    it('creates a communication record with type SMS', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendSms('lead-1', 'Hello', caller);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: CommType.SMS }) }),
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('sendWhatsApp', () => {
    it('records a communication with type WHATSAPP but throws when WhatsApp is not configured', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsApp('lead-1', 'Hi there', caller)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: CommType.WHATSAPP, status: 'not_configured' }),
        }),
      );
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('scopes the lead lookup to the caller org/hierarchy (tenant isolation)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsApp('lead-1', 'Hi there', caller)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'lead-1', orgId: 'org-1', assignedToId: 'rep-1' }),
        }),
      );
    });

    it('does not send when the lead is outside the caller scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsApp('lead-1', 'Hi there', caller)).rejects.toThrow(BadRequestException);
      // lead lookup returned nothing, so no phone was ever read/used regardless of status
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leadId: 'lead-1' }) }),
      );
    });

    describe('with the shared global-fallback number configured', () => {
      beforeEach(() => {
        process.env.WHATSAPP_API_TOKEN = 'wa-test-token';
        process.env.WHATSAPP_PHONE_NUMBER_ID = 'global-phone-id';
      });
      afterEach(() => {
        delete process.env.WHATSAPP_API_TOKEN;
        delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      });

      it('upserts a WhatsAppGlobalConversation row keyed by phone after a successful send', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await service.sendWhatsApp('lead-1', 'Hi there', caller);

        expect(mockPrisma.whatsAppGlobalConversation.upsert).toHaveBeenCalledWith({
          where: { phone: lead.phone },
          create: { phone: lead.phone, orgId: 'org-1', leadId: 'lead-1' },
          update: { orgId: 'org-1', leadId: 'lead-1', lastSentAt: expect.any(Date) },
        });
      });

      it('does not upsert a conversation row when the send fails', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockRejectedValue(new Error('network error'));
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await expect(service.sendWhatsApp('lead-1', 'Hi there', caller)).rejects.toThrow();

        expect(mockPrisma.whatsAppGlobalConversation.upsert).not.toHaveBeenCalled();
      });

      describe('with attachments', () => {
        const pdf = { id: 'att-1', fileName: 'brochure.pdf', mimeType: 'application/pdf', s3Key: 'k/1.pdf' };
        const png = { id: 'att-2', fileName: 'poster.png', mimeType: 'image/png', s3Key: 'k/2.png' };

        it('sends each file as media with the message as the first caption, and stores attachmentIds', async () => {
          const mockedAxios = jest.requireMock('axios');
          mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
          mockPrisma.lead.findFirst.mockResolvedValue(lead);
          mockPrisma.attachment.findMany.mockResolvedValue([pdf, png]);
          mockPrisma.communication.create.mockResolvedValue({});

          await service.sendWhatsApp('lead-1', 'Course details', caller, ['att-1', 'att-2']);

          expect(mockPrisma.attachment.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
          );
          expect(mockedAxios.post).toHaveBeenCalledTimes(2);
          const [, first] = mockedAxios.post.mock.calls[0];
          const [, second] = mockedAxios.post.mock.calls[1];
          expect(first).toMatchObject({
            type: 'document',
            document: { link: 'https://s3.example.com/download-url', caption: 'Course details', filename: 'brochure.pdf' },
          });
          expect(second).toMatchObject({ type: 'image', image: { caption: undefined } });
          expect(mockPrisma.communication.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ status: 'sent', attachmentIds: ['att-1', 'att-2'] }),
            }),
          );
        });

        it('rejects an attachment id that does not resolve, without sending anything', async () => {
          const mockedAxios = jest.requireMock('axios');
          mockedAxios.post = jest.fn();
          mockPrisma.lead.findFirst.mockResolvedValue(lead);
          mockPrisma.attachment.findMany.mockResolvedValue([]);

          await expect(service.sendWhatsApp('lead-1', 'Hi', caller, ['missing'])).rejects.toThrow(BadRequestException);
          expect(mockedAxios.post).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe('sendWhatsAppTemplate', () => {
    it('records a WHATSAPP communication with the template name in metadata', async () => {
      process.env.WHATSAPP_API_TOKEN = 'wa-test-token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'global-phone-id';
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', ['Asha'], caller);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'lead-1', orgId: 'org-1', assignedToId: 'rep-1' }),
        }),
      );
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: CommType.WHATSAPP,
            status: 'sent',
            metadata: expect.objectContaining({ template: 'welcome_offer' }),
          }),
        }),
      );
    });

    it('sets status no_phone, skips the API, and throws when the lead has no phone', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn();
      mockPrisma.lead.findFirst.mockResolvedValue({ ...lead, phone: null });
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', [], caller)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'no_phone' }) }),
      );
    });

    it('throws when the lead has a phone but WhatsApp is not configured', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn();
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', [], caller)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'not_configured' }) }),
      );
    });

    describe('with WhatsApp configured', () => {
      beforeEach(() => {
        process.env.WHATSAPP_API_TOKEN = 'wa-test-token';
        process.env.WHATSAPP_PHONE_NUMBER_ID = 'global-phone-id';
      });
      afterEach(() => {
        delete process.env.WHATSAPP_API_TOKEN;
        delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      });

      it('posts a template payload with body parameters and captures the message id', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.123' }] } });
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', ['Asha', 'MBA'], caller);

        const [, payload] = mockedAxios.post.mock.calls[0];
        expect(payload).toMatchObject({
          to: '919999999999',
          type: 'template',
          template: {
            name: 'welcome_offer',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Asha' },
                  { type: 'text', text: 'MBA' },
                ],
              },
            ],
          },
        });
        expect(mockPrisma.communication.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ externalId: 'wamid.123' }) }),
        );
      });

      it('upserts a WhatsAppGlobalConversation row keyed by phone after a successful template send', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.123' }] } });
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', ['Asha', 'MBA'], caller);

        expect(mockPrisma.whatsAppGlobalConversation.upsert).toHaveBeenCalledWith({
          where: { phone: lead.phone },
          create: { phone: lead.phone, orgId: 'org-1', leadId: 'lead-1' },
          update: { orgId: 'org-1', leadId: 'lead-1', lastSentAt: expect.any(Date) },
        });
      });

      it('omits the body component when there are no params', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await service.sendWhatsAppTemplate('lead-1', 'no_params_template', 'en_US', [], caller);

        const [, payload] = mockedAxios.post.mock.calls[0];
        expect(payload.template.components).toBeUndefined();
      });

      it('checks and meters WhatsApp credits when falling back to the shared/global API', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', ['Asha'], caller);

        expect(mockBilling.hasWhatsAppQuota).toHaveBeenCalledWith('org-1');
        expect(mockBilling.recordWhatsAppSent).toHaveBeenCalledWith('org-1');
      });

      it('blocks the template send with a quota_exceeded status when the shared-API free credit is exhausted', async () => {
        mockBilling.hasWhatsAppQuota.mockResolvedValue(false);
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockResolvedValue({});
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await expect(
          service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', ['Asha'], caller),
        ).rejects.toThrow(BadRequestException);

        expect(mockedAxios.post).not.toHaveBeenCalled();
        expect(mockBilling.recordWhatsAppSent).not.toHaveBeenCalled();
        expect(mockPrisma.communication.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'quota_exceeded' }) }),
        );
      });

      it('rejects hello_world before ever calling Meta — it can only send from the Public Test Number', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn();

        await expect(service.sendWhatsAppTemplate('lead-1', 'hello_world', 'en_US', [], caller)).rejects.toThrow(
          BadRequestException,
        );
        expect(mockedAxios.post).not.toHaveBeenCalled();
        expect(mockPrisma.communication.create).not.toHaveBeenCalled();
      });

      it('sets status failed, still records the communication, and throws on API error', async () => {
        const mockedAxios = jest.requireMock('axios');
        mockedAxios.post = jest.fn().mockRejectedValue(new Error('WhatsApp down'));
        mockPrisma.lead.findFirst.mockResolvedValue(lead);
        mockPrisma.communication.create.mockResolvedValue({});

        await expect(
          service.sendWhatsAppTemplate('lead-1', 'welcome_offer', 'en_US', ['Asha'], caller),
        ).rejects.toThrow(BadGatewayException);
        expect(mockPrisma.communication.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
        );
      });
    });
  });

  describe('logCall', () => {
    it('creates both a communication and an activity record, defaulting outcome to CONNECTED', async () => {
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({ id: 'act-1' });
      await service.logCall('lead-1', 120, 'Discussed course', caller);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: CommType.CALL,
            durationSec: 120,
            callOutcome: CallOutcome.CONNECTED,
            calledById: 'rep-1',
          }),
        }),
      );
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'CALL', userId: 'rep-1' }) }),
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('records NOT_CONNECTED when explicitly passed', async () => {
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({ id: 'act-1' });
      await service.logCall('lead-1', 0, 'No answer', caller, CallOutcome.NOT_CONNECTED);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ callOutcome: CallOutcome.NOT_CONNECTED }) }),
      );
    });

    it('stores an inbound direction when given, and defaults to outbound otherwise', async () => {
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({ id: 'act-1' });

      await service.logCall('lead-1', 30, 'Called back', caller, CallOutcome.CONNECTED, 'inbound');
      expect(mockPrisma.communication.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ direction: 'inbound' }) }),
      );

      await service.logCall('lead-1', 30, 'Called', caller);
      expect(mockPrisma.communication.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ direction: 'outbound' }) }),
      );
    });
  });

  describe('getHistory', () => {
    it('fetches communications ordered by sentAt desc when the lead is in scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.communication.findMany.mockResolvedValue([]);
      await service.getHistory('lead-1', caller);
      expect(mockPrisma.communication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { leadId: 'lead-1' }, orderBy: { sentAt: 'desc' } }),
      );
    });

    it('scopes the lead lookup to assignedToId for SALES_REP', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.communication.findMany.mockResolvedValue([]);
      await service.getHistory('lead-1', caller);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'lead-1', assignedToId: 'rep-1' }) }),
      );
    });

    it('throws NotFoundException when the lead is outside the caller scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.getHistory('lead-1', caller)).rejects.toThrow('This lead could not be found.');
      expect(mockPrisma.communication.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('scopes groupBy to assignedToId for SALES_REP', async () => {
      mockPrisma.communication.groupBy.mockResolvedValue([]);
      await service.getStats(caller);
      expect(mockPrisma.communication.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lead: { orgId: 'org-1', assignedToId: 'rep-1' } } }),
      );
    });

    it('scopes groupBy to teamId for MANAGER', async () => {
      mockPrisma.communication.groupBy.mockResolvedValue([]);
      const manager: AuthUser = { ...caller, role: Role.MANAGER, id: 'mgr-1' };
      await service.getStats(manager);
      expect(mockPrisma.communication.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lead: { orgId: 'org-1', teamId: 'team-1' } } }),
      );
    });

    it('scopes groupBy to orgId only for DIRECTOR', async () => {
      mockPrisma.communication.groupBy.mockResolvedValue([]);
      const director: AuthUser = { ...caller, role: Role.DIRECTOR, id: 'dir-1', teamId: null };
      await service.getStats(director);
      expect(mockPrisma.communication.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lead: { orgId: 'org-1' } } }),
      );
    });

    it('returns grouped type and status counts', async () => {
      const grouped = [{ type: CommType.EMAIL, status: 'sent', _count: { type: 3 } }];
      mockPrisma.communication.groupBy.mockResolvedValue(grouped);
      const result = await service.getStats(caller);
      expect(result).toEqual(grouped);
    });
  });

  describe('getCallLog', () => {
    it('scopes to assignedToId for SALES_REP and filters type CALL', async () => {
      mockPrisma.communication.findMany.mockResolvedValue([]);
      mockPrisma.communication.count.mockResolvedValue(0);
      await service.getCallLog(caller);
      expect(mockPrisma.communication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: CommType.CALL, lead: { orgId: 'org-1', assignedToId: 'rep-1' } },
          orderBy: { sentAt: 'desc' },
        }),
      );
      expect(mockPrisma.communication.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: CommType.CALL, lead: { orgId: 'org-1', assignedToId: 'rep-1' } } }),
      );
    });

    it('scopes to teamId for MANAGER', async () => {
      mockPrisma.communication.findMany.mockResolvedValue([]);
      mockPrisma.communication.count.mockResolvedValue(0);
      const manager: AuthUser = { ...caller, role: Role.MANAGER, id: 'mgr-1' };
      await service.getCallLog(manager);
      expect(mockPrisma.communication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: CommType.CALL, lead: { orgId: 'org-1', teamId: 'team-1' } } }),
      );
    });

    it('paginates using page/limit and returns the computed page count', async () => {
      mockPrisma.communication.findMany.mockResolvedValue([{ id: 'comm-1' }]);
      mockPrisma.communication.count.mockResolvedValue(45);

      const result = await service.getCallLog(caller, 2, 20);

      expect(mockPrisma.communication.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
      expect(result).toEqual({ data: [{ id: 'comm-1' }], total: 45, page: 2, limit: 20, pages: 3 });
    });

    it('includes lead and callRecording relations', async () => {
      mockPrisma.communication.findMany.mockResolvedValue([]);
      mockPrisma.communication.count.mockResolvedValue(0);
      await service.getCallLog(caller);
      expect(mockPrisma.communication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            lead: { select: { id: true, name: true, phone: true } },
            callRecording: { select: { id: true, status: true } },
          },
        }),
      );
    });
  });

  describe('sendEmail with SES configured', () => {
    beforeEach(() => {
      process.env.SES_FROM_EMAIL = 'noreply@genxcrm.co.in';
    });
    afterEach(() => {
      delete process.env.SES_FROM_EMAIL;
    });

    it('calls SES sendEmail when from address and lead email are present', async () => {
      mockSesSendEmailPromise.mockResolvedValue({});
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subject', 'Body', caller);
      expect(mockSesSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          Source: '"GenXCRM" <noreply@genxcrm.co.in>',
          Destination: { ToAddresses: [lead.email] },
          Message: expect.objectContaining({
            Subject: expect.objectContaining({ Data: 'Subject' }),
          }),
        }),
      );
    });

    it('swallows SES errors and still creates communication record', async () => {
      mockSesSendEmailPromise.mockRejectedValue(new Error('SES down'));
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendEmail('lead-1', 'Subject', 'Body', caller)).resolves.toBeDefined();
      expect(mockPrisma.communication.create).toHaveBeenCalled();
    });

    it('does not call SES when lead has no email', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, email: null });
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subject', 'Body', caller);
      expect(mockSesSendEmail).not.toHaveBeenCalled();
    });

    it('sends to both email and altEmail when both are present and distinct', async () => {
      mockSesSendEmailPromise.mockResolvedValue({});
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, altEmail: 'alt@example.com' });
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subject', 'Body', caller);
      expect(mockSesSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          Destination: { ToAddresses: [lead.email, 'alt@example.com'] },
        }),
      );
    });

    it('ignores a malformed altEmail and sends only to the primary email', async () => {
      mockSesSendEmailPromise.mockResolvedValue({});
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, altEmail: 'not-an-email' });
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendEmail('lead-1', 'Subject', 'Body', caller);
      expect(mockSesSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ Destination: { ToAddresses: [lead.email] } }),
      );
    });
  });

  describe('sendEmail with a per-org email integration connected', () => {
    afterEach(() => {
      delete process.env.SES_FROM_EMAIL;
    });

    it('sends through a per-org SMTP transporter, scoped to the lead’s orgId, when connected via SMTP', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, orgId: 'org-1' });
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accessToken: 'enc:smtp-pass',
        accountId: 'smtp-user',
        accountName: 'Acme Academy',
        metadata: { method: 'SMTP', host: 'smtp.gmail.com', port: 587, secure: false, fromEmail: 'sales@acme.com' },
      });

      await service.sendEmail('lead-1', 'Subject', 'Body', caller);

      expect(mockPrisma.orgIntegration.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId_provider: { orgId: 'org-1', provider: 'EMAIL' } } }),
      );
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: { user: 'smtp-user', pass: 'smtp-pass' },
        }),
      );
      expect(mockTransporterSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: '"Acme Academy" <sales@acme.com>', to: lead.email, subject: 'Subject' }),
      );
      expect(mockSesSendEmail).not.toHaveBeenCalled();
    });

    it('sends via SES using the org’s verified custom domain from-address when connected via SES_DOMAIN', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genxcrm.co.in';
      mockPrisma.lead.findUnique.mockResolvedValue({ ...lead, orgId: 'org-1' });
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accessToken: null,
        accountId: 'acme.com',
        accountName: 'Acme Academy',
        metadata: { method: 'SES_DOMAIN', fromEmail: 'sales@acme.com' },
      });

      await service.sendEmail('lead-1', 'Subject', 'Body', caller);

      expect(mockSesSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ Source: '"Acme Academy" <sales@acme.com>' }),
      );
      expect(mockCreateTransport).not.toHaveBeenCalled();
    });

    it('falls back to the shared SES sender when the org’s email integration is not CONNECTED', async () => {
      process.env.SES_FROM_EMAIL = 'noreply@genxcrm.co.in';
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: IntegrationStatus.PENDING,
        accountId: 'acme.com',
        accountName: 'Acme Academy',
        metadata: { method: 'SES_DOMAIN', fromEmail: 'sales@acme.com' },
      });

      await service.sendEmail('lead-1', 'Subject', 'Body', caller);

      expect(mockSesSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ Source: '"GenXCRM" <noreply@genxcrm.co.in>' }),
      );
    });
  });

  describe('sendSms with Twilio configured', () => {
    beforeEach(() => {
      process.env.TWILIO_ACCOUNT_SID = 'twilio-test-sid';
    });
    afterEach(() => {
      delete process.env.TWILIO_ACCOUNT_SID;
    });

    it('calls Twilio API when SID and lead phone are present', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendSms('lead-1', 'Hello', caller);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('formats the bare 10-digit lead phone as E.164 (+91...) for Twilio', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});

      await service.sendSms('lead-1', 'Hello', caller);

      const [, body] = mockedAxios.post.mock.calls[0];
      expect(new URLSearchParams(body).get('To')).toBe('+919999999999');
    });

    it('swallows Twilio errors and still creates communication record', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('Twilio down'));
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendSms('lead-1', 'Hello', caller)).resolves.toBeDefined();
      expect(mockPrisma.communication.create).toHaveBeenCalled();
    });
  });

  describe('sendWhatsApp with WhatsApp configured', () => {
    beforeEach(() => {
      process.env.WHATSAPP_API_TOKEN = 'wa-test-token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'global-phone-id';
    });
    afterEach(() => {
      delete process.env.WHATSAPP_API_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    });

    it('calls WhatsApp API when token and lead phone are present', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await service.sendWhatsApp('lead-1', 'Hi there', caller);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('prepends the India country code to the bare 10-digit lead phone before calling Meta', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.text.1' }] } });
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      const [, payload] = mockedAxios.post.mock.calls[0];
      expect(payload).toMatchObject({ to: '919999999999' });
    });

    it('captures the Meta message id as externalId so status webhooks can match this send', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.text.1' }] } });
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ externalId: 'wamid.text.1' }) }),
      );
    });

    it('records status failed (not sent), stashes the error, and throws when the API rejects', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('WhatsApp down'));
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsApp('lead-1', 'Hi', caller)).rejects.toThrow(BadGatewayException);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            metadata: expect.objectContaining({ error: 'WhatsApp down' }),
          }),
        }),
      );
    });

    // The lead timeline (CommBubble.tsx) renders metadata.error directly to reps — it must
    // never be the raw Meta JSON envelope (an internal, unfriendly blob), only a short reason.
    it('stores a human-readable reason (not raw Meta JSON) when Meta returns a structured error', async () => {
      const mockedAxios = jest.requireMock('axios');
      const axiosError = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: {
          data: {
            error: {
              message: '(#132001) Template name does not exist in the translation',
              code: 132001,
              type: 'OAuthException',
              error_data: {
                messaging_product: 'whatsapp',
                details: 'template name (whatsapp_opt) does not exist in en',
              },
              fbtrace_id: 'AbC123',
            },
          },
        },
      });
      mockedAxios.post = jest.fn().mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      await expect(service.sendWhatsApp('lead-1', 'Hi', caller)).rejects.toThrow(BadGatewayException);
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            metadata: expect.objectContaining({
              error: 'template name (whatsapp_opt) does not exist in en',
            }),
          }),
        }),
      );
    });

    it('prefers the caller’s connected org WABA over the global env var', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        accessToken: 'enc:org-token',
        accountId: 'org-phone-id',
      });

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('org-phone-id'),
        expect.anything(),
        expect.objectContaining({ headers: { Authorization: 'Bearer org-token' } }),
      );
    });

    it('never checks or meters WhatsApp credits when the org uses its own connected WABA', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        accessToken: 'enc:org-token',
        accountId: 'org-phone-id',
      });

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      expect(mockBilling.hasWhatsAppQuota).not.toHaveBeenCalled();
      expect(mockBilling.recordWhatsAppSent).not.toHaveBeenCalled();
    });

    it('checks and meters WhatsApp credits when falling back to the shared/global API', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      expect(mockBilling.hasWhatsAppQuota).toHaveBeenCalledWith('org-1');
      expect(mockBilling.recordWhatsAppSent).toHaveBeenCalledWith('org-1');
    });

    it('blocks the send with a quota_exceeded status when the shared-API free credit is exhausted', async () => {
      mockBilling.hasWhatsAppQuota.mockResolvedValue(false);
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});

      await expect(service.sendWhatsApp('lead-1', 'Hi there', caller)).rejects.toThrow(BadRequestException);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockBilling.recordWhatsAppSent).not.toHaveBeenCalled();
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'quota_exceeded' }) }),
      );
    });

    it('falls back to the global env vars (not_configured -> configured) when decrypting the org token throws', async () => {
      const { decryptToken } = jest.requireMock('../../common/crypto.utils');
      decryptToken.mockImplementationOnce(() => {
        throw new Error('bad decrypt');
      });
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        accessToken: 'enc:org-token',
        accountId: 'org-phone-id',
      });

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('global-phone-id'),
        expect.anything(),
        expect.objectContaining({ headers: { Authorization: 'Bearer wa-test-token' } }),
      );
    });
  });

  describe('sendWhatsApp falls back to env vars when no org WABA is connected', () => {
    beforeEach(() => {
      process.env.WHATSAPP_API_TOKEN = 'wa-test-token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'global-phone-id';
    });
    afterEach(() => {
      delete process.env.WHATSAPP_API_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    });

    it('uses the global env vars when orgIntegration lookup returns null', async () => {
      const mockedAxios = jest.requireMock('axios');
      mockedAxios.post = jest.fn().mockResolvedValue({});
      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.orgIntegration.findUnique.mockResolvedValue(null);

      await service.sendWhatsApp('lead-1', 'Hi there', caller);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('global-phone-id'),
        expect.anything(),
        expect.objectContaining({ headers: { Authorization: 'Bearer wa-test-token' } }),
      );
    });
  });

  describe('initCallRecording', () => {
    it('throws when the lead is not visible to the caller (org/role scoping)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.initCallRecording({ leadId: 'lead-1', mimeType: 'audio/aac' }, caller)).rejects.toThrow();
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', assignedToId: 'rep-1' }) }),
      );
    });

    it('creates a PENDING CallRecording and returns a presigned upload URL', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.callRecording.create.mockResolvedValue({ id: 'rec-1' });

      const result = await service.initCallRecording({ leadId: 'lead-1', mimeType: 'audio/aac' }, caller);

      expect(mockPrisma.callRecording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ leadId: 'lead-1', uploadedById: 'rep-1', mimeType: 'audio/aac' }),
        }),
      );
      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalled();
      expect(result).toEqual({ recordingId: 'rec-1', uploadUrl: 'https://s3.example.com/upload-url' });
    });

    it('accepts common recorder-app formats and maps them to the right S3 key extension', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.callRecording.create.mockResolvedValue({ id: 'rec-1' });

      await service.initCallRecording({ leadId: 'lead-1', mimeType: 'audio/mpeg' }, caller);
      expect(mockStorage.buildRecordingKey).toHaveBeenCalledWith('lead-1', expect.any(String), 'mp3');

      await service.initCallRecording({ leadId: 'lead-1', mimeType: 'audio/wav' }, caller);
      expect(mockStorage.buildRecordingKey).toHaveBeenCalledWith('lead-1', expect.any(String), 'wav');

      await service.initCallRecording({ leadId: 'lead-1', mimeType: 'audio/x-wav' }, caller);
      expect(mockStorage.buildRecordingKey).toHaveBeenCalledWith('lead-1', expect.any(String), 'wav');

      await service.initCallRecording({ leadId: 'lead-1', mimeType: 'audio/x-m4a' }, caller);
      expect(mockStorage.buildRecordingKey).toHaveBeenCalledWith('lead-1', expect.any(String), 'm4a');
    });
  });

  describe('completeCallRecording', () => {
    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
        cb(mockPrisma),
      );
    });

    it('throws when the recording belongs to a lead outside the caller scope', async () => {
      mockPrisma.callRecording.findFirst.mockResolvedValue(null);
      await expect(
        service.completeCallRecording('rec-1', { durationSec: 30, fileSize: 1024 }, caller),
      ).rejects.toThrow();
    });

    it('creates a Communication and flips the recording to UPLOADED, linked together', async () => {
      mockPrisma.callRecording.findFirst.mockResolvedValue({ id: 'rec-1', leadId: 'lead-1' });
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });
      mockPrisma.callRecording.update.mockResolvedValue({
        id: 'rec-1',
        status: CallRecordingStatus.UPLOADED,
        durationSec: 42,
      });

      const result = await service.completeCallRecording('rec-1', { durationSec: 42, fileSize: 2048 }, caller);

      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ leadId: 'lead-1', type: CommType.CALL, calledById: 'rep-1' }),
        }),
      );
      expect(mockPrisma.callRecording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({
            status: CallRecordingStatus.UPLOADED,
            communicationId: 'comm-1',
            fileSize: 2048,
          }),
        }),
      );
      expect(result).toEqual({ id: 'rec-1', status: CallRecordingStatus.UPLOADED, durationSec: 42 });
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('stores the given direction, outcome and notes on the Communication', async () => {
      mockPrisma.callRecording.findFirst.mockResolvedValue({ id: 'rec-1', leadId: 'lead-1' });
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });
      mockPrisma.callRecording.update.mockResolvedValue({
        id: 'rec-1',
        status: CallRecordingStatus.UPLOADED,
        durationSec: 42,
      });

      await service.completeCallRecording(
        'rec-1',
        { durationSec: 42, fileSize: 2048, direction: 'inbound', outcome: CallOutcome.NOT_CONNECTED, notes: 'Asked for fees' },
        caller,
      );

      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            direction: 'inbound',
            callOutcome: CallOutcome.NOT_CONNECTED,
            body: 'Asked for fees',
          }),
        }),
      );
    });

    it('defaults direction to outbound when omitted', async () => {
      mockPrisma.callRecording.findFirst.mockResolvedValue({ id: 'rec-1', leadId: 'lead-1' });
      mockPrisma.communication.create.mockResolvedValue({ id: 'comm-1' });
      mockPrisma.callRecording.update.mockResolvedValue({ id: 'rec-1', status: CallRecordingStatus.UPLOADED, durationSec: 5 });

      await service.completeCallRecording('rec-1', { durationSec: 5, fileSize: 10 }, caller);

      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ direction: 'outbound' }) }),
      );
    });
  });

  describe('getRecordingPlaybackUrl', () => {
    it('throws when the recording is not visible to the caller or not yet uploaded', async () => {
      mockPrisma.callRecording.findFirst.mockResolvedValue(null);
      await expect(service.getRecordingPlaybackUrl('rec-1', caller)).rejects.toThrow();
    });

    it('mints a fresh signed URL and never returns the raw s3Key', async () => {
      mockPrisma.callRecording.findFirst.mockResolvedValue({ s3Key: 'leads/lead-1/recordings/rec-1.aac' });

      const result = await service.getRecordingPlaybackUrl('rec-1', caller);

      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith('leads/lead-1/recordings/rec-1.aac');
      expect(result).toEqual({ url: 'https://s3.example.com/download-url' });
      expect(JSON.stringify(result)).not.toContain('s3Key');
    });
  });

  describe('initAttachmentUpload', () => {
    it('rejects a disallowed mime type', async () => {
      await expect(
        service.initAttachmentUpload(
          { fileName: 'a.exe', mimeType: 'application/x-msdownload' as never, fileSize: 100 },
          caller,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a PENDING Attachment scoped to the caller org and returns a presigned upload URL', async () => {
      mockPrisma.attachment.create.mockResolvedValue({ id: 'att-1' });

      const result = await service.initAttachmentUpload(
        { fileName: 'brochure.pdf', mimeType: 'application/pdf', fileSize: 1024 },
        caller,
      );

      expect(mockPrisma.attachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-1', uploadedById: 'rep-1', mimeType: 'application/pdf' }),
        }),
      );
      expect(result).toEqual({ attachmentId: 'att-1', uploadUrl: 'https://s3.example.com/upload-url' });
    });
  });

  describe('completeAttachmentUpload', () => {
    it('throws when the attachment does not belong to the caller org', async () => {
      mockPrisma.attachment.findFirst.mockResolvedValue(null);
      await expect(service.completeAttachmentUpload('att-1', caller)).rejects.toThrow();
      expect(mockPrisma.attachment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'att-1', orgId: 'org-1' }) }),
      );
    });

    it('flips the attachment to UPLOADED', async () => {
      mockPrisma.attachment.findFirst.mockResolvedValue({ id: 'att-1' });
      mockPrisma.attachment.update.mockResolvedValue({ id: 'att-1', status: AttachmentStatus.UPLOADED });
      await service.completeAttachmentUpload('att-1', caller);
      expect(mockPrisma.attachment.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: { status: AttachmentStatus.UPLOADED },
      });
    });
  });

  describe('resolveAttachments', () => {
    it('returns an empty array when no ids are given', async () => {
      expect(await service.resolveAttachments(undefined, caller)).toEqual([]);
      expect(mockPrisma.attachment.findMany).not.toHaveBeenCalled();
    });

    it('rejects more than 5 attachment ids', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
      await expect(service.resolveAttachments(ids, caller)).rejects.toThrow(BadRequestException);
    });

    it('scopes the lookup to org and UPLOADED status, and rejects unresolved ids', async () => {
      mockPrisma.attachment.findMany.mockResolvedValue([]);
      await expect(service.resolveAttachments(['att-1'], caller)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['att-1'] },
            status: AttachmentStatus.UPLOADED,
            orgId: 'org-1',
          }),
        }),
      );
    });
  });

  describe('sendEmail with attachments', () => {
    beforeEach(() => {
      process.env.SES_FROM_EMAIL = 'noreply@genxcrm.co.in';
    });
    afterEach(() => {
      delete process.env.SES_FROM_EMAIL;
    });

    it('sends via sendRawEmail (not sendEmail) and persists attachmentIds when attachments resolve', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.attachment.findMany.mockResolvedValue([
        {
          id: 'att-1',
          fileName: 'brochure.pdf',
          mimeType: 'application/pdf',
          s3Key: 'orgs/org-1/attachments/att-1.pdf',
          status: AttachmentStatus.UPLOADED,
        },
      ]);
      mockPrisma.communication.create.mockResolvedValue({});

      await service.sendEmail('lead-1', 'Subject', 'Body', caller, undefined, ['att-1']);

      expect(mockStorage.getObjectBuffer).toHaveBeenCalledWith('orgs/org-1/attachments/att-1.pdf');
      expect(mockSesSendRawEmail).toHaveBeenCalledWith(
        expect.objectContaining({ RawMessage: expect.objectContaining({ Data: expect.anything() }) }),
      );
      expect(mockSesSendEmail).not.toHaveBeenCalled();
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attachmentIds: ['att-1'] }) }),
      );
    });

    it('rejects the send when an attachment id does not resolve', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(lead);
      mockPrisma.attachment.findMany.mockResolvedValue([]);

      await expect(service.sendEmail('lead-1', 'Subject', 'Body', caller, undefined, ['missing'])).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSesSendEmail).not.toHaveBeenCalled();
      expect(mockSesSendRawEmail).not.toHaveBeenCalled();
    });
  });

  describe('sendCallAlert', () => {
    const alertLead = { id: 'lead-1', name: 'Asha', phone: '9876543210', assignedToId: 'rep-2' };

    beforeEach(() => {
      mockPrisma.lead.findFirst.mockResolvedValue(alertLead);
      mockPrisma.user.findUnique.mockResolvedValue({ pushToken: 'fcm-token' });
      mockPrisma.communication.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
    });

    it('scopes the lead lookup to the caller (org + hierarchy)', async () => {
      mockFirebase.sendCallAlert.mockResolvedValue(true);
      await service.sendCallAlert('lead-1', caller);

      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'lead-1', assignedToId: caller.id }) }),
      );
    });

    it('sends the alert to the caller (whoever clicked), not the lead assignee, and logs delivered:true', async () => {
      mockFirebase.sendCallAlert.mockResolvedValue(true);

      const result = await service.sendCallAlert('lead-1', caller);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: caller.id }, select: { pushToken: true } });
      expect(mockFirebase.sendCallAlert).toHaveBeenCalledWith('fcm-token', {
        leadId: 'lead-1',
        leadName: 'Asha',
        phone: '9876543210',
      });
      expect(mockPrisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 'lead-1',
            status: 'initiated',
            metadata: expect.objectContaining({ delivered: true }),
          }),
        }),
      );
      expect(result).toEqual({ delivered: true, phone: '9876543210' });
    });

    it('still targets the caller when the lead is assigned to someone else', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...alertLead, assignedToId: 'rep-2' });
      mockFirebase.sendCallAlert.mockResolvedValue(true);

      await service.sendCallAlert('lead-1', caller);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: caller.id },
        select: { pushToken: true },
      });
    });

    it('reports delivered:false without calling Firebase when the rep has no pushToken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ pushToken: null });

      const result = await service.sendCallAlert('lead-1', caller);

      expect(mockFirebase.sendCallAlert).not.toHaveBeenCalled();
      expect(result).toEqual({ delivered: false, phone: '9876543210' });
    });

    it('clears the stored token and reports delivered:false on InvalidPushTokenError', async () => {
      mockFirebase.sendCallAlert.mockRejectedValue(
        new InvalidPushTokenError('messaging/registration-token-not-registered'),
      );

      const result = await service.sendCallAlert('lead-1', caller);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: caller.id }, data: { pushToken: null } });
      expect(result).toEqual({ delivered: false, phone: '9876543210' });
    });

    it('reports delivered:false (never throws) on any other Firebase failure', async () => {
      mockFirebase.sendCallAlert.mockRejectedValue(new Error('network down'));

      await expect(service.sendCallAlert('lead-1', caller)).resolves.toEqual({ delivered: false, phone: '9876543210' });
    });

    it('throws NotFoundException when the lead is out of scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      await expect(service.sendCallAlert('lead-1', caller)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
