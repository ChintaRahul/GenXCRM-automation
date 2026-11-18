import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const TYPES = ['Demo', 'Trial', 'Sample'];

export class CreateEvaluationDto {
  @IsString() @IsNotEmpty() title: string;
  @IsIn(TYPES) type: string;
  @IsString() @IsNotEmpty() opportunityId: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsInt() sampleQty?: number;
  @IsDateString() plannedDate: string;
  @IsOptional() @IsString() ownerId?: string;
}
