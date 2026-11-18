import {
  IsEnum,
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  Equals,
  IsNotEmpty,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { LeadStage } from '@prisma/client';

export class UpdateLeadDto {
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(100)
  @IsString()
  name?: string;

  // Explicit null unassigns the lead (used by the Owner cell's "Remove assignment"
  // action); a non-null id must go through POST /leads/:id/reassign instead, which
  // also validates the target user is in scope.
  @IsOptional()
  @Equals(null)
  assignedToId?: null;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  altEmail?: string;

  @IsOptional()
  @IsString()
  course?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  // Custom (org-defined) stage; the service sets `stage` to its countsAs built-in.
  @IsOptional()
  @IsString()
  customStageId?: string;

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  notInterestedReason?: string;

  @IsOptional()
  customFields?: Record<string, unknown>;

  // ISO date-time to schedule the next follow-up; explicit null clears it (follow-up done).
  @IsOptional()
  @IsDateString()
  followUpAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  followUpNote?: string;
}
