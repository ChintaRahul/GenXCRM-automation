import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorMessages } from '../../common/constants/messages';
import { HubsService } from './hubs.service';
import { isHubSlug } from './hubs.util';

@Controller('integrations/hubs')
export class HubsController {
  constructor(
    private readonly hubs: HubsService,
    private readonly prisma: PrismaService,
  ) {}

  // Org-specific URL — the unguessable orgToken routes to the tenant and acts as the shared secret
  // (marketplaces cannot sign requests). Marketplaces expect a plain 200, not NestJS's POST 201.
  @Post(':orgToken/:hub')
  @HttpCode(200)
  receive(@Param('orgToken') orgToken: string, @Param('hub') hub: string, @Body() body: unknown) {
    return this.handle(orgToken, hub, body);
  }

  // JustDial delivers each enquiry as a GET with the fields in the query string.
  @Get(':orgToken/:hub')
  receiveGet(@Param('orgToken') orgToken: string, @Param('hub') hub: string, @Query() query: Record<string, unknown>) {
    return this.handle(orgToken, hub, query);
  }

  private async handle(orgToken: string, hub: string, body: unknown) {
    if (!isHubSlug(hub)) throw new NotFoundException(ErrorMessages.integrations.unknownOrg);
    const org = await this.prisma.organization.findUnique({
      where: { orgWebhookToken: orgToken },
      select: { id: true, workspaceType: true },
    });
    if (!org) throw new NotFoundException(ErrorMessages.integrations.unknownOrg);
    const result = await this.hubs.ingest(hub, body, org.id, org.workspaceType);
    return { code: 200, status: 'SUCCESS', ...result };
  }
}
