import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const ENTITY_TYPES = ['Quotation', 'Costing', 'PaymentTerms', 'Credit'];
const TYPES = ['Discount', 'Margin', 'PaymentTerms', 'CreditTerms'];

export class CreateApprovalDto {
  @IsString() @IsNotEmpty() title: string;
  @IsIn(ENTITY_TYPES) entityType: string;
  @IsString() @IsNotEmpty() entityId: string;
  @IsIn(TYPES) type: string;
  @IsOptional() @IsString() currentApprover?: string;
  @IsOptional() @IsString() reason?: string;
}
