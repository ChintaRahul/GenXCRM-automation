import { IsIn, IsString } from 'class-validator';

export const FORM_CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS', 'LINK'] as const;

export class SendFormDto {
  @IsString()
  readonly formId: string;

  @IsIn(FORM_CHANNELS)
  readonly channel: (typeof FORM_CHANNELS)[number];
}
