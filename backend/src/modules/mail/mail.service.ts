import { Injectable, Logger } from '@nestjs/common';
import * as AWS from 'aws-sdk';

/**
 * Generic, recipient-agnostic mail sender backed by AWS SES.
 *
 * Unlike CommunicationsService (which is bound to a Lead and writes a
 * lead-scoped Communication row), this service simply delivers an email to any
 * address. If SES_FROM_EMAIL is unset it logs and skips — emails degrade
 * gracefully in dev. It never throws: a failed send must not break the caller.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly ses: AWS.SES;

  constructor() {
    this.ses = new AWS.SES({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  }

  // Returns whether the send actually succeeded — existing fire-and-forget
  // callers (`void this.mail.send(...)`) can keep ignoring it, but callers
  // that log a "sent" confirmation (e.g. verification emails) can check it
  // instead of assuming success just because send() didn't throw.
  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!process.env.SES_FROM_EMAIL) {
      this.logger.log(`SES_FROM_EMAIL unset — skipping email "${subject}" to ${to}`);
      return false;
    }

    try {
      await this.ses
        .sendEmail({
          Source: `${process.env.SES_FROM_NAME ?? 'GenXCRM'} <${process.env.SES_FROM_EMAIL}>`,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
          },
        })
        .promise();
      return true;
    } catch (err) {
      this.logger.error(
        `SES error sending "${subject}" to ${to}`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Sends an HTML email with one or more binary attachments (e.g. a PDF invoice).
   * SES's simple sendEmail API can't carry attachments, so we hand-build a
   * multipart/mixed MIME message and post it via sendRawEmail. Degrades and
   * never throws, exactly like send().
   */
  async sendRaw(
    to: string,
    subject: string,
    html: string,
    attachments: { filename: string; content: Buffer; contentType: string }[] = [],
  ): Promise<void> {
    if (!process.env.SES_FROM_EMAIL) {
      this.logger.log(`SES_FROM_EMAIL unset — skipping email "${subject}" to ${to}`);
      return;
    }

    try {
      const from = `${process.env.SES_FROM_NAME ?? 'GenXCRM'} <${process.env.SES_FROM_EMAIL}>`;
      const raw = this.buildMimeMessage(from, to, subject, html, attachments);
      await this.ses.sendRawEmail({ RawMessage: { Data: raw } }).promise();
    } catch (err) {
      this.logger.error(
        `SES raw error sending "${subject}" to ${to}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private buildMimeMessage(
    from: string,
    to: string,
    subject: string,
    html: string,
    attachments: { filename: string; content: Buffer; contentType: string }[],
  ): string {
    const boundary = `=_genx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const wrap = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
    const parts: string[] = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(Buffer.from(html, 'utf8').toString('base64')),
    ];

    for (const att of attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        wrap(att.content.toString('base64')),
      );
    }

    parts.push(`--${boundary}--`, '');
    return parts.join('\r\n');
  }
}
