import { IsISO8601 } from 'class-validator';

export class ManualBackfillDto {
  @IsISO8601()
  since!: string;
}
