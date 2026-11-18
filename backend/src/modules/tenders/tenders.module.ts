import { Module } from '@nestjs/common';
import { TendersService } from './tenders.service';
import { TendersAdapter } from './tenders.adapter';

@Module({
  providers: [TendersService, TendersAdapter],
  exports: [TendersService],
})
export class TendersModule {}
