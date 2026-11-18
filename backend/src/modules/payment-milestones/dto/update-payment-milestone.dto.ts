import { PartialType } from '@nestjs/mapped-types';
import { CreatePaymentMilestoneDto } from './create-payment-milestone.dto';

export class UpdatePaymentMilestoneDto extends PartialType(CreatePaymentMilestoneDto) {}
