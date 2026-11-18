import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSiteVisitDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() opportunityId?: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsOptional() @IsString() plant?: string;
  @IsDateString() visitDate: string;
  @IsOptional() @IsString() time?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() engineers?: string;
  @IsString() @IsNotEmpty() objective: string;
}
