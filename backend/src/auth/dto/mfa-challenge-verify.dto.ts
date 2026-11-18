import { IsString, Length } from 'class-validator';

export class MfaChallengeVerifyDto {
  @IsString()
  challengeToken: string;

  // 6-digit TOTP code, or a 9-char recovery code (XXXX-XXXX).
  @IsString()
  @Length(6, 9)
  code: string;
}
