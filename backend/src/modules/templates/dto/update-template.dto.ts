import { IsString, IsNotEmpty, IsOptional, IsIn, MaxLength } from 'class-validator';
import { TEMPLATE_CATEGORIES } from './create-template.dto';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body?: string;

  @IsOptional()
  @IsIn(TEMPLATE_CATEGORIES)
  category?: (typeof TEMPLATE_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;
}
