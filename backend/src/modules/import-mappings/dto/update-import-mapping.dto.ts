import { IsString, IsNotEmpty, MaxLength, IsObject, IsOptional } from 'class-validator';

export class UpdateImportMappingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  mappings?: Record<string, string>;
}
