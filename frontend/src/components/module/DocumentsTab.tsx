import { useRef } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { useModuleDocuments } from "../../hooks/useModuleDocuments";
import { formatDate } from "../../lib/moduleCells";
import { ATTACHMENT_ACCEPT } from "../../lib/attachmentTypes";
import { Button } from "../ui/button";

export function DocumentsTab({ moduleKey, id }: { readonly moduleKey: string; readonly id: string }) {
  const { documents, loading, error, uploading, upload, remove } = useModuleDocuments(moduleKey, id);
  const fileInput = useRef<HTMLInputElement>(null);

  if (error) return <p className="text-sm text-destructive py-4">Couldn&apos;t load documents.</p>;
  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading…</p>;

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">PDF, image, Word, Excel or CSV — up to 20MB.</p>
        <input
          ref={fileInput}
          type="file"
          accept={`${ATTACHMENT_ACCEPT},.dwg,.dxf`}
          className="hidden"
          aria-label="Upload document"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow picking the same file again
            if (file) void upload(file);
          }}
        />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
          <Upload className="w-4 h-4" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No documents yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm" title={doc.name}>
                  {doc.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(doc.createdAt)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a href={doc.url} className="text-sm text-primary underline" target="_blank" rel="noreferrer">
                  Download
                </a>
                <Button size="icon" variant="ghost" aria-label={`Delete ${doc.name}`} onClick={() => void remove(doc.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
