import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from 'class-validator';
import { Industry, OrgSize, BillingInterval, WorkspaceType } from '@prisma/client';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  orgName: string;

  // Permanent (see AuthService.register / CLAUDE.md Phase 0) — chosen at signup,
  // never accepted on org update (UpdateOrganizationDto omits it entirely).
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

  // Must be explicitly true — checked in AuthService.register(), since class-validator
  // has no built-in "must equal true" decorator. Every signup path (email or SSO
  // completeProfile) requires this.
  @IsBoolean()
  acceptedTerms: boolean;

  // ── Plan & payment (Step 3) ──────────────────────────────────────────────
  // Omitted or 'trial' → free trial, unchanged behavior. A real plan id kicks off
  // a Razorpay subscription for the new org — see AuthService.register().
  @IsOptional()
  @IsString()
  selectedPlanId?: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsInt()
  @Min(1)
  seats?: number;

  @IsOptional()
  @IsString()
  couponCode?: string;
}
