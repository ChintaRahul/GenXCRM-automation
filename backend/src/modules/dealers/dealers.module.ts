import { Module } from '@nestjs/common';
import { DealersService } from './dealers.service';
import { DealersAdapter } from './dealers.adapter';

@Module({
  providers: [DealersService, DealersAdapter],
  exports: [DealersService],
})
export class DealersModule {}
