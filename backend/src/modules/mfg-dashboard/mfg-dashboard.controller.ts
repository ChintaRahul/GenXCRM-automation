import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkspaceType } from '@prisma/client';
import { MfgDashboardService } from './mfg-dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { RequireWorkspace } from '../../common/decorators/require-workspace.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@RequireWorkspace(WorkspaceType.MANUFACTURING)
@Controller('mfg-dashboard')
export class MfgDashboardController {
  constructor(private readonly dashboard: MfgDashboardService) {}

  @Get('my-day')
  getMyDay(@CurrentUser() user: AuthUser) {
    return this.dashboard.getMyDay(user);
  }

  @Get('team')
  getTeam(@CurrentUser() user: AuthUser) {
    return this.dashboard.getTeam(user);
  }
}
