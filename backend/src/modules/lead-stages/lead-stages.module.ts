import { Module } from '@nestjs/common';
import { LeadStagesController } from './lead-stages.controller';
import { LeadStagesService } from './lead-stages.service';

@Module({
  controllers: [LeadStagesController],
  providers: [LeadStagesService],
  exports: [LeadStagesService],
})
export class LeadStagesModule {}
