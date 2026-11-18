// Kept in sync with backend/src/modules/communications/dto/init-attachment.dto.ts
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const ATTACHMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.gif,.webp,.csv,.xls,.xlsx,.doc,.docx";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

export function isAllowedAttachmentType(mimeType: string): boolean {
  return (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
    mimeType,
  );
}
