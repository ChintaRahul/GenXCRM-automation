import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { IngestionAlertsService } from './ingestion-alerts.service';
import { IngestionAlertsProcessor } from './ingestion-alerts.processor';

@Module({
  imports: [PrismaModule, MailModule, BullModule.registerQueue({ name: 'ingestion-alerts' })],
  providers: [IngestionAlertsService, IngestionAlertsProcessor],
  exports: [IngestionAlertsService],
})
export class IngestionAlertsModule {}
