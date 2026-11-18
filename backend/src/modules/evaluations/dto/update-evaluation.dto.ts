import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CreateEvaluationDto } from './create-evaluation.dto';

export class UpdateEvaluationDto extends PartialType(CreateEvaluationDto) {
  @IsOptional() @IsDateString() actualDate?: string;
  @IsOptional() @IsString() parameters?: string;
  @IsOptional() @IsString() application?: string;
  @IsOptional() @IsString() result?: string;
  @IsOptional() @IsString() feedback?: string;
  @IsOptional() @IsString() approvedByCustomer?: string;
  @IsOptional() @IsDateString() sampleDispatched?: string;
  @IsOptional() @IsDateString() sampleDelivered?: string;
  @IsOptional() @IsDateString() sampleTested?: string;
  @IsOptional() @IsString() nextAction?: string;
}
