import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDocumentTemplateDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() numberingPattern: string;
  @IsOptional() @IsString() description?: string;
}
