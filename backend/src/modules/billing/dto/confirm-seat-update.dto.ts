import { IsInt, IsString, Min } from 'class-validator';

export class ConfirmSeatUpdateDto {
  @IsInt()
  @Min(1)
  userCount!: number;

  @IsString()
  razorpayOrderId!: string;

  @IsString()
  razorpayPaymentId!: string;

  @IsString()
  razorpaySignature!: string;
}
