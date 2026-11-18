import { IsOptional, IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsOptional()
  @IsUUID()
  planId?: string;
}
