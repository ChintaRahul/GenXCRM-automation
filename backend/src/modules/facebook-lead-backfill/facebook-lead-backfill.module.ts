import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { FacebookLeadBackfillService } from './facebook-lead-backfill.service';
import { FacebookLeadBackfillProcessor } from './facebook-lead-backfill.processor';

@Module({
  imports: [PrismaModule, IntegrationsModule, BullModule.registerQueue({ name: 'facebook-lead-backfill' })],
  providers: [FacebookLeadBackfillService, FacebookLeadBackfillProcessor],
  exports: [FacebookLeadBackfillService],
})
export class FacebookLeadBackfillModule {}
