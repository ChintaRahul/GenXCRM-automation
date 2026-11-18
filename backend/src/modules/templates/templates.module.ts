import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { WhatsappTemplatesProcessor } from './whatsapp-templates.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappModule } from '../../integrations/whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, WhatsappModule, BullModule.registerQueue({ name: 'whatsapp-templates' })],
  controllers: [TemplatesController],
  providers: [TemplatesService, WhatsappTemplatesProcessor],
  exports: [TemplatesService],
})
export class TemplatesModule {}
