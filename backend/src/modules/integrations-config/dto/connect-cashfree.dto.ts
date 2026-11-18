import { IsString, IsNotEmpty } from 'class-validator';

export class ConnectCashfreeDto {
  @IsString()
  @IsNotEmpty()
  readonly appId!: string;

  @IsString()
  @IsNotEmpty()
  readonly secretKey!: string;
}
