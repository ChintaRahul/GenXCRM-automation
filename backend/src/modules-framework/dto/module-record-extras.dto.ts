import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export const MODULE_DOCUMENT_MIME_TYPES = [
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
  // CAD drawings (RFQ attachments): browsers report no usable type for these, so the client labels them by extension.
  'image/vnd.dwg',
  'image/vnd.dxf',
] as const;

export const MAX_MODULE_DOCUMENT_BYTES = 20 * 1024 * 1024;

// Body of POST /modules/:moduleKey/:id/documents — asks for a presigned upload URL.
export class InitModuleDocumentDto {
  @IsString()
  @MaxLength(255)
  readonly fileName!: string;

  @IsIn(MODULE_DOCUMENT_MIME_TYPES)
  readonly mimeType!: (typeof MODULE_DOCUMENT_MIME_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(MAX_MODULE_DOCUMENT_BYTES)
  readonly fileSize!: number;
}

// Body of PUT /modules/:moduleKey/column-prefs — the ordered column keys the user wants shown.
export class SaveColumnPrefsDto {
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  readonly keys!: string[];
}
