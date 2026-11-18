import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { Industry, OrgSize, WorkspaceType } from '@prisma/client';

export class CompleteProfileDto {
  @IsString()
  orgName: string;

  // Must be explicitly true — checked in AuthService.completeProfile(), since
  // class-validator has no built-in "must equal true" decorator.
  @IsBoolean()
  acceptedTerms: boolean;

  // Permanent (see AuthService.completeProfile / CLAUDE.md Phase 0) — chosen at
  // signup, never accepted on org update (UpdateOrganizationDto omits it entirely).
  // Optional for backward compatibility: a client that doesn't yet send it
  // (e.g. an already-deployed Android APK) defaults to WorkspaceType.EDTECH
  // in AuthService, matching the Prisma column's own @default(EDTECH).
  @IsOptional()
  @IsEnum(WorkspaceType)
  workspaceType?: WorkspaceType;

  // Optional as of the workspace-type signup step: when omitted, AuthService
  // derives it from workspaceType. Still honored if a client sends it explicitly.
  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsEnum(OrgSize)
  orgSize: OrgSize;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  country: string;

  @IsString()
  timezone: string;
}
