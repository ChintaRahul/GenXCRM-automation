import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadSource } from '@prisma/client';

export class BackfillLeadsDto {
  @IsOptional()
  @IsArray()
  @IsEnum(LeadSource, { each: true })
  sources?: LeadSource[];

  // Core field keys (course, location, ...) and/or custom field ids. Omit for all.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];
}
