import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFieldPermissionDto {
  @IsString() @IsNotEmpty() moduleKey: string;
  @IsString() @IsNotEmpty() fieldLabel: string;
  @IsOptional() @IsArray() @IsString({ each: true }) restrictedToRoles?: string[];
}
