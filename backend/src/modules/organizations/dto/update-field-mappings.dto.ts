import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const MAX_CUSTOM_FIELDS = 25;

class CustomFieldDefDto {
  @IsString()
  id: string;

  @IsString()
  @MaxLength(80)
  name: string;

  @IsString()
  aliases: string;
}

export class UpdateFieldMappingsDto {
  @IsOptional()
  @IsObject()
  coreFieldAliases?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_FIELDS)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldDefDto)
  customFieldDefs?: CustomFieldDefDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_FIELDS + 10)
  @IsString({ each: true })
  fieldOrder?: string[];
}
