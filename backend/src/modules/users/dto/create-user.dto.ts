import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MfgRole, Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Optional — by default the invited member sets their own password via an
  // emailed link. If provided here, it is honored and no invite link is sent.
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsString()
  teamId?: string;

  // Manufacturing-workspace-only granular role (Sales Head, Operations, Service Engineer,
  // ...) that Administration > Roles & Permissions' RolePermission matrix keys off of. Never
  // set for EdTech orgs. Director-only to assign — see UsersService.create/update.
  @IsOptional()
  @IsEnum(MfgRole)
  mfgRole?: MfgRole;
}
