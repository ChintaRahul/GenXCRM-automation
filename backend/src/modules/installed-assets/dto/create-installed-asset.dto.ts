import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const SIGNOFF_STATES = ['Pending', 'Signed'];

export class CreateInstalledAssetDto {
  @IsString() @IsNotEmpty() serial: string;
  @IsString() @IsNotEmpty() model: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsOptional() @IsString() plant?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() salesOrderId?: string;
  @IsOptional() @IsDateString() installedOn?: string;
  @IsOptional() @IsDateString() commissionedOn?: string;
  @IsOptional() @IsDateString() warrantyStart?: string;
  @IsOptional() @IsDateString() warrantyEnd?: string;
  @IsOptional() @IsIn(SIGNOFF_STATES) customerSignoff?: string;
}
