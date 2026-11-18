import { IsEnum, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { LeadStage } from '@prisma/client';
import { STAGE_COLORS, type StageColor } from '../../../common/constants/lead.constants';

export class CreateStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  readonly label!: string;

  @IsIn(STAGE_COLORS)
  readonly color!: StageColor;

  @IsEnum(LeadStage)
  readonly countsAs!: LeadStage;
}
