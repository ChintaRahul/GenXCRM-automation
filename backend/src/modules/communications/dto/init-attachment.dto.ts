import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

export class InitAttachmentDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsIn(ALLOWED_ATTACHMENT_MIME_TYPES)
  mimeType: (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_SIZE_BYTES)
  fileSize: number;
}
