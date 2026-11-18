import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGoogleFormDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  readonly name?: string;

  @IsOptional() @IsBoolean()
  readonly isActive?: boolean;
}
