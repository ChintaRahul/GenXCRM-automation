import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryStagesDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  readonly includeHidden?: boolean;
}
