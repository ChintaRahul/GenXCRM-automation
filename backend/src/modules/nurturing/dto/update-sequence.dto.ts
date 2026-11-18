import { LeadStage } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateSequenceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  triggerEvent?: string;

  @IsOptional()
  @IsEnum(LeadStage)
  triggerStage?: LeadStage | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
