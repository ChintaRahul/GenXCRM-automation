import { IsString, IsNotEmpty } from 'class-validator';

export class ConnectRazorpayDto {
  @IsString()
  @IsNotEmpty()
  readonly keyId!: string;

  @IsString()
  @IsNotEmpty()
  readonly keySecret!: string;
}
