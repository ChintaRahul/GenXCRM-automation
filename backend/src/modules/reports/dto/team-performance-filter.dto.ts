import { IsOptional, IsString, IsDateString } from 'class-validator';

// Filter for /reports/productivity, /reports/source-performance, /reports/team-leaderboard.
// Kept separate from ReportFilterDto (Daily Report's filter) since those endpoints carry
// export/section fields that don't apply here.
export class TeamPerformanceFilterDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}
