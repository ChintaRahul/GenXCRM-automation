import { IsString, IsNotEmpty, IsEmail, Matches } from 'class-validator';

export class ConnectEmailSesDomainDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, {
    message: 'Enter a valid domain name (e.g. acme.com), not an email address or URL.',
  })
  readonly domain!: string;

  @IsEmail()
  readonly fromEmail!: string;

  @IsString()
  @IsNotEmpty()
  readonly fromName!: string;
}
