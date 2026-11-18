import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class QuotationLineDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(1) qty: number;
  @IsNumber() unitPrice: number;
  @IsOptional() @IsNumber() discountPct?: number;
  @IsOptional() @IsNumber() amount?: number;
}
