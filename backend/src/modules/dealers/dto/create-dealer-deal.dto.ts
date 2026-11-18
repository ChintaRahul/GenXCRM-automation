import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export const DEAL_STATUSES = ['Registered', 'Won', 'Lost'];

export class CreateDealerDealDto {
  @IsString() @IsNotEmpty() customer: string;
  @IsString() @IsNotEmpty() product: string;
  @IsNumber() @Min(0) value: number;
  @IsOptional() @IsIn(DEAL_STATUSES) status?: string;
  @IsOptional() @IsString() notes?: string;
}
