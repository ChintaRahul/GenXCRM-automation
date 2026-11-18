import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const CALENDAR_TYPES = ['Business hours', 'Calendar days', '24 x 7'];

export class CreateSlaPolicyDto {
  @IsString() @IsNotEmpty() moduleKey: string;
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() startEvent: string;
  @IsString() @IsNotEmpty() stopEvent: string;
  @IsIn(CALENDAR_TYPES) calendarType: string;
  @IsArray() targets: unknown[];
  @IsArray() escalationLevels: unknown[];
  @IsOptional() @IsArray() @IsString({ each: true }) pauseStatuses?: string[];
}
