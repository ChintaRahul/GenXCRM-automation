import { IsNotEmpty, IsString, Matches } from 'class-validator';

// The poller calls this URL from our server, so only TradeIndia's own https hosts are accepted.
export const TRADEINDIA_LINK = /^https:\/\/([a-z0-9-]+\.)*tradeindia\.com\//i;

export class ConnectTradeIndiaDto {
  @IsString()
  @IsNotEmpty()
  @Matches(TRADEINDIA_LINK, { message: 'apiLink must be the https API Link from your TradeIndia My Inquiry API page.' })
  readonly apiLink!: string;
}
