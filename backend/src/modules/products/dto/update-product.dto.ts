import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateProductDto } from './create-product.dto';
import { ProductAttributeDto } from './product-attribute.dto';

const STATUSES = ['Active', 'Inactive'];

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsOptional() @IsIn(STATUSES) status?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeDto)
  attrs?: ProductAttributeDto[];
}
