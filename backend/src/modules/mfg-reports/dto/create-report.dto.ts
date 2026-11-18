import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const CATEGORIES = ['Leads', 'Pipeline', 'Performance', 'Quotes & orders', 'Sales', 'Finance', 'After-sales', 'Operations'];
const FREQUENCIES = ['Not scheduled', 'Daily', 'Weekly', 'Monthly'];
const FORMATS = ['Excel', 'CSV', 'PDF'];

export class CreateReportDto {
  @IsString() @IsNotEmpty() name: string;
  @IsIn(CATEGORIES) category: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() dateRange?: string;
  @IsOptional() @IsString() team?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsIn(FREQUENCIES) scheduleFrequency?: string;
  @IsOptional() @IsString() sendAt?: string;
  @IsOptional() @IsString() recipients?: string;
  @IsOptional() @IsIn(FORMATS) format?: string;
}
