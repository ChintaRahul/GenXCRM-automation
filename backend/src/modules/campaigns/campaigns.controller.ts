import { Controller, Get, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

// Lists the Campaign/AdSet/Ad hierarchy resolved from Facebook lead ingestion.
// spend/impressions/clicks on these rows are populated by the facebook-insights
// sync (see backend/src/modules/facebook-insights) — read-only here.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DIRECTOR, Role.MANAGER)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.campaigns.listCampaigns(user);
  }
}
