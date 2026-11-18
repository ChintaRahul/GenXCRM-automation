import { IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Min, ValidateIf } from 'class-validator';
import { RegistrationPaymentMode } from '@prisma/client';

export class RecordRegistrationPaymentDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsEnum(RegistrationPaymentMode)
  mode: RegistrationPaymentMode;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SendRegistrationPaymentLinkDto {
  @IsIn(['GATEWAY', 'CUSTOM'])
  source: 'GATEWAY' | 'CUSTOM';

  @IsOptional()
  @IsIn(['RAZORPAY', 'CASHFREE'])
  gateway?: 'RAZORPAY' | 'CASHFREE';

  @ValidateIf((o: SendRegistrationPaymentLinkDto) => o.source === 'CUSTOM')
  @IsUrl()
  customUrl?: string;

  // Lets a caller charge a not-yet-saved fee (e.g. registration step 3, before "Save
  // registration" persists it on the invoice). Falls back to the invoice's persisted
  // registrationFee when omitted (step 4, after it's already saved).
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;
}

export class RegistrationScreenshotUploadDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;
}
