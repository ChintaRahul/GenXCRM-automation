import { IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CallOutcome } from '@prisma/client';

export class CompleteCallRecordingDto {
  @IsInt()
  @Min(0)
  durationSec: number;

  @IsInt()
  @Min(1)
  fileSize: number;

  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @IsOptional()
  @IsIn(['inbound', 'outbound'])
  direction?: 'inbound' | 'outbound';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
