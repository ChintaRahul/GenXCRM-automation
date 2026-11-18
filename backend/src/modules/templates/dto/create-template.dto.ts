import { IsString, IsNotEmpty, IsOptional, IsEnum, IsIn, MaxLength } from 'class-validator';
import { TemplateChannel } from '@prisma/client';

export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;

export class CreateTemplateDto {
  @IsEnum(TemplateChannel)
  channel: TemplateChannel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  // Email only — WhatsApp templates are free-form text with no subject.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body: string;

  // WhatsApp only — Meta template category (defaults to MARKETING in the service) and language.
  @IsOptional()
  @IsIn(TEMPLATE_CATEGORIES)
  category?: (typeof TEMPLATE_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;
}
