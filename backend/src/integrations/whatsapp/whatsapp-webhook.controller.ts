import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  HttpCode,
  Param,
  Req,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WhatsappWebhookService, type WhatsAppWebhookPayload } from './whatsapp-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorMessages } from '../../common/constants/messages';

// Org-scoped Meta WhatsApp webhook — :orgToken in the path routes to the correct
// tenant, same pattern as WebhookController's generic ingest endpoint.
@Controller('integrations/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly wa: WhatsappWebhookService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':orgToken/webhook')
  async verify(
    @Param('orgToken') orgToken: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const orgId = await this.resolveOrgId(orgToken);
    const result = await this.wa.verifyWebhook(orgId, mode, token, challenge);
    if (!result) throw new BadRequestException(ErrorMessages.integrations.verificationFailed);
    return result;
  }

  @Post(':orgToken/webhook')
  @HttpCode(200)
  async handleEvent(
    @Param('orgToken') orgToken: string,
    @Body() payload: WhatsAppWebhookPayload,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: Request,
  ) {
    const orgId = await this.resolveOrgId(orgToken);
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(payload));
    const valid = await this.wa.verifySignature(orgId, rawBody, signature ?? '');
    if (!valid) throw new UnauthorizedException(ErrorMessages.integrations.invalidSignature);
    this.wa.processEvent(orgId, payload);
    return { status: 'ok' };
  }

  private async resolveOrgId(orgToken: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { orgWebhookToken: orgToken },
      select: { id: true },
    });
    if (!org) throw new NotFoundException(ErrorMessages.integrations.unknownOrg);
    return org.id;
  }
}
