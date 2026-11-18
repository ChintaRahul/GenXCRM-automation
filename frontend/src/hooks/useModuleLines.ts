import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getModuleRecord, updateModuleRecord } from "../api/modules";
import { apiErrorMessage } from "../lib/apiError";
import type { ModuleTab } from "../modules/registry";

export function useModuleLines(
  moduleKey: string,
  id: string,
  tab: ModuleTab,
  initialRows: readonly Record<string, unknown>[],
  onSaved?: (rows: Record<string, unknown>[]) => void,
) {
  const [rows, setRows] = useState<Record<string, unknown>[]>(
    initialRows.map((r) => ({ ...r })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = useCallback(() => {
    const blank: Record<string, unknown> = {};
    for (const col of tab.lineColumns ?? []) blank[col.key] = "";
    setRows((prev) => [...prev, blank]);
  }, [tab.lineColumns]);

  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // A line's amount follows qty × unit price × (1 − discount %) as those change; it stays editable.
  const withAmount = (row: Record<string, unknown>): Record<string, unknown> => {
    const [qty, price, discount] = [row.qty, row.unitPrice, row.discountPct ?? 0].map((v) => (v === "" ? NaN : Number(v)));
    if (!tab.lineColumns?.some((c) => c.key === "amount") || !(qty > 0) || !Number.isFinite(price)) return row;
    return { ...row, amount: Math.round(qty * price * (1 - (Number.isFinite(discount) ? discount : 0) / 100) * 100) / 100 };
  };

  const setCell = useCallback((index: number, key: string, value: unknown) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [key]: value };
        return ["qty", "unitPrice", "discountPct"].includes(key) ? withAmount(next) : next;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.lineColumns]);

  // Picking a product fills the description and the standard price when those are still blank.
  const setProduct = useCallback(async (index: number, productId: string) => {
    setCell(index, "productId", productId);
    if (!productId) return;
    try {
      const product = await getModuleRecord("products", productId);
      const blank = (v: unknown) => v === undefined || v === null || v === "";
      setRows((prev) =>
        prev.map((row, i) => {
          if (i !== index || row.productId !== productId) return row;
          const next = {
            ...row,
            ...(blank(row.description) && product?.description ? { description: product.description } : {}),
            ...(blank(row.unitPrice) && product?.price !== undefined ? { unitPrice: product.price } : {}),
            ...(blank(row.qty) ? { qty: 1 } : {}),
          };
          return withAmount(next);
        }),
      );
    } catch {
      // a failed lookup must never block entering the line by hand
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCell, tab.lineColumns]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Only the columns shown go to the API (saved rows also carry id, product…, which it rejects),
      // numeric cells as numbers (inputs hold strings), and blank cells left out.
      const columns = tab.lineColumns ?? [];
      const payloadRows = rows
        .map((row) =>
          Object.fromEntries(
            columns
              .filter(
                (col) =>
                  row[col.key] !== undefined &&
                  row[col.key] !== null &&
                  String(row[col.key]).trim() !== "",
              )
              .map((col) => [
                col.key,
                col.type === "money" || col.type === "num"
                  ? Number(row[col.key])
                  : row[col.key],
              ]),
          ),
        )
        .filter((row) => Object.keys(row).length > 0);
      await updateModuleRecord(moduleKey, id, { [tab.key]: payloadRows });
      onSaved?.(payloadRows);
      toast.success(`${tab.label} saved.`);
    } catch (err) {
      setError(
        apiErrorMessage(
          err,
          "Couldn't save these lines. Check the values and try again.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [moduleKey, id, tab.key, tab.label, tab.lineColumns, rows, onSaved]);

  return { rows, addRow, removeRow, setCell, setProduct, save, saving, error };
}
