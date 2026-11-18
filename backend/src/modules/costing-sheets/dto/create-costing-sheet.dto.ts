import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCostingSheetDto {
  @IsString() @IsNotEmpty() opportunityId: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsNumber() material?: number;
  @IsOptional() @IsNumber() boughtOut?: number;
  @IsOptional() @IsNumber() fabrication?: number;
  @IsOptional() @IsNumber() electrical?: number;
  @IsOptional() @IsNumber() software?: number;
  @IsOptional() @IsNumber() labor?: number;
  @IsOptional() @IsNumber() installation?: number;
  @IsOptional() @IsNumber() freight?: number;
  @IsOptional() @IsNumber() packing?: number;
  @IsOptional() @IsNumber() travel?: number;
  @IsOptional() @IsNumber() overhead?: number;
  @IsOptional() @IsNumber() contingency?: number;
  @IsOptional() @IsNumber() other?: number;
  @IsNumber() sellingPrice: number;
}
