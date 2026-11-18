import { LeadStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateSequenceDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  triggerEvent?: string;

  @IsOptional()
  @IsEnum(LeadStage)
  triggerStage?: LeadStage;
}
