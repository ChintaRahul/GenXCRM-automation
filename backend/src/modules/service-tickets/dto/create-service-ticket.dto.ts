import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const COMPLAINT_TYPES = ['Breakdown', 'Calibration', 'Preventive maintenance', 'Installation issue', 'Software / integration'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const COVERAGE_STATES = ['In warranty', 'Under AMC', 'Chargeable'];

export class CreateServiceTicketDto {
  @IsString() @IsNotEmpty() description: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsOptional() @IsString() plant?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsIn(COMPLAINT_TYPES) complaintType: string;
  @IsIn(PRIORITIES) priority: string;
  @IsOptional() @IsIn(COVERAGE_STATES) coverage?: string;
  @IsOptional() @IsString() responseDue?: string;
  @IsOptional() @IsString() diagnosis?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsIn(['Pending', 'Confirmed']) customerConfirmation?: string;
  @IsOptional() @IsBoolean() chargeable?: boolean;
}
