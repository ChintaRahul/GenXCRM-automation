import { Controller, Post, Body, Param, Headers, Req, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { WorkspaceType } from '@prisma/client';
import type { MfgLeadWebhookPayload } from '../../modules/mfg-leads/mfg-leads.service';
import { WebhookService, WebhookLeadPayload } from './webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorMessages } from '../../common/constants/messages';

@Controller('integrations/webhook')
export class WebhookController {
  constructor(
    private readonly webhook: WebhookService,
    private readonly prisma: PrismaService,
  ) {}

  // Org-specific ingest URL — orgToken in path routes to the correct tenant
  @Post(':orgToken/ingest')
  async ingest(
    @Param('orgToken') orgToken: string,
    @Body() payload: WebhookLeadPayload,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Req() req: Request,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { orgWebhookToken: orgToken },
      select: { id: true, workspaceType: true },
    });
    if (!org) throw new NotFoundException(ErrorMessages.integrations.unknownOrg);

    // Verify the HMAC over the raw request bytes the client signed, not a re-serialized body.
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(payload));
    const valid = await this.webhook.validateSignature(org.id, rawBody, signature);
    if (!valid) throw new UnauthorizedException(ErrorMessages.integrations.invalidSignature);

    if (org.workspaceType === WorkspaceType.MANUFACTURING) return this.webhook.ingestMfgLead(payload as MfgLeadWebhookPayload, org.id);
    return this.webhook.ingestLead(payload, org.id);
  }
}
