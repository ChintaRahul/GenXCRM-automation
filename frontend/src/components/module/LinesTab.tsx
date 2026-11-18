import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { LookupSelect } from "./LookupSelect";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";
import { useModuleLines } from "../../hooks/useModuleLines";
import { formatMoney } from "../../lib/moduleCells";
import type { ModuleTab } from "../../modules/registry";
import { X } from "lucide-react";

interface LinesTabProps {
  readonly moduleKey: string;
  readonly id: string;
  readonly tab: ModuleTab;
  readonly initialRows: readonly Record<string, unknown>[];
  readonly onSaved?: (rows: Record<string, unknown>[]) => void;
  readonly readOnly?: boolean;
}

export function LinesTab({ moduleKey, id, tab, initialRows, onSaved, readOnly = false }: LinesTabProps) {
  const { rows, addRow, removeRow, setCell, setProduct, save, saving, error } = useModuleLines(moduleKey, id, tab, initialRows, onSaved);
  const columns = tab.lineColumns;

  if (!columns?.length) {
    return <p className="text-sm text-muted-foreground py-4">This tab has no line columns not configured yet.</p>;
  }

  const totals = columns
    .filter((c) => c.type === "money" && c.key === "amount")
    .reduce<Record<string, number>>((acc, c) => {
      acc[c.key] = rows.reduce((sum, r) => sum + (Number(r[c.key]) ?? 0), 0);
      return acc;
    }, {});

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className="px-1.5">{col.label}</TableHead>
            ))}
            <TableHead className="px-1.5" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key} className={col.key === "productId" ? "min-w-[160px] px-1.5" : "px-1.5"}>
                  {col.key === "productId" ? (
                    // A product is picked by name; the id is only what gets stored.
                    <LookupSelect
                      id={`line-${i}-productId`}
                      source="products"
                      value={String(row[col.key] ?? "")}
                      onChange={(value) => void setProduct(i, value)}
                      placeholder="Select product…"
                    />
                  ) : (
                    <Input
                      type={col.type === "money" || col.type === "num" ? "number" : "text"}
                      value={String(row[col.key] ?? "")}
                      onChange={(e) => setCell(i, col.key, e.target.value)}
                      className={col.type === "money" ? "min-w-[104px]" : col.type === "num" ? "min-w-[64px]" : "min-w-[96px]"}
                    />
                  )}
                </TableCell>
              ))}
              <TableCell className="px-1.5">
                {!readOnly && (
                  <button type="button" onClick={() => removeRow(i)} aria-label="Remove row">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {Object.keys(totals).length > 0 && (
            <TableRow className="font-semibold">
              {columns.map((col) => (
                <TableCell key={col.key}>{col.type === "money" ? formatMoney(totals[col.key]) : ""}</TableCell>
              ))}
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
      </fieldset>
      {readOnly ? (
        <p className="text-xs text-muted-foreground">Line items are locked once a quotation leaves Draft. Revise it to make changes.</p>
      ) : (
        <div className="flex justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>
            + Add row
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
