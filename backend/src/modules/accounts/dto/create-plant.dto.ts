import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const PLANT_TYPES = ['Manufacturing', 'Warehouse', 'Office', 'Other'];

export class CreatePlantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(PLANT_TYPES)
  type: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsOptional()
  @IsString()
  address?: string;
}
