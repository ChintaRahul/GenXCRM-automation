import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CallOutcome } from '@prisma/client';
import { InitCallRecordingDto } from './dto/init-call-recording.dto';
import { CompleteCallRecordingDto } from './dto/complete-call-recording.dto';
import { InitAttachmentDto } from './dto/init-attachment.dto';

@UseGuards(JwtAuthGuard)
@Controller('communications')
export class CommunicationsController {
  constructor(private comms: CommunicationsService) {}

  @Post('email')
  sendEmail(
    @Body() body: { leadId: string; subject: string; body: string; attachmentIds?: string[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.comms.sendEmail(body.leadId, body.subject, body.body, user, undefined, body.attachmentIds);
  }

  @Post('sms')
  sendSms(@Body() body: { leadId: string; message: string }, @CurrentUser() user: AuthUser) {
    return this.comms.sendSms(body.leadId, body.message, user);
  }

  @Post('whatsapp')
  sendWhatsApp(
    @Body() body: { leadId: string; message: string; attachmentIds?: string[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.comms.sendWhatsApp(body.leadId, body.message, user, body.attachmentIds);
  }

  // Sends an approved WhatsApp template — the only way to message a lead outside the 24h
  // free-form reply window. `params` are the literal values for the template's {{1}}..{{n}}
  // body variables, in order, as the caller (an agent, from the lead's Communications panel) typed them.
  @Post('whatsapp/template')
  sendWhatsAppTemplate(
    @Body() body: { leadId: string; templateName: string; language: string; params: string[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.comms.sendWhatsAppTemplate(body.leadId, body.templateName, body.language, body.params, user);
  }

  @Post('call')
  logCall(
    @Body() body: { leadId: string; durationSec: number; notes: string; outcome?: CallOutcome; direction?: 'inbound' | 'outbound' },
    @CurrentUser() user: AuthUser,
  ) {
    return this.comms.logCall(body.leadId, body.durationSec, body.notes, user, body.outcome, body.direction);
  }

  @Get(':leadId/history')
  history(@Param('leadId') leadId: string, @CurrentUser() user: AuthUser) {
    return this.comms.getHistory(leadId, user);
  }

  @Post(':leadId/call-alert')
  sendCallAlert(@Param('leadId') leadId: string, @CurrentUser() user: AuthUser) {
    return this.comms.sendCallAlert(leadId, user);
  }

  @Get('stats/overview')
  stats(@CurrentUser() user: AuthUser) {
    return this.comms.getStats(user);
  }

  @Get('call-log')
  callLog(@Query('page') page: string | undefined, @Query('limit') limit: string | undefined, @CurrentUser() user: AuthUser) {
    return this.comms.getCallLog(user, page ? Number(page) : undefined, limit ? Number(limit) : undefined);
  }

  @Post('call-recordings/init')
  initCallRecording(@Body() dto: InitCallRecordingDto, @CurrentUser() user: AuthUser) {
    return this.comms.initCallRecording(dto, user);
  }

  @Post('call-recordings/:id/complete')
  completeCallRecording(@Param('id') id: string, @Body() dto: CompleteCallRecordingDto, @CurrentUser() user: AuthUser) {
    return this.comms.completeCallRecording(id, dto, user);
  }

  @Get('call-recordings/:id/playback-url')
  getRecordingPlaybackUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.comms.getRecordingPlaybackUrl(id, user);
  }

  @Get('attachments')
  listAttachmentsMeta(@Query('ids') ids: string | undefined, @CurrentUser() user: AuthUser) {
    return this.comms.listAttachmentsMeta(ids ? ids.split(',').filter(Boolean) : [], user);
  }

  @Post('attachments/init')
  initAttachmentUpload(@Body() dto: InitAttachmentDto, @CurrentUser() user: AuthUser) {
    return this.comms.initAttachmentUpload(dto, user);
  }

  @Post('attachments/:id/complete')
  completeAttachmentUpload(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.comms.completeAttachmentUpload(id, user);
  }

  @Get('attachments/:id/url')
  getAttachmentDownloadUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.comms.getAttachmentDownloadUrl(id, user);
  }
}
