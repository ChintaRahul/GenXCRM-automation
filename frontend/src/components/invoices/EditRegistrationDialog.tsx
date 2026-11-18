import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { updateInvoice } from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { Invoice, RegistrationPaymentMode } from "../../types";

interface EditRegistrationDialogProps {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

// Editing the registration-specific fields (fee/mode/note) that recordRegistrationPayment
// originally wrote — courses/lead live on the invoice itself and are edited via the
// existing full invoice editor (/invoices/:id/edit) instead of duplicating that here.
export function EditRegistrationDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
}: EditRegistrationDialogProps) {
  const [fee, setFee] = useState(invoice.registrationFee ?? 0);
  const [mode, setMode] = useState<RegistrationPaymentMode>(
    invoice.registrationPaymentMode ?? "SAVE",
  );
  const [note, setNote] = useState(invoice.registrationNote ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateInvoice(invoice.id, {
        registrationFee: fee,
        registrationPaymentMode: mode,
        registrationNote: note,
      });
      toast.success(Messages.invoices.updated);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.updateFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit registration details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Registration fee (₹)</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={fee === 0 ? "" : fee}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setFee(e.target.value === "" ? 0 : Number(e.target.value))}
              placeholder="0"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Recorded as</Label>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={mode === "SAVE" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setMode("SAVE")}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "SCREENSHOT" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setMode("SCREENSHOT")}
              >
                Screenshot
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Payment tracking notes</Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Transaction ref, UPI ID, remarks…"
              className="flex min-h-[56px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
