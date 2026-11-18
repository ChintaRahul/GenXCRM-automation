import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateTenderDto {
  @IsString() @IsNotEmpty() title: string;
  @IsString() @IsNotEmpty() tenderNo: string;
  @IsString() @IsNotEmpty() authority: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() opportunityId?: string;
  @IsNumber() @Min(0) estimatedValue: number;
  @IsOptional() @IsDateString() publishedOn?: string;
  @IsDateString() submissionDeadline: string;
  @IsOptional() @IsDateString() openingDate?: string;
  @IsOptional() @IsNumber() @Min(0) emdAmount?: number;
  @IsOptional() @IsBoolean() docsReady?: boolean;
  @IsOptional() @IsBoolean() technicalBidReady?: boolean;
  @IsOptional() @IsBoolean() financialBidReady?: boolean;
  @IsOptional() @IsBoolean() preBidAttended?: boolean;
  @IsOptional() @IsString() ownerId?: string;
}
