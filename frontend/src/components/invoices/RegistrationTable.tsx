import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormSubmissionDto, Invoice } from "../../types";
import { FormResponsesDialog } from "../register/FormResponsesDialog";
import { StatusBadge } from "../shared/StatusBadge";
import { RegistrationRowActions } from "./RegistrationRowActions";
import { formatDate, rupeeFull } from "../../lib/format";

interface RegistrationTableProps {
  invoices: Invoice[];
  onChanged: () => void;
  // Newest first, keyed by leadId.
  submissionsByLead?: Map<string, FormSubmissionDto[]>;
}

const COLS = ["Lead", "Form", "Courses", "Registration fee", "Mode", "Registered", "Status", ""];

const MODE_LABELS: Record<string, string> = { SAVE: "Save", SCREENSHOT: "Screenshot" };

function courseSummary(invoice: Invoice): string {
  const items = invoice.lineItems ?? [];
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0].courseName;
  return `${items[0].courseName} +${items.length - 1} more`;
}

// Presentational, props-driven table (CLAUDE.md rule 7) — mirrors InvoiceTable.tsx's
// responsive dual-render pattern (desktop table + mobile card list), scoped to the
// registration-specific columns instead of general invoice ones.
export function RegistrationTable({ invoices, onChanged, submissionsByLead }: RegistrationTableProps) {
  const navigate = useNavigate();
  const openRegistration = (id: string) => navigate(`/invoices/${id}/edit`);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const submissionsFor = (inv: Invoice) => (inv.leadId ? (submissionsByLead?.get(inv.leadId) ?? []) : []);
  const openLead = openLeadId ? invoices.find((i) => i.leadId === openLeadId) : undefined;

  const formPill = (inv: Invoice, label: string, className = "h-[26px]") => {
    const leadId = inv.leadId;
    if (!leadId || submissionsFor(inv).length === 0) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpenLeadId(leadId);
        }}
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-success/30 bg-success/10 px-2.5 text-xs font-semibold text-success transition-colors hover:bg-success/15 ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {label}
      </button>
    );
  };

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto hidden xl:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-card-border bg-muted/50">
              {COLS.map((h) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide whitespace-nowrap ${
                    h === "Registration fee" ? "text-right" : "text-left"
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
                onClick={() => openRegistration(inv.id)}
                className="border-b border-card-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <td className="px-4 py-2.5 max-w-[180px]">
                  <span
                    className="block truncate font-medium text-foreground"
                    title={inv.lead?.name ?? ""}
                  >
                    {inv.lead?.name ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {formPill(inv, "View responses") ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-2.5 max-w-[220px]">
                  <span className="block truncate text-muted-foreground" title={courseSummary(inv)}>
                    {courseSummary(inv)}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-right font-mono tabular-nums font-semibold text-foreground">
                  {rupeeFull(inv.registrationFee ?? 0)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {inv.registrationPaymentMode ? MODE_LABELS[inv.registrationPaymentMode] : "—"}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {formatDate(inv.registeredAt)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <RegistrationRowActions invoice={inv} onChanged={onChanged} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile registration cards — same data as the table above */}
      <div className="xl:hidden divide-y divide-card-border">
        {invoices.map((inv) => (
          <div
            key={inv.id}
            onClick={() => openRegistration(inv.id)}
            className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground truncate" title={inv.lead?.name ?? ""}>
                {inv.lead?.name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5" title={courseSummary(inv)}>
                {courseSummary(inv)}
              </p>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                Registered {formatDate(inv.registeredAt)}
                {inv.registrationPaymentMode ? ` · ${MODE_LABELS[inv.registrationPaymentMode]}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <StatusBadge status={inv.status} />
                {formPill(inv, "View responses", "h-7")}
              </div>
            </div>
            <div
              className="flex flex-col items-end gap-2 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-mono tabular-nums font-semibold text-sm text-foreground">
                {rupeeFull(inv.registrationFee ?? 0)}
              </p>
              <RegistrationRowActions invoice={inv} onChanged={onChanged} />
            </div>
          </div>
        ))}
      </div>

      {openLead?.leadId && (
        <FormResponsesDialog
          lead={{ id: openLead.leadId, name: openLead.lead?.name ?? "Lead" }}
          submissions={submissionsByLead?.get(openLead.leadId) ?? []}
          open
          onOpenChange={(o) => !o && setOpenLeadId(null)}
        />
      )}
    </div>
  );
}
