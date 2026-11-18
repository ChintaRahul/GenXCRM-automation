import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const CURRENCIES = ['INR', 'USD', 'EUR'];
const PAYMENT_TERMS = ['30% advance, 60% before dispatch, 10% after installation', '100% advance', '50% advance, 50% before dispatch', '30 days credit', '60 days credit'];
const DELIVERY_TERMS = ['Ex-works', 'FOR destination', 'CIF'];

export class CreateQuotationDto {
  @IsString() @IsNotEmpty() opportunityId: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsDateString() quotationDate: string;
  @IsDateString() validUntil: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsIn(PAYMENT_TERMS) paymentTerms: string;
  @IsOptional() @IsIn(DELIVERY_TERMS) deliveryTerms?: string;
  @IsOptional() @IsString() deliveryTime?: string;
  @IsOptional() @IsString() warranty?: string;
  @IsOptional() @IsNumber() freight?: number;
  @IsOptional() @IsNumber() installation?: number;
  @IsOptional() @IsString() exclusions?: string;
  @IsOptional() @IsString() termsAndConditions?: string;
}
