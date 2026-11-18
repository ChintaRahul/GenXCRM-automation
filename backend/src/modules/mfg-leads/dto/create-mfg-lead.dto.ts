import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export const PRODUCTS = ['Weighbridge', 'Belt weigher', 'Checkweigher', 'Bagging machine', 'Conveyor', 'Load cells', 'Platform scale', 'Filling scale', 'AMC / Service'];
export const SOURCES = ['Website', 'Google Ads', 'Meta', 'IndiaMART', 'TradeIndia', 'ExportersIndia', 'JustDial', 'Exhibition', 'Referral', 'LinkedIn', 'WhatsApp', 'Email', 'Dealer', 'Cold calling', 'Existing customer', 'Manual / API'];
const INDUSTRIES = ['Steel & metals', 'Cement', 'Food processing', 'Pharmaceuticals', 'Chemicals & polymers', 'Warehousing & logistics', 'Fertilisers', 'Plantation & agri', 'Sugar', 'Paper & packaging', 'Mining & minerals', 'Dairy', 'Textiles'];
const TIMELINES = ['< 1 month', '1–3 months', '3–6 months', '6+ months'];
const BUDGET = ['Approved', 'In process', 'Not allocated', 'Unknown'];
const AUTHORITY = ['Decision maker engaged', 'Influencer only', 'Unknown'];
const NEED = ['Critical', 'Important', 'Nice to have'];
const QTIME = ['This quarter', 'Next quarter', 'This year', 'Unknown'];

export class CreateMfgLeadDto {
  @IsString()
  @IsNotEmpty()
  company: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsIn(INDUSTRIES)
  industry?: string;

  @IsIn(PRODUCTS)
  product: string;

  @IsOptional()
  @IsString()
  requirement?: string;

  @IsIn(SOURCES)
  source: string;

  @IsOptional()
  @IsString()
  campaign?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsIn(TIMELINES)
  timeline?: string;

  @IsOptional()
  @IsString()
  qReq?: string;

  @IsOptional()
  @IsString()
  qApp?: string;

  @IsOptional()
  @IsString()
  qQty?: string;

  @IsOptional()
  @IsIn(BUDGET)
  qBudget?: string;

  @IsOptional()
  @IsIn(AUTHORITY)
  qAuth?: string;

  @IsOptional()
  @IsIn(NEED)
  qNeed?: string;

  @IsOptional()
  @IsIn(QTIME)
  qTime?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  next?: string;

  @IsOptional()
  @IsDateString()
  nextDate?: string;
}
