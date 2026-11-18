import { IsEnum, IsInt, Min } from 'class-validator';
import { AddonType } from '@prisma/client';

export class PurchaseAddonDto {
  @IsEnum(AddonType)
  type!: AddonType;

  @IsInt()
  @Min(1)
  quantity!: number;
}
