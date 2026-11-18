import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

const CURRENCIES = ['INR', 'USD', 'EUR'];

export class CreatePurchaseOrderDto {
  @IsString() @IsNotEmpty() poNo: string;
  @IsDateString() poDate: string;
  @IsString() @IsNotEmpty() opportunityId: string;
  @IsString() @IsNotEmpty() quotationId: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsNumber() value: number;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() billingAddress?: string;
  @IsOptional() @IsString() shippingAddress?: string;
  @IsOptional() @IsString() specialTerms?: string;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
  @IsOptional() @IsString() products?: string;
  @IsOptional() @IsString() ownerId?: string;
}
