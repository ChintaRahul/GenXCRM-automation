import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const PRODUCTS = ['Weighbridge', 'Belt weigher', 'Checkweigher', 'Bagging machine', 'Conveyor', 'Load cells', 'Platform scale', 'Filling scale', 'AMC / Service'];
const ENVIRONMENTS = ['Indoor', 'Outdoor', 'Dusty', 'Hazardous (ATEX)', 'Cleanroom', 'Washdown'];
const PROTOCOLS = ['Modbus RTU', 'Modbus TCP', 'Profinet', 'EtherNet/IP', '4–20 mA', 'RS-232'];

export class CreateRfqDto {
  @IsString() @IsNotEmpty() custNo: string;
  @IsString() @IsNotEmpty() opportunityId: string;
  @IsString() @IsNotEmpty() accountId: string;
  @IsDateString() receivedOn: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsString() @IsNotEmpty() application: string;
  @IsIn(PRODUCTS) product: string;
  @IsOptional() @IsInt() qty?: number;
  @IsOptional() @IsString() capacity?: string;
  @IsOptional() @IsString() dimensions?: string;
  @IsOptional() @IsString() accuracy?: string;
  @IsOptional() @IsString() material?: string;
  @IsOptional() @IsIn(ENVIRONMENTS) environment?: string;
  @IsOptional() @IsString() utilities?: string;
  @IsOptional() @IsIn(PROTOCOLS) protocol?: string;
  @IsOptional() @IsString() erp?: string;
  @IsOptional() @IsBoolean() installRequired?: boolean;
  @IsOptional() @IsBoolean() calibRequired?: boolean;
  @IsOptional() @IsString() compliance?: string;
  @IsOptional() @IsString() delivery?: string;
  @IsOptional() @IsString() specialConditions?: string;
}
