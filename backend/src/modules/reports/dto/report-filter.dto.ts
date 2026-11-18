import { IsOptional, IsString, IsDateString, IsInt, IsIn, IsBoolean, IsArray, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

// Shared filter for every /reports/daily/* endpoint. `from`/`to` default to "today"
// (UTC) when omitted, matching the report's "daily" framing.
export class ReportFilterDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  teamMemberId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsIn(['csv', 'excel', 'pdf'])
  format?: 'csv' | 'excel' | 'pdf';

  // Query-string booleans arrive as the strings "true"/"false" — @Type(() => Boolean) would
  // coerce "false" to true (any non-empty string is truthy), so transform explicitly instead.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeCharts?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeCover?: boolean;

  @IsOptional()
  @IsIn(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  // PDF export only — matches whichever theme (light/dark) was active in the app when the
  // caller requested the export, so the downloaded file isn't always a light "paper" PDF.
  @IsOptional()
  @IsIn(['light', 'dark'])
  theme?: 'light' | 'dark';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsIn(
    ['summary', 'status', 'enrollment', 'campaign', 'sources', 'dashboard', 'adsets', 'ads'],
    { each: true },
  )
  sections?: string[];
}
