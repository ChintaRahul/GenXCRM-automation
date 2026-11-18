import { loadErrorMessage } from "../lib/loadError";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  completeModuleDocument,
  deleteModuleDocument,
  getModuleDocuments,
  initModuleDocument,
  type DocumentItem,
} from "../api/modules";
import { MAX_ATTACHMENT_SIZE_BYTES, isAllowedAttachmentType } from "../lib/attachmentTypes";
import { apiErrorMessage } from "../lib/apiError";
import { uploadToS3 } from "../lib/upload";

// Browsers give DWG/DXF drawings no usable type, so they are labelled by extension.
const CAD_MIME_TYPES: Record<string, string> = { dwg: "image/vnd.dwg", dxf: "image/vnd.dxf" };
const cadMimeType = (file: File): string | undefined => CAD_MIME_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""];

export function useModuleDocuments(moduleKey: string, id: string) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getModuleDocuments(moduleKey, id);
        if (!cancelled) setDocuments(result);
      } catch (err) {
        if (!cancelled) setError(loadErrorMessage(err, "Failed to load documents"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, id, reloadKey]);

  // init -> PUT straight to S3 -> complete, then refetch so the new file shows with its signed URL.
  const upload = useCallback(
    async (file: File) => {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        toast.error(`${file.name} is larger than 20MB.`);
        return;
      }
      const mimeType = cadMimeType(file) ?? file.type;
      if (!isAllowedAttachmentType(mimeType) && !cadMimeType(file)) {
        toast.error(`${file.name} isn't a supported file type.`);
        return;
      }
      setUploading(true);
      try {
        const { documentId, uploadUrl } = await initModuleDocument(moduleKey, id, {
          fileName: file.name,
          mimeType,
          fileSize: file.size,
        });
        await uploadToS3(uploadUrl, new File([file], file.name, { type: mimeType }));
        await completeModuleDocument(moduleKey, id, documentId);
        setReloadKey((k) => k + 1);
      } catch (err) {
        toast.error(apiErrorMessage(err, `Couldn't upload ${file.name}.`));
      } finally {
        setUploading(false);
      }
    },
    [moduleKey, id],
  );

  const remove = useCallback(
    async (documentId: string) => {
      try {
        await deleteModuleDocument(moduleKey, id, documentId);
        setDocuments((prev) => prev.filter((d) => d.id !== documentId));
      } catch (err) {
        toast.error(apiErrorMessage(err, "Couldn't delete the document."));
      }
    },
    [moduleKey, id],
  );

  return { documents, loading, error, uploading, upload, remove };
}
