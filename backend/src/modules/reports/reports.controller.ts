import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import { TeamPerformanceFilterDto } from './dto/team-performance-filter.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.reports.overview(user);
  }

  @Get('pipeline')
  pipeline(@CurrentUser() user: AuthUser) {
    return this.reports.pipeline(user);
  }

  @Get('productivity')
  productivity(@Query() query: TeamPerformanceFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.productivity(user, query);
  }

  @Get('source-performance')
  sourcePerformance(@Query() query: TeamPerformanceFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.sourcePerformance(user, query);
  }

  @Get('team-leaderboard')
  teamLeaderboard(@Query() query: TeamPerformanceFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.teamLeaderboard(user, query);
  }

  // ─── Daily Sales & Lead Management Report ──────────────────────────────────

  @Get('daily/summary')
  dailySummary(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.dailySummary(filter, user);
  }

  @Get('daily/status')
  statusReport(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.statusReport(filter, user);
  }

  @Get('daily/enrollment')
  enrollmentReport(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.enrollmentReport(filter, user);
  }

  @Get('daily/campaigns')
  campaignPerformance(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.campaignPerformance(filter, user);
  }

  @Get('daily/adsets')
  adSetPerformance(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.adSetPerformance(filter, user);
  }

  @Get('daily/ads')
  adPerformance(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.adPerformance(filter, user);
  }

  @Get('daily/lead-sources')
  leadSourceTracking(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.leadSourceTracking(filter, user);
  }

  @Get('daily/dashboard')
  dailyDashboard(@Query() filter: ReportFilterDto, @CurrentUser() user: AuthUser) {
    return this.reports.dailyDashboard(filter, user);
  }

  @Get('daily/campaign-options')
  campaignOptions(@CurrentUser() user: AuthUser) {
    return this.reports.campaignOptions(user);
  }

  @Get('daily/export')
  async exportDailyReport(
    @Query() filter: ReportFilterDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const format = filter.format ?? 'csv';
    const { buffer, contentType, filename } = await this.reports.exportDailyReport(format, filter, user);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }
}
