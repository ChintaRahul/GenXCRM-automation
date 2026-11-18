import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const RECORD_ACCESS_SCOPES = ['OWN', 'TEAM', 'ALL'] as const;

export class CreateRolePermissionDto {
  @IsString() @IsNotEmpty() role: string;
  @IsString() @IsNotEmpty() moduleKey: string;
  @IsOptional() @IsIn(RECORD_ACCESS_SCOPES) recordAccess?: (typeof RECORD_ACCESS_SCOPES)[number];
  @IsOptional() @IsBoolean() canCreate?: boolean;
  @IsOptional() @IsBoolean() canRead?: boolean;
  @IsOptional() @IsBoolean() canUpdate?: boolean;
  @IsOptional() @IsBoolean() canDelete?: boolean;
  @IsOptional() @IsBoolean() canExport?: boolean;
}
