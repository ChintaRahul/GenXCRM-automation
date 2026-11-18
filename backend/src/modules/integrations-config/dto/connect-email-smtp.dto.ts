import { IsString, IsNotEmpty, IsInt, IsBoolean, IsEmail, Min, Max } from 'class-validator';

export class ConnectEmailSmtpDto {
  @IsString()
  @IsNotEmpty()
  readonly host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  readonly port!: number;

  @IsBoolean()
  readonly secure!: boolean;

  @IsString()
  @IsNotEmpty()
  readonly username!: string;

  @IsString()
  @IsNotEmpty()
  readonly password!: string;

  @IsEmail()
  readonly fromEmail!: string;

  @IsString()
  @IsNotEmpty()
  readonly fromName!: string;
}
