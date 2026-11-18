import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Industry, OrgSize } from '@prisma/client';

// Indian GSTIN: 2-digit state code + 10-char PAN + 1 entity digit + 'Z' + 1 checksum char (15 total).
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export class UpdateOrganizationDto {
  // Optional. Empty string clears the value; any non-empty value must be a valid GSTIN.
  @IsOptional()
  @ValidateIf((o: UpdateOrganizationDto) => o.gstNumber !== '' && o.gstNumber != null)
  @Matches(GSTIN_REGEX, { message: 'Enter a valid 15-character GSTIN' })
  gstNumber?: string | null;

  // Whether a sales rep gets an email when a lead is assigned to them.
  @IsOptional()
  @IsBoolean()
  notifyRepOnAssignment?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsOptional()
  @IsEnum(OrgSize)
  size?: OrgSize;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  // Shown on invoice PDFs and student-facing communications, in place of the
  // per-user email/phone. Empty string clears the value.
  @IsOptional()
  @ValidateIf((o: UpdateOrganizationDto) => o.email !== '')
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
