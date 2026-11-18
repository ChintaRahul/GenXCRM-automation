import { IsEmail, IsEnum, IsOptional, IsString, IsArray, IsNotEmpty, IsObject, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { LeadSource } from '@prisma/client';
import { IsNotRepeatedDomainLabel } from '../../../common/validators/no-repeated-tld.validator';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  // @IsOptional() only skips validation for null/undefined, not '' — an empty
  // string from a form field with no email entered would otherwise still hit
  // @IsEmail() and fail with the raw "email must be an email" message. Blank
  // it out to undefined first so a genuinely-omitted email passes through.
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail()
  @MaxLength(254, { message: 'email must be at most 254 characters' })
  @IsNotRepeatedDomainLabel({ message: 'email domain must not repeat a segment (e.g. .com.com)' })
  email?: string;

  @IsOptional()
  @IsString()
  altPhone?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail()
  @IsNotRepeatedDomainLabel({ message: 'altEmail domain must not repeat a segment (e.g. .com.com)' })
  altEmail?: string;

  @IsOptional()
  @IsString()
  course?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsEnum(LeadSource)
  source: LeadSource;

  @IsOptional()
  @IsString()
  sourceCampaign?: string;

  @IsOptional()
  @IsString()
  sourceAdSet?: string;

  @IsOptional()
  @IsString()
  sourceAd?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rawFields?: Record<string, string>;
}
