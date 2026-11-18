import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LeadStage } from '@prisma/client';
import { STAGE_COLORS, type StageColor } from '../../../common/constants/lead.constants';

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  readonly label?: string;

  @IsOptional()
  @IsIn(STAGE_COLORS)
  readonly color?: StageColor;

  @IsOptional()
  @IsBoolean()
  readonly isHidden?: boolean;

  // Only valid for custom stages.
  @IsOptional()
  @IsEnum(LeadStage)
  readonly countsAs?: LeadStage;
}
