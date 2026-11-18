import { IsString, IsNotEmpty } from 'class-validator';

export class CompleteWhatsAppEmbeddedSignupDto {
  @IsString()
  @IsNotEmpty()
  readonly code!: string;

  @IsString()
  @IsNotEmpty()
  readonly phoneNumberId!: string;

  @IsString()
  @IsNotEmpty()
  readonly wabaId!: string;
}
