import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateDealerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() territory: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) commission?: number;
  @IsOptional() @IsString() ownerId?: string;
}
