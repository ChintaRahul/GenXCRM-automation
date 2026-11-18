import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ReminderChannel } from '@prisma/client';

export class CreateEmiPlanDto {
  @IsInt()
  @Min(1)
  @Max(60)
  tenureMonths: number;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  negotiatedAmount?: number;
}

export class CreateEmiMandateDto extends CreateEmiPlanDto {
  // Which connected gateway sets up the auto-debit. Defaults to Razorpay (the original behaviour).
  @IsOptional()
  @IsIn(['RAZORPAY', 'CASHFREE'])
  gateway?: 'RAZORPAY' | 'CASHFREE';
}

export class RemindInstallmentDto {
  @IsEnum(ReminderChannel)
  channel: ReminderChannel;
}
