import { useState } from "react";
import { toast } from "sonner";
import { uploadToS3 } from "../lib/upload";
import { initAttachment, completeAttachment } from "../api/client";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  isAllowedAttachmentType,
} from "../lib/attachmentTypes";
import type { PickedAttachment } from "../components/AttachmentPicker";

// Owns the email-attachment upload flow (init -> PUT to S3 -> complete) plus client-side
// count/size/type validation, so Composer and the nurturing step dialog just consume the
// resulting attachment id list instead of duplicating this logic.
export function useAttachments(initial: PickedAttachment[] = []) {
  const [attachments, setAttachments] = useState<PickedAttachment[]>(initial);
  const [uploading, setUploading] = useState(false);

  async function addFiles(files: File[]) {
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          toast.error(`${file.name} is larger than 20MB.`);
          continue;
        }
        if (!isAllowedAttachmentType(file.type)) {
          toast.error(`${file.name} isn't a supported file type.`);
          continue;
        }
        try {
          const { attachmentId, uploadUrl } = await initAttachment({
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
          });
          await uploadToS3(uploadUrl, file);
          await completeAttachment(attachmentId);
          setAttachments((prev) => [
            ...prev,
            { id: attachmentId, fileName: file.name, fileSize: file.size },
          ]);
        } catch {
          toast.error(`Couldn't upload ${file.name}.`);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function remove(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function reset() {
    setAttachments([]);
  }

  // Hydrates the list from already-uploaded attachments (e.g. reopening a nurturing step
  // that already has some) — bypasses the upload flow entirely.
  function replaceAll(list: PickedAttachment[]) {
    setAttachments(list);
  }

  return {
    attachments,
    uploading,
    addFiles,
    remove,
    reset,
    replaceAll,
    attachmentIds: attachments.map((a) => a.id),
  };
}
