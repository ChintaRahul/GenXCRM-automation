import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import type { Invoice } from "../../types";
import { deleteInvoice, getInvoicePdf } from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { EditRegistrationDialog } from "./EditRegistrationDialog";

interface RegistrationRowActionsProps {
  invoice: Invoice;
  onChanged: () => void;
}

// Kebab (⋯) row-action menu for one registration. Mirrors InvoiceRowActions.tsx's
// pattern (Popover-based menu, no dropdown-menu primitive in this codebase) but trimmed
// to what a registration row needs — course/lead edits route to the existing full
// invoice editor instead of duplicating that here.
export function RegistrationRowActions({ invoice, onChanged }: RegistrationRowActionsProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleEditCourses = () => {
    closeMenu();
    navigate(`/invoices/${invoice.id}/edit`);
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
            aria-label={`Actions for registration ${invoice.invoiceNumber}`}
            className="w-7 h-7 max-[767px]:w-10 max-[767px]:h-10 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 max-h-[300px] overflow-y-auto">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => {
                closeMenu();
                setEditDetailsOpen(true);
              }}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Edit registration details
            </button>
            <button
              type="button"
              onClick={handleEditCourses}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Edit courses / lead
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownloadPdf()}
              className="text-left px-2.5 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {downloading ? "Downloading…" : "Download PDF"}
            </button>
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

      <EditRegistrationDialog
        invoice={invoice}
        open={editDetailsOpen}
        onOpenChange={setEditDetailsOpen}
        onSaved={onChanged}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete registration {invoice.invoiceNumber}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone.</p>
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
