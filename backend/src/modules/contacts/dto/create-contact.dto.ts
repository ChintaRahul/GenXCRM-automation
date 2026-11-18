import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const DEPARTMENTS = ['Management', 'Projects', 'Purchase', 'Maintenance', 'Production', 'Quality', 'Finance', 'Stores'];
const CHANNELS = ['Phone', 'WhatsApp', 'Email', 'In person'];
const BUYING_ROLES = ['Decision Maker', 'Technical Influencer', 'User', 'Procurement', 'Finance', 'Gatekeeper', 'Management'];
const INFLUENCE = ['High', 'Medium', 'Low'];

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsOptional()
  @IsString()
  plant?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsIn(DEPARTMENTS)
  department?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: string;

  @IsIn(BUYING_ROLES)
  role: string;

  @IsOptional()
  @IsIn(INFLUENCE)
  influence?: string;
}
