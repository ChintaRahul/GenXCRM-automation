import { Module } from '@nestjs/common';
import { BusinessCalendarsService } from './business-calendars.service';
import { BusinessCalendarsAdapter } from './business-calendars.adapter';

@Module({
  providers: [BusinessCalendarsService, BusinessCalendarsAdapter],
  exports: [BusinessCalendarsService],
})
export class BusinessCalendarsModule {}
