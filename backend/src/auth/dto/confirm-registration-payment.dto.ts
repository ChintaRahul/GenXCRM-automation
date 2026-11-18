import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ConfirmRegistrationPaymentDto {
  @IsUUID()
  orgId!: string;

  @IsString()
  @IsNotEmpty()
  razorpayPaymentId!: string;

  @IsString()
  @IsNotEmpty()
  razorpaySubscriptionId!: string;

  @IsString()
  @IsNotEmpty()
  razorpaySignature!: string;
}
