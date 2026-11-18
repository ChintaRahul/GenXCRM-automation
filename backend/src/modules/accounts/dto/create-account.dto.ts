import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const TYPES = ['Customer', 'Prospect', 'Dealer'];
const INDUSTRIES = ['Steel & metals', 'Cement', 'Food processing', 'Pharmaceuticals', 'Chemicals & polymers', 'Warehousing & logistics', 'Fertilisers', 'Plantation & agri', 'Sugar', 'Paper & packaging', 'Mining & minerals', 'Dairy', 'Textiles'];
const TERRITORIES = ['North', 'South', 'East', 'West', 'Central'];
const CREDIT_TERMS = ['100% advance', '30 days', '45 days', '60 days', '90 days'];
const SOURCES = ['Website', 'Google Ads', 'Meta', 'IndiaMART', 'TradeIndia', 'ExportersIndia', 'JustDial', 'Exhibition', 'Referral', 'LinkedIn', 'WhatsApp', 'Email', 'Dealer', 'Cold calling', 'Existing customer', 'Manual / API'];

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  short: string;

  @IsIn(TYPES)
  type: string;

  @IsIn(INDUSTRIES)
  industry: string;

  @IsOptional()
  @IsString()
  subIndustry?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  pan?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  billing?: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsIn(TERRITORIES)
  territory: string;

  @IsOptional()
  @IsNumber()
  potential?: number;

  @IsOptional()
  @IsIn(CREDIT_TERMS)
  creditTerms?: string;

  @IsOptional()
  @IsIn(SOURCES)
  source?: string;

  // The form has a single text box: "steel, priority" becomes ["steel", "priority"].
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').map((t: string) => t.trim()).filter(Boolean) : value))
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  ownerId?: string;
}
