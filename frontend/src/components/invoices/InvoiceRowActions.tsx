import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import type { Invoice } from "../../types";
import {
  deleteInvoice,
  getInvoice,
  getInvoicePdf,
  updateInvoiceStatus,
} from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface InvoiceRowActionsProps {
  invoice: Invoice;
  // Parent-owned refetch — this component never manages the invoice list's own state
  // (CLAUDE.md rule 7: hooks/pages own data, components stay presentational).
  onChanged: () => void;
}

// Kebab (⋯) row-action menu for one invoice. Built on the Popover primitive — this
// codebase has no DropdownMenu primitive and the plan explicitly says not to add
// @radix-ui/react-dropdown-menu just for this.
export function InvoiceRowActions({ invoice, onChanged }: InvoiceRowActionsProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleEdit = () => {
    closeMenu();
    navigate(`/invoices/${invoice.id}/edit`);
  };

  // No server-side duplicate endpoint exists (confirmed in the plan) — fetch the full
  // invoice, then hand its line items/lead/GST settings to the new-invoice form via
  // React Router's navigate(path, { state }), the standard RR mechanism for a one-shot
  // handoff between routes.
  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const full = await getInvoice(invoice.id);
      closeMenu();
      navigate("/invoices/new", {
        state: {
          duplicateFrom: {
            leadId: full.leadId,
            lineItems: full.lineItems,
            gstEnabled: full.gstEnabled,
            gstType: full.gstType,
            gstRate: full.gstRate,
            discountType: full.discountType,
            discountValue: full.discountValue,
            notes: full.notes,
          },
        },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.load.invoices));
    } finally {
      setDuplicating(false);
    }
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const blob = await getInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      closeMenu();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.pdfDownloadFailed));
    } finally {
      setDownloading(false);
    }
  };

  const handleMarkPaid = async () => {
    setMarkingPaid(true);
    try {
      await updateInvoiceStatus(invoice.id, "PAID");
      toast.success(Messages.invoices.updated);
      closeMenu();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.updateFailed));
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleVoidConfirmed = async () => {
    setVoiding(true);
    try {
      await updateInvoiceStatus(invoice.id, "CANCELLED");
      toast.success(Messages.invoices.updated);
      setVoidConfirmOpen(false);
      closeMenu();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.updateFailed));
    } finally {
      setVoiding(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    setDeleting(true);
    try {
      await deleteInvoice(invoice.id);
      toast.success(Messages.invoices.deleted);
      setConfirmOpen(false);
      closeMenu();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.deleteFailed));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for invoice ${invoice.invoiceNumber}`}
            className="w-7 h-7 max-[767px]:w-10 max-[767px]:h-10 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 max-h-[300px] overflow-y-auto">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={handleEdit}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={duplicating}
              onClick={() => void handleDuplicate()}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {duplicating ? "Duplicating…" : "Duplicate"}
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownloadPdf()}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {downloading ? "Downloading…" : "Download PDF"}
            </button>
            {(invoice.status === "SENT" || invoice.status === "OVERDUE") && (
              <button
                type="button"
                disabled={markingPaid}
                onClick={() => void handleMarkPaid()}
                className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-success hover:bg-muted transition-colors disabled:opacity-50"
              >
                {markingPaid ? "Marking…" : "Mark as Paid"}
              </button>
            )}
            {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  setVoidConfirmOpen(true);
                }}
                className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Void invoice
              </button>
            )}
            <div className="h-px bg-card-border my-1" />
            <button
              type="button"
              onClick={() => {
                closeMenu();
                setConfirmOpen(true);
              }}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-destructive hover:bg-muted transition-colors"
            >
              Delete
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={voidConfirmOpen} onOpenChange={setVoidConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Void invoice {invoice.invoiceNumber}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This marks the invoice as voided. It stays visible in your records but can no
            longer be sent or edited.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              type="button"
              disabled={voiding}
              onClick={() => setVoidConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              type="button"
              disabled={voiding}
              onClick={() => void handleVoidConfirmed()}
            >
              {voiding ? "Voiding…" : "Void invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete invoice {invoice.invoiceNumber}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              type="button"
              disabled={deleting}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteConfirmed()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
