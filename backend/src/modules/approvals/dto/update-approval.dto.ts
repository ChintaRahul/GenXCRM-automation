import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateApprovalDto } from './create-approval.dto';

export class UpdateApprovalDto extends PartialType(CreateApprovalDto) {
  @IsOptional() @IsString() approverComments?: string;
}
