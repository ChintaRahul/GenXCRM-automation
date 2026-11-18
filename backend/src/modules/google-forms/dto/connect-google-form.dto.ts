import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class ConnectGoogleFormDto {
  @IsString() @MinLength(1)
  readonly googleFormId: string;

  @IsOptional() @IsString() @MinLength(1)
  readonly googleSheetId?: string;

  @IsOptional() @IsBoolean()
  readonly createSheet?: boolean;
}
