import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NurturingController } from './nurturing.controller';
import { NurturingService } from './nurturing.service';
import { NurturingProcessor } from './nurturing.processor';
import { MfgNurturingService } from './mfg-nurturing.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  imports: [PrismaModule, CommunicationsModule, BullModule.registerQueue({ name: 'nurturing' })],
  controllers: [NurturingController],
  providers: [NurturingService, MfgNurturingService, NurturingProcessor],
  exports: [NurturingService, MfgNurturingService],
})
export class NurturingModule {}
