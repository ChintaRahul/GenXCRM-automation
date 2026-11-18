import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSalesOrderDto {
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsOptional() @IsString() plant?: string;
  @IsNumber() value: number;
  @IsOptional() @IsDateString() committedDelivery?: string;
  @IsOptional() @IsString() products?: string;
  @IsOptional() @IsString() drawingRef?: string;
  @IsOptional() @IsString() installScope?: string;
  @IsOptional() @IsString() commissioningScope?: string;
  @IsOptional() @IsString() custContactId?: string;
  @IsOptional() @IsString() special?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() ownerId?: string;
}
