import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const ACTIVITY_TYPES = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Site visit', 'Demo', 'Quotation follow-up', 'PO follow-up', 'Payment follow-up', 'Service follow-up'];
const PRIORITIES = ['High', 'Medium', 'Low'];

export class CreateMfgActivityDto {
  @IsIn(ACTIVITY_TYPES)
  type: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  mfgLeadId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  dueTime?: string;

  @IsIn(PRIORITIES)
  priority: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
