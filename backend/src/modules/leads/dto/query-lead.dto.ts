import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsInt, IsArray, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { LeadSource, LeadStage } from '@prisma/client';

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class QueryLeadDto {
  // Deprecated singular filters — kept for existing callers (e.g. dashboard deep
  // links like /leads?stage=ENROLLED). New UI should use the plural fields below.
  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(LeadStage, { each: true })
  @Transform(toArray)
  stages?: LeadStage[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  customStageIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(LeadSource, { each: true })
  @Transform(toArray)
  sources?: LeadSource[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  assignedToIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  cities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  courses?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  scoreMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  scoreMax?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hotOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean;

  // Quick filters mirroring the metrics on the Reports > Sales Rep Productivity
  // table, so a productivity number can deep-link straight to the matching leads.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  notEngaged?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  untouched?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  followupOverdue?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  leaking?: boolean;

  // Saved-view quick filter (Leads > Filters drawer > Saved views > "Idle 24h+") —
  // leads with no logged activity in the last 24 hours.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  idle?: boolean;

  // Quick filters mirroring the Reports > Daily Report KPI cards (see
  // reports.service.ts dailySummary()), so a KPI number can deep-link straight
  // to the matching leads.
  @IsOptional()
  @IsDateString()
  commsAfter?: string;

  @IsOptional()
  @IsDateString()
  commsBefore?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pendingFollowup?: boolean;

  // Deprecated singular filter — kept for existing callers. New UI uses teamIds.
  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  teamIds?: string[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  course?: string;

  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @IsOptional()
  @IsDateString()
  createdBefore?: string;

  // Which timestamp createdAfter/createdBefore apply to. Omitted = created OR updated
  // (the Leads page's own date filter). Report-card drill-downs pass an explicit value
  // so the list matches the card's own definition exactly.
  @IsOptional()
  @IsIn(['created', 'updated'])
  dateField?: 'created' | 'updated';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
