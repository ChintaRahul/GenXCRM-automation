import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDispatchDto {
  @IsString() @IsNotEmpty() salesOrderId: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsDateString() dispatchDate: string;
  @IsOptional() @IsString() qty?: string;
  @IsOptional() @IsBoolean() partial?: boolean;
  @IsOptional() @IsString() transporter?: string;
  @IsOptional() @IsString() lrNumber?: string;
  @IsOptional() @IsString() vehicleNo?: string;
  @IsOptional() @IsString() ewayBill?: string;
  @IsOptional() @IsDateString() expectedDelivery?: string;
}
