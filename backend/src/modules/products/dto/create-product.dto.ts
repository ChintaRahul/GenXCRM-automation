import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const CATEGORIES = ['Weighbridges', 'Belt weighers', 'Checkweighers', 'Bagging & packing', 'Conveyors', 'Components', 'Services'];
const UOMS = ['Nos', 'Set', 'Lot', 'Metre', 'Year'];
const GST_RATES = ['5', '12', '18', '28'];

export class CreateProductDto {
  @IsIn(CATEGORIES) category: string;
  @IsString() @IsNotEmpty() family: string;
  @IsString() @IsNotEmpty() model: string;
  @IsString() @IsNotEmpty() sku: string;
  @IsOptional() @IsString() variant?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(UOMS) uom?: string;
  @IsOptional() @IsString() hsn?: string;
  @IsOptional() @IsIn(GST_RATES) gstRate?: string;
  @IsNumber() price: number;
  @IsOptional() @IsNumber() minPrice?: number;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsString() leadTime?: string;
  @IsOptional() @IsInt() warrantyMonths?: number;
}
