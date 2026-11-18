import { Controller, Get, Post, Query, Body, Headers, HttpCode, BadRequestException, UnauthorizedException, Req } from '@nestjs/common';
import type { Request } from 'express';
import { FacebookService, type FacebookWebhookPayload } from './facebook.service';
import type { WhatsAppWebhookPayload } from '../whatsapp/whatsapp-webhook.service';
import { ErrorMessages } from '../../common/constants/messages';

@Controller('integrations/facebook')
export class FacebookController {
  constructor(private readonly fb: FacebookService) {}

  // Meta app-level webhook verification (one endpoint serves all orgs)
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const result = this.fb.verifyWebhook(mode, token, challenge);
    if (!result) throw new BadRequestException(ErrorMessages.integrations.verificationFailed);
    return result;
  }

  // Receives leadgen + WhatsApp message events — org is resolved internally (page_id or
  // WABA id → OrgIntegration lookup). Must return 200 (not NestJS's default 201 for POST):
  // Meta marks any non-200 delivery as failed/pending and retries, even though we process
  // the event fire-and-forget.
  @Post('webhook')
  @HttpCode(200)
  handleEvent(
    @Body() payload: FacebookWebhookPayload | WhatsAppWebhookPayload,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: Request,
  ) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const valid = this.fb.verifySignature(rawBody ? rawBody.toString('utf8') : JSON.stringify(payload), signature ?? '');
    if (!valid) throw new UnauthorizedException(ErrorMessages.integrations.invalidSignature);
    this.fb.processLeadEvent(payload);
    return { status: 'ok' };
  }
}
