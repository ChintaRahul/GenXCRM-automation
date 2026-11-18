import { Module } from '@nestjs/common';
import { MfgDashboardService } from './mfg-dashboard.service';
import { MfgDashboardController } from './mfg-dashboard.controller';

@Module({
  providers: [MfgDashboardService],
  controllers: [MfgDashboardController],
})
export class MfgDashboardModule {}
