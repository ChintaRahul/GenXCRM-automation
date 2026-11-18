import { IsString, IsNotEmpty, MaxLength, IsObject } from 'class-validator';

export class CreateImportMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsObject()
  mappings: Record<string, string>;
}
