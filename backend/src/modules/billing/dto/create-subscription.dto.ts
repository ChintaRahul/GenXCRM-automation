import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { BillingInterval } from '@prisma/client';

export class CreateSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsInt()
  @Min(1)
  userCount!: number;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @IsOptional()
  @IsString()
  couponCode?: string;

  // Restricts the Razorpay checkout to this method, so a coupon with a
  // Razorpay Offer configured for that (billingInterval, paymentMethod) pair
  // discounts the charge itself instead of falling back to a refund — see
  // BillingService.getOfferId. Omitted → always falls back to the refund path.
  @IsOptional()
  @IsIn(['card', 'upi'])
  paymentMethod?: string;
}
