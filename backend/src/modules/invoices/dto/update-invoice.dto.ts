import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RegistrationPaymentMode } from '@prisma/client';
import { InvoiceLineItemDto } from './invoice-line-item.dto';
import type { DiscountType, GstType } from '../invoices.math';

// Registration-specific fields are deliberately not part of CreateInvoiceDto (a normal
// invoice is never created with them) but are editable after the fact — e.g. correcting
// the fee amount or payment mode logged during Register's step 3.
export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems?: InvoiceLineItemDto[];

  @IsOptional()
  @IsBoolean()
  gstEnabled?: boolean;

  @IsOptional()
  @IsIn(['CGST_SGST', 'IGST'])
  gstType?: GstType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  gstRate?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FLAT'])
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  registrationFee?: number;

  @IsOptional()
  @IsEnum(RegistrationPaymentMode)
  registrationPaymentMode?: RegistrationPaymentMode;

  @IsOptional()
  @IsString()
  registrationNote?: string;
}
