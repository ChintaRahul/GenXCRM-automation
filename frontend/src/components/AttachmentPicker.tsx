import { useRef } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS } from "../lib/attachmentTypes";

export interface PickedAttachment {
  id: string;
  fileName: string;
  fileSize: number;
}

interface AttachmentPickerProps {
  attachments: PickedAttachment[];
  uploading?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Purely presentational — the upload flow and validation live in useAttachments().
export function AttachmentPicker({
  attachments,
  uploading = false,
  onAddFiles,
  onRemove,
  disabled = false,
}: AttachmentPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={disabled || uploading || attachments.length >= MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Paperclip className="w-3.5 h-3.5" />
          )}
          {uploading ? "Uploading…" : "Attach files"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // allow re-selecting the same file later
            if (files.length > 0) onAddFiles(files);
          }}
        />
        <span className="text-[11px] text-muted-foreground">
          Up to {MAX_ATTACHMENTS} files, 20MB each
        </span>
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-muted border border-card-border max-w-[220px]",
              )}
            >
              <span className="truncate" title={a.fileName}>
                {a.fileName}
              </span>
              <span className="text-muted-foreground shrink-0">
                {formatSize(a.fileSize)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${a.fileName}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
