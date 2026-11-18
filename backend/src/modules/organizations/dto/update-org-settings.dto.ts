import { IsObject, IsOptional } from 'class-validator';

// Each section is saved as a full replacement blob by its own tab's "Save
// changes" button — validated loosely as an object here; the service applies
// the actual defaults/shape via DEFAULT_* constants.
export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsObject()
  security?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  notifications?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  routing?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  payments?: Record<string, unknown>;
}
