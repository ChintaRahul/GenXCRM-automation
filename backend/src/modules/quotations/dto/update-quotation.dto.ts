import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateQuotationDto } from './create-quotation.dto';
import { QuotationLineDto } from './quotation-line.dto';

export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines?: QuotationLineDto[];
}
