import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

// `status[]=a&status[]=b` and a bare `status=a` both arrive here; normalise to string[].
const toStringArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === '') return undefined;
  return (Array.isArray(value) ? value : [value]).map(String);
};

const toBoolean = ({ value }: { value: unknown }): boolean => value === true || value === 'true';

export class ModuleListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(toStringArray)
  @IsString({ each: true })
  status?: string[];

  @IsOptional()
  @Transform(toStringArray)
  @IsString({ each: true })
  ownerId?: string[];

  // Module facets as a JSON object `{ "<field>": ["a", "b"] }`. Unknown fields are dropped
  // server-side (see buildListFilters), so this is safe to accept as an opaque string.
  @IsOptional()
  @IsString()
  facets?: string;

  @IsOptional()
  @IsIn(['today', 'mtd', '7d', '30d', '90d', 'custom'])
  datePreset?: string;

  // YYYY-MM-DD
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueMax?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  slaRisk?: boolean;

  @IsOptional()
  @IsString()
  sort?: string;
}
