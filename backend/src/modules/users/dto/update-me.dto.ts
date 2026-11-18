import { IsOptional, IsString, MinLength } from 'class-validator';

// Email is intentionally excluded — it's read-only for self-service updates.
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  newPassword?: string;
}
