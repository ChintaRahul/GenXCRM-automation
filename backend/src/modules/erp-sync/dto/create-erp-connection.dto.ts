import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export const ERP_ENTITIES = ['customers', 'items', 'orders', 'dispatches', 'receipts'];

export class CreateErpConnectionDto {
  @IsString() @IsNotEmpty() name: string;
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] }) endpointUrl: string;
  @IsString() @IsNotEmpty() secret: string;
  // Comma-separated subset of ERP_ENTITIES, e.g. "customers,items,orders" (checked in the service).
  @IsString() @IsNotEmpty() entities: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
