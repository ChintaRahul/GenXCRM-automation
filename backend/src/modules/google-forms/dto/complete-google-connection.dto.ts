import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CompleteGoogleConnectionDto {
  @IsString() @IsNotEmpty() @MaxLength(2048)
  readonly code: string;

  @IsString() @IsNotEmpty() @MaxLength(2048)
  readonly state: string;
}
