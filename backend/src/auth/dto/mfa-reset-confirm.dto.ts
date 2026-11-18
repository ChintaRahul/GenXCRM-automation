import { IsString } from 'class-validator';

export class MfaResetConfirmDto {
  @IsString()
  token: string;
}
