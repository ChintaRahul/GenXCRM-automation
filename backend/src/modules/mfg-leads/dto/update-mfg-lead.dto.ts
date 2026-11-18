import { PartialType } from '@nestjs/mapped-types';
import { CreateMfgLeadDto } from './create-mfg-lead.dto';

export class UpdateMfgLeadDto extends PartialType(CreateMfgLeadDto) {}
