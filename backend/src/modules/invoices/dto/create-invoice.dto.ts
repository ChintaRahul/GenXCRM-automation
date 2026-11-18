import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceLineItemDto } from './invoice-line-item.dto';
import type { DiscountType, GstType } from '../invoices.math';

export class CreateInvoiceDto {
  @IsString()
  leadId: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems: InvoiceLineItemDto[];

  @IsBoolean()
  gstEnabled: boolean;

  @IsIn(['CGST_SGST', 'IGST'])
  gstType: GstType;

  @IsNumber()
  @Min(0)
  @Max(100)
  gstRate: number;

  @IsIn(['PERCENT', 'FLAT'])
  discountType: DiscountType;

  @IsNumber()
  @Min(0)
  discountValue: number;
}
