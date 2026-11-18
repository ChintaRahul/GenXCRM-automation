import { Module } from '@nestjs/common';
import { IntegrationsConfigController } from './integrations-config.controller';
import { IntegrationsConfigService } from './integrations-config.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { FacebookInsightsModule } from '../facebook-insights/facebook-insights.module';
import { FacebookLeadBackfillModule } from '../facebook-lead-backfill/facebook-lead-backfill.module';

@Module({
  imports: [PrismaModule, FacebookInsightsModule, FacebookLeadBackfillModule],
  controllers: [IntegrationsConfigController],
  providers: [IntegrationsConfigService],
  exports: [IntegrationsConfigService],
})
export class IntegrationsConfigModule {}
