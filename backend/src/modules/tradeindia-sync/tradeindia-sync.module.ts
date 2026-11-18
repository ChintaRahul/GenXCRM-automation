import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { TradeIndiaSyncService } from './tradeindia-sync.service';
import { TradeIndiaSyncProcessor } from './tradeindia-sync.processor';

@Module({
  imports: [PrismaModule, IntegrationsModule, BullModule.registerQueue({ name: 'tradeindia-sync' })],
  providers: [TradeIndiaSyncService, TradeIndiaSyncProcessor],
})
export class TradeIndiaSyncModule {}
