import { IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';

const TYPES = ['Discount', 'Margin', 'PaymentTerms', 'CreditTerms'];

export class CreateApprovalRuleDto {
  @IsIn(TYPES) type: string;
  @IsNumber() min: number;
  @IsNumber() max: number;
  @IsString() @IsNotEmpty() approverRole: string;
}
