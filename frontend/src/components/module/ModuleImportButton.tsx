import { useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { REGISTRY } from "../../modules/registry";
import { useModuleImport } from "../../hooks/useModuleImport";

// Headings people commonly use that don't match a field label exactly.
const ALIASES: Record<string, Record<string, string>> = {
  leads: { Name: "contactName", "Contact person": "contactName", Mobile: "phone", Phone: "phone", "Phone number": "phone", "Email address": "email", "Company name": "company", Organisation: "company", Enquiry: "requirement", Budget: "value", "Lead source": "source" },
};

interface ModuleImportButtonProps {
  readonly moduleKey: string;
  readonly onImported: () => void;
}

export function ModuleImportButton({ moduleKey, onImported }: ModuleImportButtonProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { importing, result, importFile, clearResult } = useModuleImport(moduleKey, REGISTRY[moduleKey].fields, ALIASES[moduleKey] ?? {}, onImported);

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        data-testid="import-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
      <Button variant="outline" size="sm" disabled={importing} onClick={() => fileInput.current?.click()} title="Import from a CSV file with a heading row">
        <Upload className="w-4 h-4 mr-1.5" /> {importing ? "Importing…" : "Import"}
      </Button>
      <Dialog open={result !== null} onOpenChange={(next) => !next && clearResult()}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Import finished</DialogTitle>
          </DialogHeader>
          {result && (
            <div className="space-y-3 overflow-y-auto text-sm">
              <p>
                <strong>{result.imported}</strong> added · <strong>{result.duplicates}</strong> already existed · <strong>{result.errors.length}</strong> had problems
              </p>
              {result.errors.length > 0 && (
                <ul className="space-y-1 text-muted-foreground">
                  {result.errors.map((error) => (
                    <li key={error.row} className="truncate" title={error.reason}>
                      Row {error.row}: {error.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={clearResult}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
