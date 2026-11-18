import { PartialType } from '@nestjs/mapped-types';
import { CreateMasterValueDto } from './create-master-value.dto';

export class UpdateMasterValueDto extends PartialType(CreateMasterValueDto) {}
