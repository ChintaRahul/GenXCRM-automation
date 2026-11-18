import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CreateSiteVisitDto } from './create-site-visit.dto';

export class UpdateSiteVisitDto extends PartialType(CreateSiteVisitDto) {
  @IsOptional() @IsString() existingSystem?: string;
  @IsOptional() @IsString() customerProblem?: string;
  @IsOptional() @IsString() measurements?: string;
  @IsOptional() @IsString() observations?: string;
  @IsOptional() @IsString() recommendation?: string;
  @IsOptional() @IsString() customerComments?: string;
  @IsOptional() @IsString() nextAction?: string;
  @IsOptional() @IsDateString() nextActionDate?: string;
}
