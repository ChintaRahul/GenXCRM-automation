import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';
import { CreateAccountDto } from './create-account.dto';

const STATUSES = ['Active', 'Dormant', 'On hold'];

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
}
