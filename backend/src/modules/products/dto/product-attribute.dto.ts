import { IsNotEmpty, IsString } from 'class-validator';

export class ProductAttributeDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() value: string;
}
