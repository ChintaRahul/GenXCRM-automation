import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class SendInvoiceDto {
  @IsBoolean()
  attachPaymentLink: boolean;

  @IsOptional()
  @IsIn(['RAZORPAY', 'CASHFREE'])
  gateway?: 'RAZORPAY' | 'CASHFREE';
}
