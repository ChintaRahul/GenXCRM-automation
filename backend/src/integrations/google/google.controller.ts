import { Controller, Post, Body, Param, HttpCode, NotFoundException } from '@nestjs/common';
import { GoogleService, GoogleLeadPayload } from './google.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorMessages } from '../../common/constants/messages';

@Controller('integrations/google')
export class GoogleController {
  constructor(
    private readonly google: GoogleService,
    private readonly prisma: PrismaService,
  ) {}

  // Org-specific URL — orgToken in path routes to the correct tenant.
  // Must return 200 (not NestJS's default 201 for POST): Google's lead form webhook
  // validation requires a 2xx and specifically checks for 200 when sending the test lead.
  @Post(':orgToken/webhook')
  @HttpCode(200)
  async handleLead(@Param('orgToken') orgToken: string, @Body() payload: GoogleLeadPayload) {
    const org = await this.prisma.organization.findUnique({
      where: { orgWebhookToken: orgToken },
      select: { id: true },
    });
    if (!org) throw new NotFoundException(ErrorMessages.integrations.unknownOrg);
    return this.google.processLead(payload, org.id);
  }
}
