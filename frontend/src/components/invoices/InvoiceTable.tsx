import { useNavigate } from "react-router-dom";
import type { Invoice } from "../../types";
import { StatusBadge } from "../shared/StatusBadge";
import { InvoiceRowActions } from "./InvoiceRowActions";
import { formatDate, getInvoiceDisplayStatus, rupeeFull } from "../../lib/format";

interface InvoiceTableProps {
  invoices: Invoice[];
  onChanged: () => void;
}

const COLS = [
  "Invoice #",
  "Lead",
  "Date",
  "Due Date",
  "Amount (incl. tax)",
  "Status",
  "",
];

// Presentational, props-driven table (CLAUDE.md rule 7) — the invoices list page fetches
// data via useInvoicesList and passes it down. Mirrors TransactionsTable.tsx's responsive
// dual-render pattern: a desktop table plus a mobile card list, both sourced from the
// same `invoices` prop.
export function InvoiceTable({ invoices, onChanged }: InvoiceTableProps) {
  const navigate = useNavigate();
  const openInvoice = (id: string) => navigate(`/invoices/${id}/edit`);

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-card-border bg-muted/50">
              {COLS.map((h) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide whitespace-nowrap ${
                    h === "Amount (incl. tax)" ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                onClick={() => openInvoice(inv.id)}
                className="border-b border-card-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <td className="px-4 py-2.5 font-mono tabular-nums font-semibold text-foreground whitespace-nowrap max-w-[160px]">
                  <span className="block truncate" title={inv.invoiceNumber}>
                    {inv.invoiceNumber}
                  </span>
                </td>
                <td className="px-4 py-2.5 max-w-[180px]">
                  <span
                    className="block truncate font-medium text-foreground"
                    title={inv.lead?.name ?? ""}
                  >
                    {inv.lead?.name ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {formatDate(inv.invoiceDate)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {formatDate(inv.dueDate)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-right font-mono tabular-nums font-semibold text-foreground">
                  {rupeeFull(inv.grandTotal)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <StatusBadge status={getInvoiceDisplayStatus(inv)} />
                </td>
                <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <InvoiceRowActions invoice={inv} onChanged={onChanged} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile invoice cards — same data as the table above */}
      <div className="md:hidden divide-y divide-card-border">
        {invoices.map((inv) => (
          <div
            key={inv.id}
            onClick={() => openInvoice(inv.id)}
            className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              <p
                className="font-mono tabular-nums font-semibold text-sm text-foreground truncate"
                title={inv.invoiceNumber}
              >
                {inv.invoiceNumber}
              </p>
              <p
                className="text-xs text-muted-foreground truncate mt-0.5"
                title={inv.lead?.name ?? ""}
              >
                {inv.lead?.name ?? "—"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                {formatDate(inv.invoiceDate)} · Due {formatDate(inv.dueDate)}
              </p>
              <div className="mt-1.5">
                <StatusBadge status={getInvoiceDisplayStatus(inv)} />
              </div>
            </div>
            <div
              className="flex flex-col items-end gap-2 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-mono tabular-nums font-semibold text-sm text-foreground">
                {rupeeFull(inv.grandTotal)}
              </p>
              <InvoiceRowActions invoice={inv} onChanged={onChanged} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
