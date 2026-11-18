import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const MILESTONES = ['Advance', 'Before dispatch', 'After delivery', 'After installation', 'Retention'];

export class CreatePaymentMilestoneDto {
  @IsString() @IsNotEmpty() salesOrderId: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsIn(MILESTONES) milestone: string;
  @IsOptional() @IsNumber() pct?: number;
  @IsNumber() amount: number;
  @IsDateString() dueDate: string;
  @IsOptional() @IsString() invoiceRef?: string;
  @IsOptional() @IsString() accountsOwnerId?: string;
  @IsOptional() @IsString() ownerId?: string;
}
