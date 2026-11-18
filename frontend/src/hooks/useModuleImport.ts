import { useCallback, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { importModuleRows, type ModuleImportResult } from "../api/modules";
import { apiErrorMessage } from "../lib/apiError";

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const MAX_ROWS = 500;

interface ImportableField {
  readonly key: string;
  readonly label: string;
}

// Parses a CSV (header row required), maps its columns to the module's fields by key or label, and
// sends the rows for import. `aliases` lets common headings (e.g. "Mobile") land on the right field.
export function useModuleImport(moduleKey: string, fields: readonly ImportableField[], aliases: Record<string, string>, onDone: () => void) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ModuleImportResult | null>(null);

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const text = await file.text();
        const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
        const byHeading = new Map<string, string>();
        for (const field of fields) {
          byHeading.set(normalize(field.key), field.key);
          byHeading.set(normalize(field.label), field.key);
        }
        for (const [heading, key] of Object.entries(aliases)) byHeading.set(normalize(heading), key);
        const rows = parsed.data.slice(0, MAX_ROWS).map((raw) => {
          const row: Record<string, string> = {};
          for (const [heading, value] of Object.entries(raw)) {
            const key = byHeading.get(normalize(heading));
            if (key && value?.trim()) row[key] = value.trim();
          }
          return row;
        });
        if (rows.length === 0) {
          toast.error("No rows found. The first line of the file must be the column headings.");
          return;
        }
        const outcome = await importModuleRows(moduleKey, rows);
        setResult(outcome);
        if (outcome.imported > 0) onDone();
      } catch (err) {
        toast.error(apiErrorMessage(err, "Couldn't import that file."));
      } finally {
        setImporting(false);
      }
    },
    [moduleKey, fields, aliases, onDone],
  );

  return { importing, result, importFile, clearResult: () => setResult(null) };
}
