import { Controller, Post, UseGuards, HttpCode } from '@nestjs/common';
import { FacebookInsightsService } from './facebook-insights.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DIRECTOR, Role.MANAGER)
@Controller('facebook-insights')
export class FacebookInsightsController {
  constructor(private readonly insights: FacebookInsightsService) {}

  // Enqueues a sync job and returns immediately — the frontend polls
  // OrgIntegration.lastSyncedAt (via GET /integrations/config) to detect completion.
  @Post('sync')
  @HttpCode(202)
  async triggerSync(@CurrentUser() caller: AuthUser) {
    await this.insights.enqueueSync(caller.orgId!);
    return { queued: true };
  }
}
