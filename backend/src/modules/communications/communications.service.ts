import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CommType,
  CallOutcome,
  CallRecordingStatus,
  AttachmentStatus,
  Prisma,
  IntegrationProvider,
  IntegrationStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { buildLeadScopeFilter } from '../../common/utils/scope.util';
import { ErrorMessages } from '../../common/constants/messages';
import { PUBLIC_TEST_ONLY_TEMPLATE_NAMES } from '../../common/constants/whatsapp.constants';
import { ENGAGEMENT_SCORE_POINTS } from '../../common/constants/lead.constants';
import { bumpLeadScore } from '../../common/utils/lead-score.util';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';
import { FirebaseService, InvalidPushTokenError } from '../../integrations/firebase/firebase.service';
import type { InitCallRecordingDto } from './dto/init-call-recording.dto';
import type { CompleteCallRecordingDto } from './dto/complete-call-recording.dto';
import { ALLOWED_ATTACHMENT_MIME_TYPES, type InitAttachmentDto } from './dto/init-attachment.dto';
import { decryptToken } from '../../common/crypto.utils';
import { toE164, toWhatsAppRecipient } from '../../common/utils/phone.util';
import * as AWS from 'aws-sdk';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { randomUUID } from 'crypto';

interface EmailSender {
  // SMTP transport to send through instead of SES; undefined when sending via SES.
  transporter?: nodemailer.Transporter;
  fromEmail: string;
  fromName: string;
}

const RECORDING_MIME_EXTENSIONS: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/3gpp': '3gp',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/x-m4a': 'm4a',
};

const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const MAX_ATTACHMENTS = 5;

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);
  private readonly ses: AWS.SES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly billing: BillingService,
    private readonly firebase: FirebaseService,
  ) {
    this.ses = new AWS.SES({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  }

  // Basic RFC-ish shape check — guards against malformed addresses (e.g. from
  // misaligned Excel columns) reaching SES, which rejects them noisily.
  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Produces the HTML + plain-text parts for an email. If the body already contains HTML
  // markup it is sent as-is (with a tag-stripped text fallback); otherwise it's treated as
  // plain text and newlines are converted to <br> so line breaks render.
  private renderEmailBody(body: string): { html: string; text: string } {
    const looksHtml = /<[a-z][\s\S]*?>/i.test(body);
    if (!looksHtml) {
      return { html: body.replace(/\n/g, '<br>'), text: body };
    }
    const text = body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { html: body, text };
  }

  async sendEmail(
    leadId: string,
    subject: string,
    body: string,
    caller: AuthUser,
    fromName?: string,
    attachmentIds?: string[],
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    const validEmail = lead?.email && this.isValidEmail(lead.email) ? lead.email : null;
    const validAltEmail =
      lead?.altEmail && lead.altEmail !== validEmail && this.isValidEmail(lead.altEmail) ? lead.altEmail : null;
    // Status/scoring stays keyed off the primary address; altEmail just rides along as an
    // extra recipient on the same send.
    const recipients = [validEmail, validAltEmail].filter((e): e is string => Boolean(e)).join(', ');
    let sendFailed = false;
    let quotaExceeded = false;

    // Resolved up front (before the quota/send gate) so a bad attachment id fails loudly
    // rather than silently sending a body-only email.
    const attachments = await this.resolveAttachments(attachmentIds, caller, lead?.orgId ?? null);

    // Prefers the org's own connected email config (SMTP or SES-with-custom-domain); falls
    // back to the shared platform SES sender for orgs that haven't configured one.
    const sender = await this.resolveEmailCredentials(lead?.orgId, fromName);

    if (sender && validEmail) {
      if (!(await this.billing.hasEmailQuota(lead?.orgId))) {
        quotaExceeded = true;
        this.logger.warn(`Org ${lead?.orgId} has exhausted its email quota — skipping send for lead ${leadId}`);
      } else {
        const { html, text } = this.renderEmailBody(body);
        // Quote the display name to stay valid if it contains commas/specials.
        const displayName = sender.fromName.replace(/["\\]/g, '');
        const source = `"${displayName}" <${sender.fromEmail}>`;
        try {
          if (sender.transporter) {
            const files = await this.loadAttachmentFiles(attachments);
            await sender.transporter.sendMail({
              from: source,
              to: recipients,
              subject,
              html,
              text,
              attachments: files,
            });
          } else if (attachments.length > 0) {
            const raw = await this.buildRawEmail(source, recipients, subject, html, text, attachments);
            await this.ses.sendRawEmail({ RawMessage: { Data: raw } }).promise();
          } else {
            await this.ses
              .sendEmail({
                Source: source,
                Destination: { ToAddresses: [validEmail, validAltEmail].filter((e): e is string => Boolean(e)) },
                Message: {
                  Subject: { Data: subject, Charset: 'UTF-8' },
                  // Send both an HTML part (renders formatting / line breaks) and a plain-text
                  // fallback for text-only clients and deliverability.
                  Body: {
                    Text: { Data: text, Charset: 'UTF-8' },
                    Html: { Data: html, Charset: 'UTF-8' },
                  },
                },
              })
              .promise();
          }
        } catch (err) {
          sendFailed = true;
          this.logger.error(`Email send error for lead ${leadId}`, err instanceof Error ? err.message : String(err));
        }
        // Meter the attempt (sent or failed) — either way it used send capacity.
        void this.billing.recordEmailSent(lead?.orgId);
      }
    }

    const status = quotaExceeded
      ? 'quota_exceeded'
      : sendFailed
        ? 'failed'
        : validEmail
          ? 'sent'
          : lead?.email
            ? 'invalid_email'
            : 'no_email';

    const communication = await this.prisma.communication.create({
      data: {
        leadId,
        type: CommType.EMAIL,
        subject,
        body,
        status,
        metadata: { sentBy: caller.id } satisfies Prisma.InputJsonObject,
        attachmentIds: attachments.length > 0 ? attachments.map((a) => a.id) : undefined,
      },
    });
    if (status === 'sent') void bumpLeadScore(this.prisma, leadId, ENGAGEMENT_SCORE_POINTS.EMAIL);
    return communication;
  }

  // Sends a plain email to an address that isn't a Lead (Manufacturing contacts and leads), through the org's own
  // email setup when it has one. Counts against the email quota. Returns whether it was handed to the mail server.
  async sendEmailToAddress(orgId: string, to: string, subject: string, body: string, fromName?: string): Promise<boolean> {
    if (!this.isValidEmail(to)) return false;
    const sender = await this.resolveEmailCredentials(orgId, fromName);
    if (!sender || !(await this.billing.hasEmailQuota(orgId))) return false;
    const { html, text } = this.renderEmailBody(body);
    const source = `"${sender.fromName.replace(/["\\]/g, '')}" <${sender.fromEmail}>`;
    try {
      if (sender.transporter) {
        await sender.transporter.sendMail({ from: source, to, subject, html, text });
      } else {
        await this.ses
          .sendEmail({
            Source: source,
            Destination: { ToAddresses: [to] },
            Message: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } } },
          })
          .promise();
      }
      return true;
    } catch (err) {
      this.logger.error(`Email send error to ${to}`, err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      void this.billing.recordEmailSent(orgId);
    }
  }

  // Builds the raw MIME message (multipart/mixed: the HTML+text body plus each file) that
  // SES's sendRawEmail expects — the simple sendEmail API has no attachment support.
  // nodemailer's MailComposer only builds the buffer here; SES still performs the actual send.
  private async loadAttachmentFiles(attachments: { fileName: string; mimeType: string; s3Key: string }[]) {
    return Promise.all(
      attachments.map(async (a) => ({
        filename: a.fileName,
        contentType: a.mimeType,
        content: await this.storage.getObjectBuffer(a.s3Key),
      })),
    );
  }

  private async buildRawEmail(
    source: string,
    to: string,
    subject: string,
    html: string,
    text: string,
    attachments: { fileName: string; mimeType: string; s3Key: string }[],
  ): Promise<Buffer> {
    const files = await this.loadAttachmentFiles(attachments);
    const composer = new MailComposer({
      from: source,
      to,
      subject,
      html,
      text,
      attachments: files,
    });
    return new Promise((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err);
        else resolve(message);
      });
    });
  }

  // Org-scoped, upload-complete attachments for the given ids, in the order requested.
  // Used both when actually sending (sendEmail) and when persisting a nurturing step's
  // attachment list — throws if the count exceeds MAX_ATTACHMENTS or an id doesn't resolve
  // (wrong org, still PENDING, or doesn't exist), so a bad reference fails loudly.
  async resolveAttachments(ids: string[] | undefined, caller: AuthUser, leadOrgId?: string | null) {
    if (!ids || ids.length === 0) return [];
    if (ids.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(ErrorMessages.communications.tooManyAttachments);
    }
    const orgId = leadOrgId ?? caller.orgId ?? null;
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: ids }, status: AttachmentStatus.UPLOADED, ...(orgId ? { orgId } : {}) },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException(ErrorMessages.communications.attachmentNotFound);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)!);
  }

  // Issues a presigned S3 PUT URL for a file to be attached to an email, and creates the
  // Attachment row in PENDING state to track it. Mirrors initCallRecording.
  async initAttachmentUpload(dto: InitAttachmentDto, caller: AuthUser) {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(dto.mimeType)) {
      throw new BadRequestException(ErrorMessages.communications.attachmentTypeNotAllowed);
    }

    const attachmentId = randomUUID();
    const ext = ATTACHMENT_MIME_EXTENSIONS[dto.mimeType] ?? 'bin';
    const orgId = caller.orgId ?? 'no-org';
    const s3Key = this.storage.buildAttachmentKey(orgId, attachmentId, ext);

    const attachment = await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        orgId: caller.orgId ?? undefined,
        uploadedById: caller.id,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSize: dto.fileSize,
        s3Key,
      },
    });

    const uploadUrl = await this.storage.getPresignedUploadUrl(s3Key, dto.mimeType);
    return { attachmentId: attachment.id, uploadUrl };
  }

  // Confirms a successful upload — flips the Attachment to UPLOADED so it becomes eligible
  // for use in sendEmail/nurturing steps.
  async completeAttachmentUpload(attachmentId: string, caller: AuthUser) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, ...(caller.orgId ? { orgId: caller.orgId } : {}) },
    });
    if (!attachment) throw new NotFoundException(ErrorMessages.communications.attachmentNotFound);

    return this.prisma.attachment.update({
      where: { id: attachmentId },
      data: { status: AttachmentStatus.UPLOADED },
    });
  }

  // Fetches display metadata (fileName/fileSize) for a set of attachment ids — used to
  // hydrate the attachment picker when reopening a nurturing step that already has
  // attachments, without exposing S3 keys or requiring a fresh presigned URL per id.
  async listAttachmentsMeta(ids: string[], caller: AuthUser) {
    const attachments = await this.resolveAttachments(ids, caller);
    return attachments.map((a) => ({ id: a.id, fileName: a.fileName, fileSize: a.fileSize }));
  }

  // Mints a fresh short-lived signed URL for downloading a past attachment — never persisted.
  async getAttachmentDownloadUrl(attachmentId: string, caller: AuthUser) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, status: AttachmentStatus.UPLOADED, ...(caller.orgId ? { orgId: caller.orgId } : {}) },
      select: { s3Key: true },
    });
    if (!attachment) throw new NotFoundException(ErrorMessages.communications.attachmentNotFound);

    return { url: await this.storage.getPresignedDownloadUrl(attachment.s3Key) };
  }

  async sendSms(leadId: string, message: string, caller: AuthUser) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });

    if (process.env.TWILIO_ACCOUNT_SID && lead?.phone) {
      try {
        const params = new URLSearchParams({
          To: toE164(lead.phone),
          From: process.env.TWILIO_FROM_NUMBER ?? '',
          Body: message,
        });
        await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
          params.toString(),
          {
            auth: {
              username: process.env.TWILIO_ACCOUNT_SID,
              password: process.env.TWILIO_AUTH_TOKEN ?? '',
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        );
      } catch (err) {
        this.logger.error(`Twilio SMS error for lead ${leadId}`, err instanceof Error ? err.message : String(err));
      }
    }

    const communication = await this.prisma.communication.create({
      data: {
        leadId,
        type: CommType.SMS,
        body: message,
        status: 'sent',
        metadata: { sentBy: caller.id } satisfies Prisma.InputJsonObject,
      },
    });
    void bumpLeadScore(this.prisma, leadId, ENGAGEMENT_SCORE_POINTS.SMS);
    return communication;
  }

  // Surfaces Meta's actual error body (code + message + error_data) instead of axios's opaque
  // "Request failed with status code 400" — without it, WhatsApp failures are undiagnosable.
  // Logged only — never shown to a user (the raw JSON envelope reads as an internal error).
  private metaError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      return err.response?.data ? JSON.stringify(err.response.data) : err.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  // Human-readable reason pulled out of the same Meta error envelope, for storage on
  // Communication.metadata.error — the lead timeline (CommBubble.tsx) renders this directly
  // to reps, so it must never be the raw JSON metaError() produces. Mirrors
  // PaymentsService.razorpayErrorReason.
  private metaErrorReason(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; error_data?: { details?: string } } }
        | undefined;
      return data?.error?.error_data?.details ?? data?.error?.message ?? err.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  // Prefers the caller's org's own connected email config (SMTP or SES-with-custom-domain);
  // falls back to the shared platform SES sender (SES_FROM_EMAIL/SES_FROM_NAME) for orgs
  // that haven't configured one.
  private async resolveEmailCredentials(
    orgId: string | undefined | null,
    fromNameOverride?: string,
  ): Promise<EmailSender | null> {
    if (orgId) {
      const integration = await this.prisma.orgIntegration.findUnique({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.EMAIL } },
      });
      if (integration?.status === IntegrationStatus.CONNECTED) {
        const metadata = (integration.metadata ?? {}) as {
          method?: 'SMTP' | 'SES_DOMAIN';
          host?: string;
          port?: number;
          secure?: boolean;
          fromEmail?: string;
        };
        const fromName = fromNameOverride ?? integration.accountName ?? process.env.SES_FROM_NAME ?? 'GenXCRM';

        if (metadata.method === 'SMTP' && integration.accessToken && integration.accountId && metadata.fromEmail) {
          try {
            const transporter = nodemailer.createTransport({
              host: metadata.host,
              port: metadata.port,
              secure: metadata.secure,
              auth: { user: integration.accountId, pass: decryptToken(integration.accessToken) },
            });
            return { transporter, fromEmail: metadata.fromEmail, fromName };
          } catch (err) {
            this.logger.error(
              `Failed to decrypt SMTP password for org ${orgId}`,
              err instanceof Error ? err.message : String(err),
            );
          }
        } else if (metadata.method === 'SES_DOMAIN' && metadata.fromEmail) {
          // Still sends through the shared AWS SES client — only the verified From address
          // differs, since it's the same AWS account/region as the platform default.
          return { fromEmail: metadata.fromEmail, fromName };
        }
      }
    }
    if (process.env.SES_FROM_EMAIL) {
      return {
        fromEmail: process.env.SES_FROM_EMAIL,
        fromName: fromNameOverride ?? process.env.SES_FROM_NAME ?? 'GenXCRM',
      };
    }
    return null;
  }

  // Prefers the caller's org's own connected WABA; falls back to the single global
  // WHATSAPP_API_TOKEN/WHATSAPP_PHONE_NUMBER_ID env vars for orgs that haven't
  // connected one (dev/single-tenant deployments keep working unchanged).
  private async resolveWhatsAppCredentials(
    orgId: string | undefined | null,
  ): Promise<{ accessToken: string; phoneNumberId: string; isOwnIntegration: boolean } | null> {
    if (orgId) {
      const integration = await this.prisma.orgIntegration.findUnique({
        where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
      });
      if (integration?.status === IntegrationStatus.CONNECTED && integration.accessToken && integration.accountId) {
        try {
          return {
            accessToken: decryptToken(integration.accessToken),
            phoneNumberId: integration.accountId,
            isOwnIntegration: true,
          };
        } catch (err) {
          this.logger.error(
            `Failed to decrypt WhatsApp access token for org ${orgId}`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
    if (process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      return {
        accessToken: process.env.WHATSAPP_API_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        isOwnIntegration: false,
      };
    }
    return null;
  }

  // Records which org/lead a successful global-fallback send just messaged, keyed by phone —
  // the only way an inbound reply to the shared number (which carries no org signal from Meta)
  // can later be routed back to the right lead. See WhatsappWebhookService.handleGlobalInboundMessage.
  private async recordGlobalConversation(orgId: string, leadId: string, phone: string): Promise<void> {
    try {
      await this.prisma.whatsAppGlobalConversation.upsert({
        where: { phone },
        create: { phone, orgId, leadId },
        update: { orgId, leadId, lastSentAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Failed to record global WhatsApp conversation for lead ${leadId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // WhatsApp Cloud API media payloads: the message text rides along as the caption of the
  // first file (a separate text message would arrive detached from it). Only JPEG/PNG are
  // valid `image` messages; everything else is sent as a `document`.
  private async buildWhatsAppMediaPayloads(
    to: string,
    message: string,
    attachments: { fileName: string; mimeType: string; s3Key: string }[],
  ) {
    return Promise.all(
      attachments.map(async (a, index) => {
        const link = await this.storage.getPresignedDownloadUrl(a.s3Key);
        const caption = index === 0 && message ? message : undefined;
        const isImage = a.mimeType === 'image/jpeg' || a.mimeType === 'image/png';
        return {
          messaging_product: 'whatsapp',
          to,
          ...(isImage
            ? { type: 'image', image: { link, caption } }
            : { type: 'document', document: { link, caption, filename: a.fileName } }),
        };
      }),
    );
  }

  async sendWhatsApp(leadId: string, message: string, caller: AuthUser, attachmentIds?: string[]) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
    });
    // Resolved up front so a bad attachment id fails loudly before anything is sent.
    const attachments = await this.resolveAttachments(attachmentIds, caller, lead?.orgId ?? null);

    const wa = await this.resolveWhatsAppCredentials(caller.orgId);
    let status: string = lead?.phone ? 'sent' : 'no_phone';
    let externalId: string | undefined;
    let error: string | undefined;

    if (!wa) {
      status = 'not_configured';
    } else if (lead?.phone) {
      if (!wa.isOwnIntegration && !(await this.billing.hasWhatsAppQuota(caller.orgId))) {
        status = 'quota_exceeded';
      } else {
        try {
          const to = toWhatsAppRecipient(lead.phone);
          const payloads =
            attachments.length > 0
              ? await this.buildWhatsAppMediaPayloads(to, message, attachments)
              : [{ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }];
          for (const payload of payloads) {
            const { data } = await axios.post<{ messages?: { id: string }[] }>(
              `https://graph.facebook.com/v25.0/${wa.phoneNumberId}/messages`,
              payload,
              { headers: { Authorization: `Bearer ${wa.accessToken}` } },
            );
            externalId ??= data?.messages?.at(0)?.id;
          }
        } catch (err) {
          status = 'failed';
          error = this.metaErrorReason(err);
          this.logger.error(`WhatsApp error for lead ${leadId}: ${this.metaError(err)}`);
        }
        // Meter the attempt (sent or failed) — either way it used send capacity — but
        // only against the shared-API free credit; an org's own WABA is unmetered.
        if (!wa.isOwnIntegration) void this.billing.recordWhatsAppSent(caller.orgId);
        if (!wa.isOwnIntegration && status === 'sent' && caller.orgId) {
          await this.recordGlobalConversation(caller.orgId, leadId, lead.phone);
        }
      }
    }

    const communication = await this.prisma.communication.create({
      data: {
        leadId,
        type: CommType.WHATSAPP,
        body: message,
        status,
        externalId,
        attachmentIds: attachments.length > 0 ? attachments.map((a) => a.id) : undefined,
        metadata: { sentBy: caller.id, ...(error ? { error } : {}) } satisfies Prisma.InputJsonObject,
      },
    });
    if (status === 'sent') void bumpLeadScore(this.prisma, leadId, ENGAGEMENT_SCORE_POINTS.WHATSAPP);

    if (status === 'not_configured') throw new BadRequestException(ErrorMessages.communications.notConfigured);
    if (status === 'quota_exceeded') throw new BadRequestException(ErrorMessages.communications.whatsappQuotaExceeded);
    if (status === 'no_phone') throw new BadRequestException(ErrorMessages.communications.noPhone);
    if (status === 'failed') throw new BadGatewayException(ErrorMessages.communications.sendFailed);

    return communication;
  }

  // Sends an approved WhatsApp message template (type: "template"). Unlike free-form text, templates
  // can be sent any time — not just inside the 24h customer-service window — so this is the path used
  // for proactive nurturing. `params` map to the template's positional body variables {{1}}..{{n}}.
  async sendWhatsAppTemplate(
    leadId: string,
    templateName: string,
    languageCode: string,
    params: readonly string[],
    caller: AuthUser,
  ) {
    if (PUBLIC_TEST_ONLY_TEMPLATE_NAMES.has(templateName)) {
      throw new BadRequestException(ErrorMessages.communications.publicTestOnlyTemplate);
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
    });

    const wa = await this.resolveWhatsAppCredentials(caller.orgId);
    let status = lead?.phone ? 'sent' : 'no_phone';
    let externalId: string | undefined;
    let error: string | undefined;

    if (lead?.phone && !wa) {
      status = 'not_configured';
    } else if (wa && lead?.phone) {
      if (!wa.isOwnIntegration && !(await this.billing.hasWhatsAppQuota(caller.orgId))) {
        status = 'quota_exceeded';
      } else {
        try {
          const { data } = await axios.post<{ messages?: { id: string }[] }>(
            `https://graph.facebook.com/v25.0/${wa.phoneNumberId}/messages`,
            {
              messaging_product: 'whatsapp',
              to: toWhatsAppRecipient(lead.phone),
              type: 'template',
              template: {
                name: templateName,
                language: { code: languageCode },
                // Only emit a body component when the template actually has variables — templates with
                // no {{n}} placeholders reject an empty parameters array.
                ...(params.length > 0
                  ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] }
                  : {}),
              },
            },
            { headers: { Authorization: `Bearer ${wa.accessToken}` } },
          );
          externalId = data?.messages?.at(0)?.id;
        } catch (err) {
          status = 'failed';
          error = this.metaErrorReason(err);
          this.logger.error(`WhatsApp template error for lead ${leadId}: ${this.metaError(err)}`);
        }
        if (!wa.isOwnIntegration) void this.billing.recordWhatsAppSent(caller.orgId);
        if (!wa.isOwnIntegration && status === 'sent' && caller.orgId) {
          await this.recordGlobalConversation(caller.orgId, leadId, lead.phone);
        }
      }
    }

    const communication = await this.prisma.communication.create({
      data: {
        leadId,
        type: CommType.WHATSAPP,
        body: `[template:${templateName}] ${params.join(' | ')}`.trim(),
        status,
        externalId,
        metadata: {
          sentBy: caller.id,
          template: templateName,
          ...(error ? { error } : {}),
        } satisfies Prisma.InputJsonObject,
      },
    });
    if (status === 'sent') void bumpLeadScore(this.prisma, leadId, ENGAGEMENT_SCORE_POINTS.WHATSAPP);

    if (status === 'not_configured') throw new BadRequestException(ErrorMessages.communications.notConfigured);
    if (status === 'quota_exceeded') throw new BadRequestException(ErrorMessages.communications.whatsappQuotaExceeded);
    if (status === 'no_phone') throw new BadRequestException(ErrorMessages.communications.noPhone);
    if (status === 'failed') throw new BadGatewayException(ErrorMessages.communications.sendFailed);

    return communication;
  }

  async sendCallAlert(leadId: string, caller: AuthUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
      select: { id: true, name: true, phone: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.leads.notFound);

    // Ring whoever clicked Call, not the lead's assignee — a Director or Manager
    // calling from a lead assigned to someone else should still get the alert on
    // their own phone, matching the "sent to your phone" toast on the frontend.
    const targetUser = await this.prisma.user.findUnique({
      where: { id: caller.id },
      select: { pushToken: true },
    });

    let delivered = false;
    if (targetUser?.pushToken) {
      try {
        delivered = await this.firebase.sendCallAlert(targetUser.pushToken, {
          leadId: lead.id,
          leadName: lead.name,
          phone: lead.phone,
        });
      } catch (err) {
        if (err instanceof InvalidPushTokenError) {
          await this.prisma.user.update({ where: { id: caller.id }, data: { pushToken: null } });
        } else {
          this.logger.warn(`Call alert send failed for lead ${leadId}: ${(err as Error).message}`);
        }
      }
    }

    const metadata = { triggeredVia: 'desktop_alert', delivered } satisfies Prisma.InputJsonObject;
    await this.prisma.communication.create({
      data: { leadId, type: CommType.CALL, status: 'initiated', calledById: caller.id, metadata },
    });
    await this.prisma.activity.create({
      data: { leadId, userId: caller.id, type: 'CALL_ALERT_SENT', metadata },
    });

    return { delivered, phone: lead.phone };
  }

  async logCall(
    leadId: string,
    durationSec: number,
    notes: string,
    caller: AuthUser,
    outcome: CallOutcome = CallOutcome.CONNECTED,
    direction: 'inbound' | 'outbound' = 'outbound',
  ) {
    const metadata = { durationSec, calledBy: caller.id } satisfies Prisma.InputJsonObject;

    await this.prisma.communication.create({
      data: {
        leadId,
        type: CommType.CALL,
        direction: direction === 'inbound' ? 'inbound' : 'outbound',
        body: notes,
        status: 'completed',
        durationSec,
        callOutcome: outcome,
        calledById: caller.id,
        metadata,
      },
    });
    void bumpLeadScore(this.prisma, leadId, ENGAGEMENT_SCORE_POINTS.CALL);

    return this.prisma.activity.create({
      data: { leadId, userId: caller.id, type: 'CALL', note: notes, metadata },
    });
  }

  async getHistory(leadId: string, caller: AuthUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.leads.notFound);

    return this.prisma.communication.findMany({
      where: { leadId },
      orderBy: { sentAt: 'desc' },
    });
  }

  async getStats(caller: AuthUser) {
    return this.prisma.communication.groupBy({
      by: ['type', 'status'],
      _count: { type: true },
      where: { lead: buildLeadScopeFilter(caller) },
    });
  }

  async getCallLog(caller: AuthUser, page = 1, limit = 20) {
    const where: Prisma.CommunicationWhereInput = {
      type: CommType.CALL,
      lead: buildLeadScopeFilter(caller),
    };
    const [data, total] = await Promise.all([
      this.prisma.communication.findMany({
        where,
        include: {
          lead: { select: { id: true, name: true, phone: true } },
          callRecording: { select: { id: true, status: true } },
        },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communication.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // Issues a presigned S3 PUT URL for the Android app to upload a call recording directly,
  // and creates the CallRecording row in PENDING state to track it.
  async initCallRecording(dto: InitCallRecordingDto, caller: AuthUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, ...buildLeadScopeFilter(caller) },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.leads.notFound);

    const recordingId = randomUUID();
    const ext = RECORDING_MIME_EXTENSIONS[dto.mimeType] ?? 'aac';
    const s3Key = this.storage.buildRecordingKey(lead.id, recordingId, ext);

    const recording = await this.prisma.callRecording.create({
      data: {
        id: recordingId,
        leadId: lead.id,
        uploadedById: caller.id,
        s3Key,
        mimeType: dto.mimeType,
        durationSec: dto.durationSec,
      },
    });

    const uploadUrl = await this.storage.getPresignedUploadUrl(s3Key, dto.mimeType);
    return { recordingId: recording.id, uploadUrl };
  }

  // Confirms a successful upload: creates the Communication (call log) row and flips the
  // CallRecording to UPLOADED, linking the two.
  async completeCallRecording(recordingId: string, dto: CompleteCallRecordingDto, caller: AuthUser) {
    const recording = await this.prisma.callRecording.findFirst({
      where: { id: recordingId, lead: buildLeadScopeFilter(caller) },
    });
    if (!recording) throw new NotFoundException(ErrorMessages.leads.notFound);

    const outcome = dto.outcome ?? CallOutcome.CONNECTED;
    const updated = await this.prisma.$transaction(async (tx) => {
      const communication = await tx.communication.create({
        data: {
          leadId: recording.leadId,
          type: CommType.CALL,
          direction: dto.direction ?? 'outbound',
          body: dto.notes,
          status: 'completed',
          durationSec: dto.durationSec,
          callOutcome: outcome,
          calledById: caller.id,
          metadata: { calledBy: caller.id } satisfies Prisma.InputJsonObject,
        },
      });
      return tx.callRecording.update({
        where: { id: recordingId },
        data: {
          status: CallRecordingStatus.UPLOADED,
          uploadedAt: new Date(),
          fileSize: dto.fileSize,
          durationSec: dto.durationSec,
          communicationId: communication.id,
        },
      });
    });
    void bumpLeadScore(this.prisma, recording.leadId, ENGAGEMENT_SCORE_POINTS.CALL);

    return { id: updated.id, status: updated.status, durationSec: updated.durationSec };
  }

  // Mints a fresh short-lived signed URL for playback — never persisted, never cached.
  async getRecordingPlaybackUrl(recordingId: string, caller: AuthUser) {
    const recording = await this.prisma.callRecording.findFirst({
      where: { id: recordingId, lead: buildLeadScopeFilter(caller), status: CallRecordingStatus.UPLOADED },
      select: { s3Key: true },
    });
    if (!recording) throw new NotFoundException(ErrorMessages.leads.notFound);

    return { url: await this.storage.getPresignedDownloadUrl(recording.s3Key) };
  }
}
