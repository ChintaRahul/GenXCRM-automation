import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommType, IntegrationProvider, IntegrationStatus, Prisma } from '@prisma/client';
import { decryptToken } from '../../common/crypto.utils';
import * as crypto from 'crypto';

interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string; message?: string }[];
}

interface WhatsAppMessageValue {
  messaging_product: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppWebhookChange {
  field: string;
  value: WhatsAppMessageValue;
}

interface WhatsAppWebhookEntry {
  id?: string;
  changes?: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

// Receives inbound WhatsApp messages and delivery/status updates via Meta's WhatsApp
// Cloud API webhook. Each org connects its own WABA under its own Meta App (see
// IntegrationsConfigService.connectWhatsApp), so the webhook URL is org-scoped
// (:orgToken path segment resolved by the controller) and every lookup here is
// scoped to that org's own stored credentials.
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async verifyWebhook(orgId: string, mode: string, token: string, challenge: string): Promise<string | null> {
    if (mode !== 'subscribe') return null;
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
    });
    const verifyToken = (integration?.metadata as { verifyToken?: string } | null)?.verifyToken;
    if (!verifyToken || token !== verifyToken) return null;
    return challenge;
  }

  async verifySignature(orgId: string, rawBody: Buffer | string, signature: string): Promise<boolean> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId, provider: IntegrationProvider.WHATSAPP } },
    });
    if (!integration?.webhookSecret) return false;
    let secret: string;
    try {
      secret = decryptToken(integration.webhookSecret);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt WhatsApp webhook secret for orgId=${orgId}`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  processEvent(orgId: string, payload: WhatsAppWebhookPayload): void {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        for (const message of change.value.messages ?? []) {
          void this.handleInboundMessage(orgId, message);
        }
        for (const status of change.value.statuses ?? []) {
          void this.handleStatusUpdate(status, orgId);
        }
      }
    }
  }

  /**
   * Handles inbound WhatsApp events for Embedded-Signup-connected orgs, which arrive at
   * GenXCRM's single app-level Facebook webhook (see FacebookService.processLeadEvent),
   * not a per-org URL. Resolves the org(s) by decrypting each candidate's stored WABA id
   * and matching it against the event's entry.id.
   *
   * The shared WHATSAPP_BUSINESS_ACCOUNT_ID fallback number (see
   * CommunicationsService.resolveWhatsAppCredentials, isOwnIntegration: false) also
   * arrives here, but isn't tied to any single org's OrgIntegration row — its events are
   * routed separately via WhatsAppGlobalConversation instead of resolveOrgIdsByWabaId.
   */
  async processEmbeddedSignupEvent(payload: WhatsAppWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      const wabaId = entry.id;
      if (!wabaId) continue;

      if (wabaId === process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
        this.processGlobalFallbackChanges(entry.changes ?? []);
        continue;
      }

      const orgIds = await this.resolveOrgIdsByWabaId(wabaId);
      if (!orgIds.length) {
        this.logger.warn(`Inbound WhatsApp event for waba_id=${wabaId} matched no connected embedded-signup org`);
        continue;
      }

      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        for (const orgId of orgIds) {
          for (const message of change.value.messages ?? []) {
            void this.handleInboundMessage(orgId, message);
          }
          for (const status of change.value.statuses ?? []) {
            void this.handleStatusUpdate(status, orgId);
          }
        }
      }
    }
  }

  private processGlobalFallbackChanges(changes: WhatsAppWebhookChange[]): void {
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      for (const message of change.value.messages ?? []) {
        void this.handleGlobalInboundMessage(message);
      }
      for (const status of change.value.statuses ?? []) {
        void this.handleStatusUpdate(status);
      }
    }
  }

  private async resolveOrgIdsByWabaId(wabaId: string): Promise<string[]> {
    const candidates = await this.prisma.orgIntegration.findMany({
      where: { provider: IntegrationProvider.WHATSAPP, status: IntegrationStatus.CONNECTED },
    });
    const matches: string[] = [];
    for (const candidate of candidates) {
      const meta = candidate.metadata as { businessAccountId?: string; connectMethod?: string } | null;
      if (meta?.connectMethod !== 'EMBEDDED_SIGNUP' || !meta.businessAccountId) continue;
      try {
        if (decryptToken(meta.businessAccountId) === wabaId) matches.push(candidate.orgId);
      } catch (err) {
        this.logger.error(
          `Failed to decrypt businessAccountId for orgId=${candidate.orgId}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return matches;
  }

  private async handleInboundMessage(orgId: string, message: WhatsAppInboundMessage): Promise<void> {
    const phoneTail = message.from.replace(/\D/g, '').slice(-10);
    if (phoneTail.length < 10) {
      this.logger.warn(`Inbound WhatsApp message from ${message.from} has no matchable phone — skipping`);
      return;
    }

    const lead = await this.prisma.lead.findFirst({
      where: { orgId, isDeleted: false, phone: { endsWith: phoneTail } },
    });
    if (!lead) {
      this.logger.warn(`Inbound WhatsApp message from ${message.from} matched no lead in orgId=${orgId} — skipping`);
      return;
    }

    await this.createInboundCommunication(lead.id, message);
  }

  /**
   * Inbound counterpart to CommunicationsService's global-fallback send path. Meta's webhook
   * gives no org signal for the shared WHATSAPP_BUSINESS_ACCOUNT_ID — only the customer's phone
   * — so routing goes through WhatsAppGlobalConversation, upserted on every successful
   * global-fallback send, instead of a per-org Lead lookup.
   */
  private async handleGlobalInboundMessage(message: WhatsAppInboundMessage): Promise<void> {
    const phoneTail = message.from.replace(/\D/g, '').slice(-10);
    if (phoneTail.length < 10) {
      this.logger.warn(`Inbound WhatsApp message from ${message.from} has no matchable phone — skipping (global fallback)`);
      return;
    }

    const conversation = await this.prisma.whatsAppGlobalConversation.findUnique({ where: { phone: phoneTail } });
    if (!conversation) {
      this.logger.warn(`Inbound WhatsApp message from ${message.from} matched no tracked global conversation — skipping`);
      return;
    }

    await this.createInboundCommunication(conversation.leadId, message);
  }

  private async createInboundCommunication(leadId: string, message: WhatsAppInboundMessage): Promise<void> {
    await this.prisma.communication.create({
      data: {
        leadId,
        type: CommType.WHATSAPP,
        direction: 'inbound',
        body: message.text?.body ?? `[${message.type}]`,
        status: 'received',
        externalId: message.id,
      },
    });
    // Resurfaces the lead at the top of the list/notifications, same as a re-submitted Meta lead.
    await this.prisma.lead.update({ where: { id: leadId }, data: { activityAt: new Date() } });
  }

  // orgId scopes the lookup to a single connected org's leads; omitted for the shared
  // global-fallback WABA, whose events carry no org signal — safe because Meta's message id
  // (externalId) is globally unique to messages this app itself sent.
  private async handleStatusUpdate(status: WhatsAppStatus, orgId?: string): Promise<void> {
    const leadFilter = orgId ? { lead: { orgId } } : {};
    // Meta reports a failed send (e.g. a free-form message sent outside the 24h customer-service
    // window) asynchronously here, after already accepting it synchronously — so this is the only
    // place the real failure reason is ever available. `updateMany` can't merge JSON, so a failed
    // status with a reason goes through a fetch + single-row update to preserve existing metadata.
    if (status.status === 'failed' && status.errors?.length) {
      const reason = status.errors[0].message ?? status.errors[0].title;
      const existing = await this.prisma.communication.findFirst({
        where: { externalId: status.id, ...leadFilter },
      });
      if (!existing) {
        this.logger.warn(`WhatsApp status update for unknown message id=${status.id}${orgId ? ` in orgId=${orgId}` : ''}`);
        return;
      }
      await this.prisma.communication.update({
        where: { id: existing.id },
        data: {
          status: status.status,
          metadata: {
            ...(existing.metadata as Prisma.JsonObject | null),
            error: reason,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return;
    }

    const { count } = await this.prisma.communication.updateMany({
      where: { externalId: status.id, ...leadFilter },
      data: { status: status.status },
    });
    if (count === 0) {
      this.logger.warn(`WhatsApp status update for unknown message id=${status.id}${orgId ? ` in orgId=${orgId}` : ''}`);
    }
  }
}
