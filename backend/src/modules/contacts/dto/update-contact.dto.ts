import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';
import { CreateContactDto } from './create-contact.dto';

const STATUSES = ['Active', 'Inactive'];

export class UpdateContactDto extends PartialType(CreateContactDto) {
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
}
