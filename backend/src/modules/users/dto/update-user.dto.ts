import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MfgRole, Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  // null removes the user from their team
  @IsOptional()
  @IsString()
  teamId?: string | null;

  // Monthly revenue target used by the Team Performance report's Target column
  // and progress bars — see reports.service.ts productivity().
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyTarget?: number;

  // See CreateUserDto.mfgRole.
  @IsOptional()
  @IsEnum(MfgRole)
  mfgRole?: MfgRole;
}
