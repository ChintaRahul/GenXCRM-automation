import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class AddBatchDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  schedule?: string;

  @IsOptional()
  @IsString()
  tutorId?: string;

  @IsInt()
  @Min(0)
  capacity: number;
}
