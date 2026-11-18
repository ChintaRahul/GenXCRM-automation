import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateMasterValueDto {
  @IsString() @IsNotEmpty() category: string;
  @IsString() @IsNotEmpty() value: string;
  @IsString() @IsNotEmpty() label: string;
  @IsOptional() @IsNumber() numericValue?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}
