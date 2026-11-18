import { IsEmail } from 'class-validator';

export class MfaResetRequestDto {
  @IsEmail()
  email: string;
}
