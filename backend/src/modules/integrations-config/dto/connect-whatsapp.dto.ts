import { IsString, IsNotEmpty } from 'class-validator';

export class ConnectWhatsAppDto {
  @IsString()
  @IsNotEmpty()
  readonly phoneNumberId!: string;

  @IsString()
  @IsNotEmpty()
  readonly accessToken!: string;

  @IsString()
  @IsNotEmpty()
  readonly appSecret!: string;

  @IsString()
  @IsNotEmpty()
  readonly businessAccountId!: string;
}
