import { PartialType } from '@nestjs/mapped-types';
import { CreateSlaTimerDto } from './create-sla-timer.dto';

export class UpdateSlaTimerDto extends PartialType(CreateSlaTimerDto) {}
