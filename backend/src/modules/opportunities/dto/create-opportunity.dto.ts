import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const PRODUCTS = ['Weighbridge', 'Belt weigher', 'Checkweigher', 'Bagging machine', 'Conveyor', 'Load cells', 'Platform scale', 'Filling scale', 'AMC / Service'];
const CURRENCIES = ['INR', 'USD', 'EUR'];
const STAGES = ['Qualified', 'Requirement collected', 'Technical discussion', 'Site visit', 'Demo / trial', 'Solution proposed', 'Costing', 'Quotation sent', 'Negotiation', 'Approval pending', 'PO expected', 'PO received', 'Won', 'Lost'];
const SOURCES = ['Website', 'Google Ads', 'Meta', 'IndiaMART', 'TradeIndia', 'ExportersIndia', 'JustDial', 'Exhibition', 'Referral', 'LinkedIn', 'WhatsApp', 'Email', 'Dealer', 'Cold calling', 'Existing customer', 'Manual / API'];
const COMPETITORS = ['Avery Weigh-Tronix', 'Essae Digitronics', 'Mettler Toledo', 'Local fabricator', 'Other'];

export class CreateOpportunityDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsOptional()
  @IsString()
  plant?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsIn(PRODUCTS)
  product: string;

  @IsOptional()
  @IsInt()
  qty?: number;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsNumber()
  value: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: string;

  @IsIn(STAGES)
  stage: string;

  @IsDateString()
  closeDate: string;

  @IsOptional()
  @IsIn(COMPETITORS)
  competitor?: string;

  @IsOptional()
  @IsIn(SOURCES)
  source?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  technicalOwnerId?: string;

  @IsString()
  @IsNotEmpty()
  nextAction: string;

  @IsDateString()
  nextActionDate: string;
}
