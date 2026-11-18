import { PartialType } from '@nestjs/mapped-types';
import { CreateBusinessCalendarDto } from './create-business-calendar.dto';

export class UpdateBusinessCalendarDto extends PartialType(CreateBusinessCalendarDto) {}
