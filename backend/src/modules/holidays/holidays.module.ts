import { Module } from '@nestjs/common';
import { HolidaysService } from './holidays.service';
import { HolidaysAdapter } from './holidays.adapter';

@Module({
  providers: [HolidaysService, HolidaysAdapter],
  exports: [HolidaysService],
})
export class HolidaysModule {}
