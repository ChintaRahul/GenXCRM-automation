import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CourseCategory } from '@prisma/client';

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(CourseCategory)
  category?: CourseCategory;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPrice?: number;

  // Lets the Courses page restore an archived course (isActive: true) via the same
  // update endpoint used to remove one (isActive: false) — see courses.service.ts's remove().
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
