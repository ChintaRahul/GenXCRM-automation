import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateMfgActivityDto } from './create-mfg-activity.dto';

export class UpdateMfgActivityDto extends PartialType(CreateMfgActivityDto) {
  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;

  @IsOptional()
  @IsString()
  nextActionDate?: string;
}
