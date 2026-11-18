import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CourseCategory } from '@prisma/client';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  defaultPrice: number;

  @IsOptional()
  @IsEnum(CourseCategory)
  category?: CourseCategory;
}
