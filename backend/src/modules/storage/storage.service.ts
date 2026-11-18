import { Injectable } from '@nestjs/common';
import * as AWS from 'aws-sdk';

const UPLOAD_URL_TTL_SEC = 300;
const DOWNLOAD_URL_TTL_SEC = 900;

@Injectable()
export class StorageService {
  private readonly s3: AWS.S3;
  private readonly bucket = process.env.S3_BUCKET ?? 'genxcrm-recordings';

  constructor() {
    this.s3 = new AWS.S3({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      // Required — regions created after Jan 2014 (including ap-south-1) only accept SigV4;
      // aws-sdk v2 otherwise signs presigned URLs with the older SigV2 scheme, which these
      // regions reject with "InvalidRequest: ... Please use AWS4-HMAC-SHA256."
      signatureVersion: 'v4',
      // Explicit — without this the SDK falls back to its default credential chain
      // (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, the SES key pair), which may lack S3
      // permissions: presigning still succeeds, but the actual PUT/GET against S3 403s.
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, s3ForcePathStyle: true } : {}),
    });
  }

  buildRecordingKey(leadId: string, recordingId: string, ext: string): string {
    return `leads/${leadId}/recordings/${recordingId}.${ext}`;
  }

  buildInvoiceRegistrationScreenshotKey(invoiceId: string, ext: string): string {
    return `invoices/${invoiceId}/registration-screenshot.${ext}`;
  }

  buildAttachmentKey(orgId: string, attachmentId: string, ext: string): string {
    return `orgs/${orgId}/attachments/${attachmentId}.${ext}`;
  }

  buildModuleDocumentKey(orgId: string, moduleKey: string, recordId: string, documentId: string, ext: string): string {
    return `orgs/${orgId}/modules/${moduleKey}/${recordId}/${documentId}.${ext}`;
  }

  // Fixed filename (not a generated id) — an org has exactly one logo, and re-uploading
  // should overwrite it in place rather than accumulate orphaned objects.
  buildOrgLogoKey(orgId: string, ext: string): string {
    return `orgs/${orgId}/logo.${ext}`;
  }

  // Short-lived, single-object PUT URL for the Android app to upload a recording directly to S3.
  getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    return this.s3.getSignedUrlPromise('putObject', {
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      Expires: UPLOAD_URL_TTL_SEC,
    });
  }

  // The only way a recording's location ever leaves the service layer — callers must never
  // see the raw S3 key/URL (CLAUDE.md: never return raw S3 URLs to clients). Mint fresh per
  // playback request rather than caching, since the URL expires.
  getPresignedDownloadUrl(key: string): Promise<string> {
    return this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucket,
      Key: key,
      Expires: DOWNLOAD_URL_TTL_SEC,
    });
  }

  // Server-side fetch of an object's bytes — used when the raw bytes must be embedded
  // somewhere (e.g. a MIME email attachment) rather than handed to the client as a URL.
  async getObjectBuffer(key: string): Promise<Buffer> {
    const { Body } = await this.s3.getObject({ Bucket: this.bucket, Key: key }).promise();
    return Buffer.isBuffer(Body) ? Body : Buffer.from(Body as string);
  }
}
