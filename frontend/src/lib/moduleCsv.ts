import type { ModuleColumn } from "../modules/registry";
import type { ModuleRecord } from "../api/modules";

const quote = (value: unknown): string => `"${String(value ?? "").replaceAll('"', '""')}"`;

// Client-side CSV of the rows the user ticked, limited to the columns currently shown.
export const selectedToCsv = (records: readonly ModuleRecord[], columns: readonly ModuleColumn[]): string =>
  [columns.map((c) => quote(c.label)), ...records.map((r) => columns.map((c) => quote(r[c.key])))]
    .map((row) => row.join(","))
    .join("\n");
