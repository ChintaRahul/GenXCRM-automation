import { IsOptional, IsString } from 'class-validator';

export class QuerySubmissionsDto {
  @IsOptional() @IsString() readonly leadId?: string;
  @IsOptional() @IsString() readonly formId?: string;
}
