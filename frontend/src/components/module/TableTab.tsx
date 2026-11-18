import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useModuleTable } from "../../hooks/useModuleTable";
import { addModuleTableRow, removeModuleTableRow } from "../../api/modules";
import { apiErrorMessage } from "../../lib/apiError";
import { renderCell, formatMoney } from "../../lib/moduleCells";
import type { ModuleDef, ModuleTab } from "../../modules/registry";

interface TableTabProps {
  readonly moduleKey: string;
  readonly id: string;
  readonly tabKey: string;
  // When the tab declares `rowFields`, rows can be added and removed right here.
  readonly tab?: ModuleTab;
}

// TableTab has no access to a real ModuleDef for its rows' status/pill columns (the data
// comes from a per-tab endpoint, not a registry module) — pass a minimal stand-in so
// renderCell's `status`/`pill` branches (which only ever read moduleDef.statuses) don't crash
// if a future table response uses those column types.
const EMPTY_MODULE_DEF = { statuses: [] } as unknown as ModuleDef;

export function TableTab({ moduleKey, id, tabKey, tab }: TableTabProps) {
  const { data, loading, error, setData } = useModuleTable(moduleKey, id, tabKey);
  const rowFields = tab?.rowFields;
  const rowLabel = tab?.rowLabel ?? "row";
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error) {
    return <p className="text-sm text-destructive py-4">Couldn&apos;t load this table.</p>;
  }
  if (!data && loading) {
    return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  }

  const closeForm = () => {
    setAdding(false);
    setDraft({});
    setFormError(null);
  };

  const handleAdd = async () => {
    const missing = rowFields?.filter((f) => f.required && !(draft[f.key] ?? "").trim());
    if (missing?.length) {
      setFormError(`${missing.map((f) => f.label).join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      setData(await addModuleTableRow(moduleKey, id, tabKey, draft));
      closeForm();
    } catch (err) {
      setFormError(apiErrorMessage(err, `Couldn't add the ${rowLabel}.`));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (rowId: string) => {
    setFormError(null);
    try {
      setData(await removeModuleTableRow(moduleKey, id, tabKey, rowId));
    } catch (err) {
      setFormError(apiErrorMessage(err, `Couldn't remove the ${rowLabel}.`));
    }
  };

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      {rowFields &&
        (adding ? (
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
              {rowFields.map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`row-${f.key}`}>
                    {f.label} {f.required && <span className="text-destructive">*</span>}
                  </Label>
                  {f.type === "select" ? (
                    <select
                      id={`row-${f.key}`}
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select…</option>
                      {f.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input id={`row-${f.key}`} value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleAdd()} disabled={saving}>
                {saving ? "Saving…" : `Add ${rowLabel}`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              Add {rowLabel}
            </Button>
          </div>
        ))}
      {formError && (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No data yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {data!.columns.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
              {rowFields && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                {data!.columns.map((col) => (
                  <TableCell key={col.key}>{renderCell(col, { id: String(i), ...row }, EMPTY_MODULE_DEF)}</TableCell>
                ))}
                {rowFields && (
                  <TableCell>
                    {typeof row.id === "string" && (
                      <button
                        type="button"
                        aria-label={`Remove ${rowLabel} ${String(row.name ?? "")}`}
                        title={`Remove ${rowLabel}`}
                        className="min-h-8 min-w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted"
                        onClick={() => void handleRemove(row.id as string)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data!.totals && (
              <TableRow className="font-semibold">
                {data!.columns.map((col) => (
                  <TableCell key={col.key}>
                    {col.type === "money" ? formatMoney(data!.totals![col.key]) : String(data!.totals![col.key] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
