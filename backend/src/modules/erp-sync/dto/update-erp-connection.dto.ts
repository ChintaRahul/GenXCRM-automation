import { PartialType } from '@nestjs/mapped-types';
import { CreateErpConnectionDto } from './create-erp-connection.dto';

export class UpdateErpConnectionDto extends PartialType(CreateErpConnectionDto) {}
