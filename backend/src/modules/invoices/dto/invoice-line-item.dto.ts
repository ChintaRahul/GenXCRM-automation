import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InvoiceLineItemDto {
  @IsOptional()
  @IsString()
  courseId?: string;

  @IsString()
  @IsNotEmpty()
  courseName: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  batchLabel?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}
