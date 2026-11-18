import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const ALLOWED_RECORDING_MIME_TYPES = [
  'audio/aac',
  'audio/amr',
  'audio/3gpp',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/x-m4a',
] as const;

export class InitCallRecordingDto {
  @IsString()
  leadId: string;

  @IsIn(ALLOWED_RECORDING_MIME_TYPES)
  mimeType: (typeof ALLOWED_RECORDING_MIME_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;
}
