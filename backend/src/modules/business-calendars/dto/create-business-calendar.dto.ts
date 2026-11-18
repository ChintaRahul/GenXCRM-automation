import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateBusinessCalendarDto {
  @IsOptional() @IsString() timezone?: string;
  @IsArray() days: unknown[];
}
